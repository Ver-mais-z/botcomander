// backend/src/services/TicketServices/UpdateTicketService.ts

import { getIO } from "../../libs/socket";
import Ticket from "../../models/Ticket";
import ShowTicketService from "./ShowTicketService";
import AppError from "../../errors/AppError";

interface Request {
  ticketData: {
    status?: string;
    userId?: number | null;
    queueId?: number | null;
  };
  ticketId: string | number;
}

interface Response {
  ticket: Ticket;
  oldStatus: string;
  oldUserId: number | null;
}

// Normalização consistente
const normalizeStatus = (s: string): string => {
  if (!s) return "pending";
  const v = String(s).toLowerCase();
  // Manter open e pending como status separados
  if (v === "open") return "open";
  if (v === "pending") return "pending";
  if (v === "aguardando") return "aguardando";
  if (v === "atendendo") return "atendendo";
  if (v === "closed" || v === "fechado") return "fechado";
  return "pending";
};

const roomStatus = (s: string) => `status:${s}`;  // Não normaliza aqui, usa o status direto
const roomTicket = (id: string | number) => `ticket:${id}`;

const UpdateTicketService = async ({
  ticketData,
  ticketId
}: Request): Promise<Response> => {
  const { status, userId, queueId } = ticketData;

  // Busca o ticket com todas as associações
  const ticket = await Ticket.findByPk(ticketId, {
    include: ["contact", "queue", "user", "whatsapp"]
  });

  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  // Guarda os valores anteriores
  const oldStatus = ticket.status;
  const oldUserId = ticket.userId;
  
  // Normaliza os status
  const normalizedOldStatus = normalizeStatus(oldStatus);
  const normalizedNewStatus = status ? normalizeStatus(status) : normalizedOldStatus;

  // Log para debug
  console.log(`[UpdateTicketService] Ticket ${ticketId}: 
    Status anterior: ${oldStatus} (${normalizedOldStatus})
    Novo status: ${status} (${normalizedNewStatus})
    UserId anterior: ${oldUserId}
    Novo userId: ${userId}`);

  // Atualiza o ticket
  const updateData: any = {};
  if (status !== undefined) updateData.status = status;
  if (userId !== undefined) updateData.userId = userId;
  if (queueId !== undefined) updateData.queueId = queueId;

  await ticket.update(updateData);

  // Recarrega com associações
  await ticket.reload({
    include: ["contact", "queue", "user", "whatsapp"]
  });

  // Emite eventos via socket
  const io = getIO();

  // Se o status mudou
  if (normalizedOldStatus !== normalizedNewStatus) {
    console.log(`[UpdateTicketService] Status mudou de ${normalizedOldStatus} para ${normalizedNewStatus}`);
    
    // Remove da sala do status antigo
    io.to(roomStatus(normalizedOldStatus)).emit("ticket", {
      action: "delete",
      ticketId: ticket.id
    });

    // Adiciona na sala do novo status
    io.to(roomStatus(normalizedNewStatus)).emit("ticket", {
      action: "upsert",
      ticket
    });
  } else {
    // Se apenas outros campos mudaram (userId, queueId)
    console.log(`[UpdateTicketService] Apenas dados do ticket mudaram, status mantido em ${normalizedNewStatus}`);
    
    io.to(roomStatus(normalizedNewStatus)).emit("ticket", {
      action: "update",
      ticket
    });
  }

  // Sempre emite para notificações e para quem está no chat
  io.to("notification").emit("ticket", {
    action: "update",
    ticket
  });

  io.to(roomTicket(ticket.id)).emit("ticketUpdate", ticket);

  return { 
    ticket, 
    oldStatus: oldStatus || "", 
    oldUserId: oldUserId || null 
  };
};

export default UpdateTicketService;
