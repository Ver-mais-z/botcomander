import { subHours } from "date-fns";
import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import ShowTicketService from "./ShowTicketService";

const FindOrCreateTicketService = async (
  contact: Contact,
  whatsappId: number,
  unreadMessages: number,
  groupContact?: Contact,
  isFromMe: boolean = false // NOVO PARÂMETRO
): Promise<Ticket> => {
  
  // PRIMEIRO: Verifica se existe ticket em QUALQUER status ativo (não fechado)
  // Isso inclui: pending, aguardando, atendendo, open
  let ticket = await Ticket.findOne({
    where: {
      status: {
        [Op.or]: ["open", "pending", "aguardando", "atendendo"]
      },
      contactId: groupContact ? groupContact.id : contact.id,
      whatsappId: whatsappId
    },
    order: [["updatedAt", "DESC"]]
  });

  if (ticket) {
    // Se achou ticket ativo, apenas atualiza mensagens não lidas
    await ticket.update({ unreadMessages });
    
    // Log para debug
    console.log(`[FindOrCreateTicket] Ticket existente encontrado: ${ticket.id} - Status: ${ticket.status}`);
    
    ticket = await ShowTicketService(ticket.id);
    return ticket;
  }

  // SE NÃO ACHOU TICKET ATIVO, verifica tickets fechados recentes para grupos
  if (!ticket && groupContact) {
    ticket = await Ticket.findOne({
      where: {
        status: "fechado",
        contactId: groupContact.id,
        whatsappId: whatsappId
      },
      order: [["updatedAt", "DESC"]]
    });
    
    if (ticket) {
      // CORREÇÃO: Status depende de quem está enviando a mensagem
      const newStatus = isFromMe ? "open" : "pending";
      
      await ticket.update({
        status: newStatus,
        userId: null,
        unreadMessages: isFromMe ? 0 : unreadMessages
      });
      
      console.log(`[FindOrCreateTicket] Ticket de grupo reaberto: ${ticket.id} - Status: ${newStatus}`);
    }
  }

  // Para contatos individuais, verifica se há ticket fechado nas últimas 2 horas
  if (!ticket && !groupContact) {
    ticket = await Ticket.findOne({
      where: {
        updatedAt: {
          [Op.between]: [+subHours(new Date(), 2), +new Date()]
        },
        status: "fechado",
        contactId: contact.id,
        whatsappId: whatsappId
      },
      order: [["updatedAt", "DESC"]]
    });
    
    if (ticket) {
      // CORREÇÃO: Status depende de quem está enviando a mensagem
      const newStatus = isFromMe ? "open" : "pending";
      
      await ticket.update({
        status: newStatus,
        userId: null,
        unreadMessages: isFromMe ? 0 : unreadMessages
      });
      
      console.log(`[FindOrCreateTicket] Ticket individual reaberto: ${ticket.id} - Status: ${newStatus}`);
    }
  }

  // APENAS CRIA NOVO TICKET SE NÃO ENCONTROU NENHUM
  if (!ticket) {
    // CORREÇÃO: Status inicial depende de quem está enviando a mensagem
    const initialStatus = isFromMe ? "open" : "pending";
    
    ticket = await Ticket.create({
      contactId: groupContact ? groupContact.id : contact.id,
      status: initialStatus,
      isGroup: !!groupContact,
      unreadMessages: isFromMe ? 0 : unreadMessages,
      whatsappId
    });
    
    console.log(`[FindOrCreateTicket] Novo ticket criado: ${ticket.id} - Status: ${initialStatus} - isFromMe: ${isFromMe}`);
  }

  ticket = await ShowTicketService(ticket.id);
  return ticket;
};

export default FindOrCreateTicketService;