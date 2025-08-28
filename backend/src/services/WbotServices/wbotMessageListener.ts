import * as Sentry from "@sentry/node";
import {
  Contact as WbotContact,
  Message as WbotMessage,
  MessageAck,
  Client
} from "whatsapp-web.js";

import { promisify } from "util";
import { writeFile } from "fs";
import { join } from "path";
import { Op } from "sequelize";

import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";

import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import { subHours } from "date-fns";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";

interface Session extends Client {
  id?: number;
}

const writeFileAsync = promisify(writeFile);
const roomStatus = (s: string) => `status:${String(s).toLowerCase()}`;
const roomTicket = (id: string | number) => `ticket:${id}`;

// Cache para evitar operações simultâneas no mesmo contato
const operationLocks = new Map<string, Promise<any>>();

// Função auxiliar para converter body em string
const getBodyText = (msg: WbotMessage, fallback?: string): string => {
  if (typeof msg.body === 'string') {
    return msg.body;
  }
  
  if (msg.body && typeof msg.body === 'object') {
    // Tenta extrair texto do objeto
    const bodyObj = msg.body as any;
    if (bodyObj.text && typeof bodyObj.text === 'string') {
      return bodyObj.text;
    }
    return JSON.stringify(msg.body);
  }
  
  return fallback || '[Mensagem]';
};

const verifyContact = async (msgContact: WbotContact): Promise<Contact> => {
  const profilePicUrl = await msgContact.getProfilePicUrl();
  const contactData = {
    name: msgContact.name || msgContact.pushname || msgContact.id.user,
    number: msgContact.id.user,
    profilePicUrl,
    isGroup: msgContact.isGroup
  };
  return CreateOrUpdateContactService(contactData);
};

const verifyQuotedMessage = async (msg: WbotMessage): Promise<Message | null> => {
  if (!msg.hasQuotedMsg) return null;
  const wbotQuotedMsg = await msg.getQuotedMessage();
  const quotedMsg = await Message.findOne({ where: { id: wbotQuotedMsg.id.id } });
  return quotedMsg || null;
};

// FUNÇÃO PRINCIPAL PARA GERENCIAR TICKETS - VERSÃO COMPLETA
const handleTicketForMessage = async (
  contact: Contact,
  whatsappId: number,
  unreadMessages: number,
  isFromMe: boolean,
  groupContact?: Contact
): Promise<{ ticket: Ticket; isNewTicket: boolean; statusChanged: boolean; oldStatus?: string }> => {
  
  const contactId = groupContact ? groupContact.id : contact.id;
  const lockKey = `${contactId}-${whatsappId}`;

  // Previne operações simultâneas no mesmo contato
  if (operationLocks.has(lockKey)) {
    console.log(`[handleTicket] Aguardando operação em andamento para contato: ${contactId}`);
    await operationLocks.get(lockKey);
  }

  const operation = (async () => {
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
        console.log(`[handleTicket] ✅ Ticket EM ATENDIMENTO: ${ticket.id} - Status: ${ticket.status}`);
        
        // Recarrega com associações para garantir dados completos
        await ticket.reload({
          include: ["contact", "queue", "user", "whatsapp"]
        });
        
        // Apenas atualiza unread se necessário
        if (!isFromMe && ticket.unreadMessages !== unreadMessages) {
          await ticket.update({ unreadMessages });
        }
        
        return { ticket, isNewTicket: false, statusChanged: false };
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
        console.log(`[handleTicket] ✅ Ticket pendente: ${ticket.id} - Status: ${ticket.status}`);
        
        // Recarrega com associações
        await ticket.reload({
          include: ["contact", "queue", "user", "whatsapp"]
        });
        
        const oldStatus = ticket.status;
        let statusChanged = false;

        // Se mensagem é ENVIADA por você e ticket está pendente/aguardando → mover para atendimento
        if (isFromMe && (ticket.status === "pending" || ticket.status === "aguardando")) {
          console.log(`[handleTicket] 🔄 Movendo ticket ${ticket.id} de '${ticket.status}' para 'open'`);
          
          await ticket.update({ 
            status: "open",
            unreadMessages: 0
          });
          
          await ticket.reload({
            include: ["contact", "queue", "user", "whatsapp"]
          });
          
          statusChanged = true;
          
          return { ticket, isNewTicket: false, statusChanged, oldStatus };
        }

        // Apenas atualiza unread para mensagens recebidas
        if (!isFromMe && ticket.unreadMessages !== unreadMessages) {
          await ticket.update({ unreadMessages });
        }

        return { ticket, isNewTicket: false, statusChanged: false };
      }

      // 3. BUSCA TICKETS FECHADOS PARA REABRIR (como no FindOrCreateTicketService)
      
      // Para grupos - busca último ticket fechado
      if (groupContact) {
        ticket = await Ticket.findOne({
          where: {
            status: "fechado",
            contactId: groupContact.id,
            whatsappId: whatsappId
          },
          order: [["updatedAt", "DESC"]]
        });
        
        if (ticket) {
          console.log(`[handleTicket] 🔄 Reabrindo ticket de grupo: ${ticket.id}`);
          
          const newStatus = isFromMe ? "open" : "pending";
          
          await ticket.update({
            status: newStatus,
            userId: null,
            unreadMessages: isFromMe ? 0 : unreadMessages
          });
          
          await ticket.reload({
            include: ["contact", "queue", "user", "whatsapp"]
          });
          
          return { ticket, isNewTicket: false, statusChanged: true, oldStatus: "fechado" };
        }
      }
      
      // Para contatos individuais - busca tickets fechados nas últimas 2 horas
      if (!groupContact) {
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
          console.log(`[handleTicket] 🔄 Reabrindo ticket individual: ${ticket.id} (fechado há menos de 2h)`);
          
          const newStatus = isFromMe ? "open" : "pending";
          
          await ticket.update({
            status: newStatus,
            userId: null,
            unreadMessages: isFromMe ? 0 : unreadMessages
          });
          
          await ticket.reload({
            include: ["contact", "queue", "user", "whatsapp"]
          });
          
          return { ticket, isNewTicket: false, statusChanged: true, oldStatus: "fechado" };
        }
      }

      // 4. CRIAR NOVO TICKET
      console.log(`[handleTicket] 🆕 Criando novo ticket para contato: ${contactId}`);
      
      const initialStatus = isFromMe ? "open" : "pending";
      
      ticket = await Ticket.create({
        contactId,
        status: initialStatus,
        isGroup: !!groupContact,
        unreadMessages: isFromMe ? 0 : unreadMessages,
        whatsappId
      });

      // Recarrega com todas as associações
      await ticket.reload({
        include: ["contact", "queue", "user", "whatsapp"]
      });

      console.log(`[handleTicket] ✅ Novo ticket: ${ticket.id} - Status: ${ticket.status}`);
      
      return { ticket, isNewTicket: true, statusChanged: false };

    } catch (error) {
      console.error(`[handleTicket] Erro:`, error);
      throw error;
    }
  })();

  operationLocks.set(lockKey, operation);
  
  try {
    const result = await operation;
    return result;
  } finally {
    // Remove do cache após 3 segundos
    setTimeout(() => operationLocks.delete(lockKey), 3000);
  }
};

// CRIAR MENSAGEM SEM DUPLICAR EVENTOS SOCKET
const createMessageSimple = async (messageData: any): Promise<Message> => {
  // Usa upsert para evitar duplicatas
  await Message.upsert(messageData);

  const message = await Message.findByPk(messageData.id, {
    include: [
      "contact",
      {
        model: Ticket,
        as: "ticket",
        include: ["contact", "queue", "user", "whatsapp"]
      },
      {
        model: Message,
        as: "quotedMsg",
        include: ["contact"]
      }
    ]
  });

  if (!message) {
    throw new Error("ERR_CREATING_MESSAGE");
  }

  return message;
};

const verifyMediaMessage = async (
  msg: WbotMessage,
  ticket: Ticket,
  contact: Contact
): Promise<Message> => {
  const quotedMsg = await verifyQuotedMessage(msg);
  const media = await msg.downloadMedia();
  if (!media) throw new Error("ERR_WAPP_DOWNLOAD_MEDIA");

  const ext = media.mimetype.split("/")[1].split(";")[0];
  const filename = media.filename || `${Date.now()}.${ext}`;

  await writeFileAsync(
    join(__dirname, "..", "..", "..", "public", filename),
    media.data,
    "base64"
  );

  const messageData = {
    id: msg.id.id,
    ticketId: ticket.id,
    contactId: msg.fromMe ? undefined : contact.id,
    body: getBodyText(msg, filename),
    fromMe: msg.fromMe,
    read: msg.fromMe,
    mediaUrl: filename,
    mediaType: media.mimetype.split("/")[0],
    quotedMsgId: quotedMsg?.id
  };

  await ticket.update({ lastMessage: getBodyText(msg, filename) });
  const newMessage = await createMessageSimple(messageData);

  return newMessage;
};

const verifyMessage = async (
  msg: WbotMessage,
  ticket: Ticket,
  contact: Contact
) => {
  // Verifica duplicata
  const existingMessage = await Message.findOne({
    where: { id: msg.id.id }
  });

  if (existingMessage) {
    console.log(`[verifyMessage] ⚠️ Mensagem já existe: ${msg.id.id}`);
    return existingMessage;
  }

  const quotedMsg = await verifyQuotedMessage(msg);

  const messageData = {
    id: msg.id.id,
    ticketId: ticket.id,
    contactId: msg.fromMe ? undefined : contact.id,
    body: getBodyText(msg),
    fromMe: msg.fromMe,
    mediaType: msg.type,
    read: msg.fromMe,
    quotedMsgId: quotedMsg?.id,
    ack: msg.fromMe ? 1 : 0
  };

  await ticket.update({ lastMessage: getBodyText(msg) });
  const newMessage = await createMessageSimple(messageData);
  
  return newMessage;
};

// EMITIR EVENTOS SOCKET DE FORMA CENTRALIZADA
const emitEvents = async (
  message: Message,
  ticket: Ticket,
  contact: Contact,
  isNewTicket: boolean,
  statusChanged: boolean,
  oldStatus?: string
) => {
  const io = getIO();
  console.log(`[emitEvents] Emitindo evento - isNew: ${isNewTicket}, statusChanged: ${statusChanged}, oldStatus: ${oldStatus}`);

  // 1. EVENTOS DE TICKET
  if (isNewTicket) {
    console.log(`[emitEvents] 🆕 Novo ticket: ${ticket.id} - Status: ${ticket.status}`);
    console.log(`[emitEvents] EMITINDO para sala: status:${ticket.status.toLowerCase()}`);
    
    // CORREÇÃO: Emite apenas para a sala de status específica
    // O evento será recebido por quem está escutando essa sala específica
    io.to(roomStatus(ticket.status)).emit("ticket", {
      action: "create",
      ticket: ticket.get()
    });
    
    // Para notificações gerais (como contadores), use um evento diferente
    io.to("notification").emit("ticket-notification", {
      action: "create",
      ticketId: ticket.id,
      status: ticket.status,
      unreadMessages: ticket.unreadMessages
    });
    
  } else if (statusChanged && oldStatus) {
    console.log(`[emitEvents] 🔄 Status mudou: ${oldStatus} → ${ticket.status}`);
    
    // Remove da fila anterior
    io.to(roomStatus(oldStatus)).emit("ticket", {
      action: "delete",
      ticketId: ticket.id
    });
    
    // Adiciona na nova fila
    io.to(roomStatus(ticket.status)).emit("ticket", {
      action: "create", 
      ticket: ticket.get()
    });
    
    // Notifica mudança de status (evento separado para evitar conflitos)
    io.to("notification").emit("ticket-status-changed", {
      ticketId: ticket.id,
      oldStatus,
      newStatus: ticket.status,
      ticket: ticket.get()
    });
    
  } else {
    // Para updates simples (como unreadMessages), emite apenas update
    io.to(roomStatus(ticket.status)).emit("ticket", {
      action: "updateUnread",
      ticket: ticket.get()
    });
  }

  // 2. EVENTO DE MENSAGEM - sempre emite para a sala específica do ticket
  io.to(roomTicket(ticket.id)).emit("message-created", message);

  // 3. NOTIFICAÇÃO DE MENSAGEM (apenas para recebidas ou novos tickets)
  if (!message.fromMe || isNewTicket) {
    io.to("notification").emit("appMessage", {
      action: "create",
      message,
      ticket: ticket.get(),
      contact
    });
  }
};

const isValidMsg = (msg: WbotMessage): boolean => {
  if (msg.from === "status@broadcast") return false;
  return [
    "chat", "audio", "ptt", "video", "image", 
    "document", "vcard", "sticker", "location"
  ].includes(msg.type);
};

const handleMessage = async (msg: WbotMessage, wbot: Session): Promise<void> => {
 if (!isValidMsg(msg)) return;

 try {
   let msgContact: WbotContact;
   let groupContact: Contact | undefined;

   if (msg.fromMe) {
     console.log(`[handleMessage] 📤 ENVIADA: ${typeof msg.body === 'string' ? msg.body.substring(0, 50) : msg.body}`);
     
     if (msg.hasMedia && msg.type !== "chat" && msg.type !== "location" && msg.type !== "vcard") {
       const media = await msg.downloadMedia();
       if (!media) {
         console.log("[handleMessage] ⏳ Aguardando mídia...");
         return;
       }
     }
     
     msgContact = await wbot.getContactById(msg.to);
   } else {
     console.log(`[handleMessage] 📥 RECEBIDA: ${typeof msg.body === 'string' ? msg.body.substring(0, 50) : msg.body}`);
     msgContact = await msg.getContact();
   }

   const chat = await msg.getChat();

   if (chat.isGroup) {
     const msgGroupContact = await wbot.getContactById(msg.fromMe ? msg.to : msg.from);
     groupContact = await verifyContact(msgGroupContact);
   }

   const unreadMessages = msg.fromMe ? 0 : chat.unreadCount;
   const contact = await verifyContact(msgContact);

   // USAR FINDORCREATETICKETSERVICE
   const ticket = await FindOrCreateTicketService(
     contact,
     wbot.id!,
     unreadMessages,
     groupContact,
     msg.fromMe
   );

   console.log(`[handleMessage] 🎫 Ticket: ${ticket.id} | Status: ${ticket.status}`);

   // PROCESSA MENSAGEM
   let message: Message;
   if (msg.hasMedia) {
     message = await verifyMediaMessage(msg, ticket, contact);
   } else {
     message = await verifyMessage(msg, ticket, contact);
   }

   if (!message) return;

   // EMITE EVENTOS SIMPLIFICADOS - apenas para novos tickets
   const io = getIO();
   io.to(roomStatus(ticket.status)).emit("ticket", {
     action: "upsert",
     ticket: ticket
   });

   io.to(roomTicket(ticket.id)).emit("message-created", message);

   if (!message.fromMe) {
     io.to("notification").emit("appMessage", {
       action: "create",
       message,
       ticket,
       contact
     });
   }

 } catch (err) {
   Sentry.captureException(err);
   logger.error(`[handleMessage] Erro: ${err}`);
   console.error(`[handleMessage] Erro detalhado:`, err);
 }
};

const handleMsgAck = async (msg: WbotMessage, ack: MessageAck) => {
  await new Promise(r => setTimeout(r, 500));
  const io = getIO();
  
  try {
    const messageToUpdate = await Message.findByPk(msg.id.id, {
      include: [
        "contact",
        { model: Message, as: "quotedMsg", include: ["contact"] }
      ]
    });
    
    if (!messageToUpdate) return;
    
    await messageToUpdate.update({ ack });

    io.to(roomTicket(messageToUpdate.ticketId)).emit("appMessage", {
      action: "update",
      message: messageToUpdate
    });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`[handleMsgAck] Erro: ${err}`);
  }
};

export function attachWbotMessageListeners(wbot: Session) {
  // Remove listeners antigos
  wbot.removeAllListeners("message");
  wbot.removeAllListeners("message_create");
  wbot.removeAllListeners("media_uploaded");
  wbot.removeAllListeners("message_ack");
  
  console.log(`[attachWbotMessageListeners] 🔗 Sessão: ${wbot.id}`);
  
  // Mensagens RECEBIDAS
  wbot.on("message", async msg => { 
    if (!msg.fromMe) {
      await handleMessage(msg, wbot);
    }
  });
  
  // Mensagens ENVIADAS
  wbot.on("message_create", async msg => { 
    if (msg.fromMe) {
      await handleMessage(msg, wbot);
    }
  });
  
  // Mídia enviada
  wbot.on("media_uploaded", async msg => { 
    if (msg.fromMe) {
      await handleMessage(msg, wbot);
    }
  });
  
  // Confirmações
  wbot.on("message_ack", async (msg, ack) => { 
    await handleMsgAck(msg, ack); 
  });
}

export { handleMessage };