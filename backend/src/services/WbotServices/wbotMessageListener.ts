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

import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";

import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";

interface Session extends Client {
  id?: number;
}

const writeFileAsync = promisify(writeFile);
const roomStatus = (s: string) => `status:${String(s).toLowerCase()}`;
const roomTicket = (id: string | number) => `ticket:${id}`;

// Função auxiliar para converter body em string
const getBodyText = (msg: WbotMessage, fallback?: string): string => {
  if (typeof msg.body === 'string') {
    return msg.body;
  }
  
  if (msg.body && typeof msg.body === 'object') {
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

const createMessageSimple = async (messageData: any): Promise<Message> => {
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

    // Usar FindOrCreateTicketService
    const ticket = await FindOrCreateTicketService(
      contact,
      wbot.id!,
      unreadMessages,
      groupContact,
      msg.fromMe
    );

    console.log(`[handleMessage] 🎫 Ticket: ${ticket.id} | Status: ${ticket.status}`);

    // Processar mensagem
    let message: Message;
    if (msg.hasMedia) {
      message = await verifyMediaMessage(msg, ticket, contact);
    } else {
      message = await verifyMessage(msg, ticket, contact);
    }

    if (!message) return;

    // EVENTOS SOCKET CORRIGIDOS
    const io = getIO();
    
    // 1. Evento de ticket - usar "update" em vez de "upsert"
    io.to(roomStatus(ticket.status)).emit("ticket", {
      action: "update",
      ticket: ticket
    });

    // 2. Evento de mensagem - usar "appMessage" padronizado
    io.to(roomTicket(ticket.id)).emit("appMessage", {
      action: "create",
      message,
      ticket,
      contact
    });

    // 3. Notificação apenas para mensagens recebidas
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