import { Request, Response } from "express";
import * as Yup from "yup";
import { Op } from "sequelize";
import { subHours } from "date-fns";
import AppError from "../errors/AppError";
import GetDefaultWhatsApp from "../helpers/GetDefaultWhatsApp";
import SetTicketMessagesAsRead from "../helpers/SetTicketMessagesAsRead";
import Message from "../models/Message";
import Ticket from "../models/Ticket";
import Whatsapp from "../models/Whatsapp";
import CreateOrUpdateContactService from "../services/ContactServices/CreateOrUpdateContactService";
import ShowTicketService from "../services/TicketServices/ShowTicketService";
import CheckIsValidContact from "../services/WbotServices/CheckIsValidContact";
import CheckContactNumber from "../services/WbotServices/CheckNumber";
import GetProfilePicUrl from "../services/WbotServices/GetProfilePicUrl";
import SendWhatsAppMedia from "../services/WbotServices/SendWhatsAppMedia";
import SendWhatsAppMessage from "../services/WbotServices/SendWhatsAppMessage";

type WhatsappData = {
  whatsappId: number;
}

type MessageData = {
  body: string;
  fromMe: boolean;
  read: boolean;
  quotedMsg?: Message;
};

interface ContactData {
  number: string;
}

// FUNÇÃO UNIFICADA PARA CRIAR/BUSCAR TICKETS (mesma lógica do wbotMessageListener)
const findOrCreateTicketForApi = async (
  contact: any,
  whatsappId: number,
  unreadMessages: number = 0,
  isFromApi: boolean = true // API sempre é considerada "mensagem enviada"
) => {
  const contactId = contact.id;
  
  try {
    // 1. BUSCA TICKET EM ATENDIMENTO (prioridade máxima)
    let ticket = await Ticket.findOne({
      where: {
        status: { [Op.in]: ["open", "atendendo"] },
        contactId,
        whatsappId
      },
      order: [["updatedAt", "DESC"]]
    });

    if (ticket) {
      console.log(`[ApiController] Ticket em atendimento encontrado: ${ticket.id} - Status: ${ticket.status}`);
      return ticket;
    }

    // 2. BUSCA QUALQUER TICKET NÃO FECHADO
    ticket = await Ticket.findOne({
      where: {
        status: { [Op.in]: ["pending", "aguardando"] },
        contactId,
        whatsappId
      },
      order: [["updatedAt", "DESC"]]
    });

    if (ticket) {
      console.log(`[ApiController] Ticket pendente encontrado: ${ticket.id} - Status: ${ticket.status}`);
      
      // Se encontrou ticket pendente/aguardando e é da API (enviado), move para atendimento
      if (isFromApi && (ticket.status === "pending" || ticket.status === "aguardando")) {
        console.log(`[ApiController] Movendo ticket ${ticket.id} de '${ticket.status}' para 'open' (API)`);
        
        await ticket.update({ 
          status: "open",
          unreadMessages: 0
        });
        
        await ticket.reload({
          include: ["contact", "queue", "user", "whatsapp"]
        });
      }
      
      return ticket;
    }

    // 3. BUSCA TICKETS FECHADOS PARA REABRIR (como no FindOrCreateTicketService original)
    
    // Para contatos individuais - busca tickets fechados nas últimas 2 horas
    ticket = await Ticket.findOne({
      where: {
        updatedAt: {
          [Op.between]: [+subHours(new Date(), 2), +new Date()]
        },
        status: "fechado",
        contactId: contactId,
        whatsappId: whatsappId
      },
      order: [["updatedAt", "DESC"]]
    });
    
    if (ticket) {
      console.log(`[ApiController] Reabrindo ticket: ${ticket.id} (fechado há menos de 2h)`);
      
      // Como é da API (enviado), abre direto em atendimento
      const newStatus = isFromApi ? "open" : "pending";
      
      await ticket.update({
        status: newStatus,
        userId: null,
        unreadMessages: isFromApi ? 0 : unreadMessages
      });
      
      await ticket.reload({
        include: ["contact", "queue", "user", "whatsapp"]
      });
      
      return ticket;
    }

    // 4. CRIAR NOVO TICKET
    console.log(`[ApiController] Criando novo ticket para contato: ${contactId}`);
    
    // Como é da API (mensagem sendo enviada), cria direto em "open"
    const initialStatus = isFromApi ? "open" : "pending";
    
    ticket = await Ticket.create({
      contactId,
      status: initialStatus,
      isGroup: false,
      unreadMessages: isFromApi ? 0 : unreadMessages,
      whatsappId
    });

    console.log(`[ApiController] Novo ticket criado: ${ticket.id} - Status: ${ticket.status}`);
    
    return ticket;

  } catch (error) {
    console.error(`[ApiController] Erro ao criar/buscar ticket:`, error);
    throw error;
  }
};

const createContact = async (
  whatsappId: number | undefined,
  newContact: string
) => {
  await CheckIsValidContact(newContact);

  const validNumber: any = await CheckContactNumber(newContact);

  const profilePicUrl = await GetProfilePicUrl(validNumber);

  const number = validNumber;

  const contactData = {
    name: `${number}`,
    number,
    profilePicUrl,
    isGroup: false
  };

  const contact = await CreateOrUpdateContactService(contactData);

  let whatsapp: Whatsapp | null;

  if (whatsappId === undefined) {
    whatsapp = await GetDefaultWhatsApp();
  } else {
    whatsapp = await Whatsapp.findByPk(whatsappId);

    if (whatsapp === null) {
      throw new AppError(`whatsapp #${whatsappId} not found`);
    }
  }

  // SUBSTITUIÇÃO: Usa a nova lógica unificada ao invés do FindOrCreateTicketService
  const createTicket = await findOrCreateTicketForApi(
    contact,
    whatsapp.id,
    0, // unreadMessages = 0 porque é mensagem sendo enviada
    true // isFromApi = true
  );

  const ticket = await ShowTicketService(createTicket.id);

  SetTicketMessagesAsRead(ticket);

  return ticket;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const newContact: ContactData = req.body;
  const { whatsappId }: WhatsappData = req.body;
  const { body, quotedMsg }: MessageData = req.body;
  const medias = req.files as Express.Multer.File[];

  newContact.number = newContact.number.replace("-", "").replace(" ", "");

  const schema = Yup.object().shape({
    number: Yup.string()
      .required()
      .matches(/^\d+$/, "Invalid number format. Only numbers is allowed.")
  });

  try {
    await schema.validate(newContact);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const contactAndTicket = await createContact(whatsappId, newContact.number);

  if (medias) {
    await Promise.all(
      medias.map(async (media: Express.Multer.File) => {
        await SendWhatsAppMedia({ body, media, ticket: contactAndTicket });
      })
    );
  } else {
    await SendWhatsAppMessage({ body, ticket: contactAndTicket, quotedMsg });
  }

  return res.send();
};