// backend/src/services/WbotServices/SendWhatsAppMessage.ts

import * as Sentry from "@sentry/node";
import { Message as WbotMessage } from "whatsapp-web.js";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import GetWbotMessage from "../../helpers/GetWbotMessage";
import SerializeWbotMsgId from "../../helpers/SerializeWbotMsgId";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { getIO } from "../../libs/socket";

interface Request {
  body: string;
  ticket: Ticket;
  quotedMsg?: Message;
}

const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsg
}: Request): Promise<Message> => {
  let quotedMsgSerializedId: string | undefined;
  
  if (quotedMsg) {
    await GetWbotMessage(ticket, quotedMsg.id);
    quotedMsgSerializedId = SerializeWbotMsgId(ticket, quotedMsg);
  }

  const wbot = await GetTicketWbot(ticket);

  try {
    // Envia a mensagem via WhatsApp
    const sentMessage: WbotMessage = await wbot.sendMessage(
      `${ticket.contact.number}@${ticket.isGroup ? "g" : "c"}.us`,
      body,
      {
        quotedMessageId: quotedMsgSerializedId
      }
    );

    // Aguarda um pouco para garantir que a mensagem foi enviada
    await new Promise(resolve => setTimeout(resolve, 300));

    // Salva a mensagem no banco de dados
    const messageData = {
      id: sentMessage.id.id,
      ticketId: ticket.id,
      contactId: undefined, // undefined porque é mensagem nossa
      body: body,
      fromMe: true,
      mediaType: "chat",
      read: true,
      quotedMsgId: quotedMsg?.id,
      ack: 1 // Marca como enviada
    };

    // Cria a mensagem no banco
    const message = await CreateMessageService({ messageData });

    // Atualiza o lastMessage do ticket
    await ticket.update({ 
      lastMessage: body
    });

    // Emite eventos via socket para atualizar a interface
    const io = getIO();
    
    // Recarrega o ticket com associações
    await ticket.reload({
      include: ["contact", "queue", "user", "whatsapp"]
    });

    // Emite para quem está no chat do ticket
    io.to(`ticket:${ticket.id}`).emit("message-created", message);
    
    // Emite atualização do ticket
    io.to(`status:${ticket.status}`).emit("ticket", {
      action: "update",
      ticket
    });

    // Notificação geral
    io.to("notification").emit("appMessage", {
      action: "create",
      message,
      ticket,
      contact: ticket.contact
    });

    console.log(`[SendWhatsAppMessage] Mensagem enviada e salva - ID: ${sentMessage.id.id}`);

    return message;
  } catch (err) {
    Sentry.captureException(err);
    console.error("[SendWhatsAppMessage] Erro ao enviar mensagem:", err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMessage;
