import Ticket from "../../models/Ticket";
import AppError from "../../errors/AppError";
import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import Contact from "../../models/Contact";

const STATUSES = ["pending", "aguardando", "atendendo", "fechado"];

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

const roomStatus = (s: string) => `status:${String(s).toLowerCase()}`;
const roomTicket = (id: string | number) => `ticket:${id}`;

const DeleteTicketService = async (id: string): Promise<Ticket> => {
  const ticket = await Ticket.findOne({
    where: { id },
    include: [
      { model: Contact, as: "contact" },
      { model: Message, as: "messages" }
    ]
  });

  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  // Guarda informações antes de deletar
  const ticketId = ticket.id;
  const ticketStatus = ticket.status; // Usa o status direto, sem normalizar
  
  // Deleta as mensagens associadas primeiro (se necessário)
  // await Message.destroy({ where: { ticketId: ticketId } });
  
  // Deleta o ticket
  await ticket.destroy();

  // Emite eventos de remoção APÓS deletar com sucesso
  try {
    const io = getIO();
    
    // Remove apenas da sala do status atual do ticket
    io.to(roomStatus(ticketStatus)).emit("ticket", { 
      action: "delete", 
      ticketId: ticketId  // Usa apenas ticketId, não o objeto ticket
    });
    
    // Remove para quem está dentro do chat do ticket
    io.to(roomTicket(ticketId)).emit("ticket", { 
      action: "delete", 
      ticketId: ticketId 
    });
    
    // Notificação geral
    io.to("notification").emit("ticket", { 
      action: "delete", 
      ticketId: ticketId 
    });
    
    // NÃO emite para todas as salas, apenas para a sala relevante
    
  } catch (err) {
    // Se houver erro no socket, não quebra o fluxo de exclusão
    console.error("Erro ao emitir evento de delete:", err);
  }

  return ticket;
};

export default DeleteTicketService;
