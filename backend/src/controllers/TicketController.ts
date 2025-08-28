import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import CreateTicketService from "../services/TicketServices/CreateTicketService";
import DeleteTicketService from "../services/TicketServices/DeleteTicketService";
import ListTicketsService from "../services/TicketServices/ListTicketsService";
import ShowTicketService from "../services/TicketServices/ShowTicketService";
import UpdateTicketService from "../services/TicketServices/UpdateTicketService";
import SendWhatsAppMessage from "../services/WbotServices/SendWhatsAppMessage";
import ShowWhatsAppService from "../services/WhatsappService/ShowWhatsAppService";
import formatBody from "../helpers/Mustache";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
  status: string;
  date: string;
  showAll: string;
  withUnreadMessages: string;
  queueIds: string;
};

interface TicketData {
  contactId: number;
  status: string;
  queueId: number;
  userId: number;
}

// Normalização consistente com outros arquivos
const normalizeStatus = (s: string): string => {
  if (!s) return "pending";
  const v = String(s).toLowerCase();
  // Manter open e pending como status separados
  if (v === "open") return "open";
  if (v === "pending") return "pending";
  if (v === "aguardando") return "aguardando";
  if (v === "atendendo") return "atendendo";
  if (v === "fechado" || v === "closed") return "fechado";
  return "pending";
};

const roomStatus = (s: string) => `status:${s}`; // Usa o status direto sem normalizar

export const index = async (req: Request, res: Response): Promise<Response> => {
  const {
    pageNumber,
    status,
    date,
    searchParam,
    showAll,
    queueIds: queueIdsStringified,
    withUnreadMessages
  } = req.query as IndexQuery;
  
  const userId = req.user.id;
  
  let queueIds: number[] = [];
  if (queueIdsStringified) {
    queueIds = JSON.parse(queueIdsStringified);
  }
  
  const { tickets, count, hasMore } = await ListTicketsService({
    searchParam,
    pageNumber,
    status,
    date,
    showAll,
    userId,
    queueIds,
    withUnreadMessages
  });
  
  return res.status(200).json({ tickets, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { contactId, status, userId }: TicketData = req.body;
  
  // Log para debug - verificar se está sendo chamado
  console.log(`[TicketController.store] Criando ticket via API - ContactId: ${contactId}, Status: ${status}`);
  
  const ticket = await CreateTicketService({ contactId, status, userId });
  
  const io = getIO();
  
  // Emite APENAS para a sala do status específico do ticket
  const ticketStatus = ticket.status || "pending";
  
  io.to(`status:${ticketStatus}`).emit("ticket", {
    action: "upsert",
    ticket
  });
  
  console.log(`[TicketController.store] Ticket ${ticket.id} criado via API - Emitido para status:${ticketStatus}`);
  
  return res.status(200).json(ticket);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  
  const ticket = await ShowTicketService(ticketId);
  
  return res.status(200).json(ticket);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { ticketId } = req.params;
  const ticketData: TicketData = req.body;
  
  // Log para debug
  console.log(`[TicketController] Atualizando ticket ${ticketId}:`, ticketData);
  
  // O UpdateTicketService já cuida de emitir os eventos corretos
  const { ticket, oldStatus } = await UpdateTicketService({
    ticketData,
    ticketId
  });
  
  // Log da mudança
  if (oldStatus !== ticket.status) {
    console.log(`[TicketController] Ticket ${ticketId} mudou de ${oldStatus} para ${ticket.status}`);
  }
  
  // Se o ticket foi fechado, envia mensagem de despedida
  if (ticket.status === "closed" || ticket.status === "fechado") {
    const whatsapp = await ShowWhatsAppService(ticket.whatsappId);
    const { farewellMessage } = whatsapp;
    
    if (farewellMessage) {
      await SendWhatsAppMessage({
        body: formatBody(farewellMessage, ticket.contact),
        ticket
      });
    }
  }
  
  return res.status(200).json(ticket);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { ticketId } = req.params;
  
  // Log para debug
  console.log(`[TicketController] Deletando ticket ${ticketId}`);
  
  try {
    // O DeleteTicketService já emite os eventos corretos
    const deletedTicket = await DeleteTicketService(ticketId);
    
    console.log(`[TicketController] Ticket ${ticketId} deletado com sucesso`);
    
    return res.status(200).json({ 
      message: "ticket deleted",
      ticketId: ticketId
    });
  } catch (error) {
    console.error(`[TicketController] Erro ao deletar ticket ${ticketId}:`, error);
    throw error;
  }
};
