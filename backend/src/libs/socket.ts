import { Server as SocketIO } from "socket.io";
import { Server } from "http";
import { verify } from "jsonwebtoken";
import authConfig from "../config/auth";
import { logger } from "../utils/logger";
import User from "../models/User";

let io: SocketIO;

// Interface para o payload do JWT
interface TokenPayload {
  id: string | number;
  [key: string]: any;
}

// Normalização consistente com o wbotMessageListener
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

export const initIO = (httpServer: Server): SocketIO => {
  io = new SocketIO(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.on("connection", socket => {
    logger.info("Client Connected");
    
    const { token } = socket.handshake.auth;
    let userId: string | number | null = null;

    if (token) {
      try {
        const decoded = verify(token, authConfig.secret) as TokenPayload;
        userId = decoded.id;
        logger.debug(`User ${userId} connected`);
      } catch (err) {
        logger.error("Invalid token on socket connection:", err);
        socket.disconnect();
        return;
      }
    }

    // Entra na sala de notificações
    socket.join("notification");

    // Quando o cliente solicitar entrar em uma sala de tickets por status
    socket.on("joinTickets", (status: string) => {
      if (!status) return;
      
      // Normaliza o status para garantir consistência
      const normalizedStatus = normalizeStatus(status);
      const room = `status:${normalizedStatus}`;
      
      // CORREÇÃO: Removida a lógica que saia automaticamente de outras salas
      // Agora permite estar em múltiplas salas de status simultaneamente
      
      socket.join(room);
      logger.debug(`User ${userId} joined room ${room}`);
    });

    socket.on("leaveTickets", (status: string) => {
      if (!status) return;
      const normalizedStatus = normalizeStatus(status);
      const room = `status:${normalizedStatus}`;
      socket.leave(room);
      logger.debug(`User ${userId} left room ${room}`);
    });

    // Salas de chat individual de ticket
    socket.on("joinChatBox", (ticketId: string | number) => {
      if (!ticketId) return;
      const room = `ticket:${ticketId}`;
      socket.join(room);
      logger.debug(`User ${userId} joined chat ${room}`);
    });

    socket.on("leaveChatBox", (ticketId: string | number) => {
      if (!ticketId) return;
      const room = `ticket:${ticketId}`;
      socket.leave(room);
      logger.debug(`User ${userId} left chat ${room}`);
    });

    // Entra na sala de notificações gerais
    socket.on("joinNotification", () => {
      socket.join("notification");
      logger.debug(`User ${userId} joined notification room`);
    });

    // Atualização de autenticação sem desconectar
    socket.on("refresh-auth", (data: { token: string }) => {
      if (data.token) {
        try {
          const decoded = verify(data.token, authConfig.secret) as TokenPayload;
          userId = decoded.id;
          logger.debug(`User ${userId} refreshed auth`);
        } catch (err) {
          logger.error("Invalid token on refresh:", err);
        }
      }
    });

    socket.on("disconnect", (reason: string) => {
      logger.info(`Client disconnected: ${reason}`);
      if (userId) {
        logger.debug(`User ${userId} disconnected`);
      }
    });
  });

  return io;
};

export const getIO = (): SocketIO => {
  if (!io) {
    throw new Error("Socket IO not initialized");
  }
  return io;
};

// Helper para emitir eventos de forma consistente
export const emitTicketUpdate = (
  status: string,
  action: "upsert" | "delete" | "update",
  data: any
) => {
  if (!io) return;
  
  const normalizedStatus = normalizeStatus(status);
  const room = `status:${normalizedStatus}`;
  
  io.to(room).emit("ticket", {
    action,
    ...data
  });
};
