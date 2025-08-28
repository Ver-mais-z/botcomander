import { io } from "socket.io-client";
import { getBackendUrl } from "../config";

let socket = null;
let messageHandlers = new Set();
let ticketHandlers = new Set();
let connectionAttempts = 0;
let reconnectTimer = null;

const joinedTicketRooms = new Set();
const joinedStatusRooms = new Set();
let intentionalClose = false;

// Sistema de deduplicação
const processedEvents = new Map();
const EVENT_CACHE_TIME = 3000;

// Limpa eventos antigos do cache periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedEvents.entries()) {
    if (now - timestamp > EVENT_CACHE_TIME * 2) {
      processedEvents.delete(key);
    }
  }
}, EVENT_CACHE_TIME);

function normalizeStatus(s) {
  if (!s) return "pending";
  const v = String(s).toLowerCase();
  if (v === "open") return "open";
  if (v === "pending") return "pending";
  if (v === "aguardando") return "aguardando";
  if (v === "atendendo") return "atendendo";
  if (v === "fechado" || v === "closed") return "fechado";
  return "pending";
}

function shouldProcessEvent(eventType, eventData) {
  let eventKey;
  
  try {
    switch (eventType) {
      case 'ticket':
        eventKey = `ticket-${eventData.action}-${eventData.ticket?.id || eventData.ticketId}-${eventData.ticket?.status || ''}-${Date.now()}`;
        break;
      case 'contact':
        eventKey = `contact-${eventData.action || 'update'}-${eventData.contact?.id || eventData.id}`;
        break;
      case 'appMessage':
        eventKey = `appMessage-${eventData.action || 'create'}-${eventData.message?.id || eventData.id}-${eventData.ticket?.id || ''}`;
        break;
      case 'ticket-notification':
        eventKey = `notification-${eventData.action}-${eventData.ticketId}-${eventData.status}`;
        break;
      default:
        eventKey = `${eventType}-${JSON.stringify(eventData).substring(0, 100)}`;
    }
    
    const now = Date.now();
    const lastProcessed = processedEvents.get(eventKey);
    
    if (lastProcessed && (now - lastProcessed) < EVENT_CACHE_TIME) {
      return false;
    }
    
    processedEvents.set(eventKey, now);
    return true;
  } catch (error) {
    console.error("Erro ao processar evento:", error);
    return true; // Em caso de erro, processa o evento
  }
}

function scheduleReconnect() {
  if (intentionalClose || reconnectTimer) return;
  
  // Reconexão muito mais rápida: 100ms na primeira tentativa, máximo 2s
  const delay = Math.min(100 * Math.pow(1.5, connectionAttempts), 2000);
  console.log(`[socket] Reagendando reconexão em ${delay}ms`);
  
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!intentionalClose && (!socket || !socket.connected)) {
      console.log("[socket] Tentando reconectar...");
      createConnection();
    }
  }, delay);
}

function handleSocketError(error, context) {
  console.error(`[socket] Erro em ${context}:`, error);
  
  // Se o socket desconectar por erro, tenta reconectar
  if (socket && !socket.connected && !intentionalClose) {
    scheduleReconnect();
  }
}

function createConnection() {
  const url = getBackendUrl();

  // Limpa timer de reconexão se existir
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket && socket.connected) {
    return socket;
  }

  // Destroi socket anterior se existir
  if (socket) {
    try {
      socket.removeAllListeners();
      socket.disconnect();
    } catch (error) {
      console.error("[socket] Erro ao limpar socket anterior:", error);
    }
    socket = null;
  }

  socket = io(url, {
    transports: ["polling", "websocket"],
    path: "/socket.io",
    autoConnect: false,
    reconnection: false, // Vamos controlar manualmente
    timeout: 20000,
    forceNew: true,
    auth: (cb) => {
      const token = localStorage.getItem("token") || "";
      cb({ token });
    },
  });

  socket.on("connect", () => {
    console.log("[socket] ✅ Conectado!");
    connectionAttempts = 0;
    processedEvents.clear();

    try {
      socket.emit("joinNotification");

      for (const room of joinedTicketRooms) {
        socket.emit("joinChatBox", room);
      }
      
      for (const status of joinedStatusRooms) {
        socket.emit("joinTickets", status);
      }
    } catch (error) {
      handleSocketError(error, "reconnect rooms");
    }
  });

  socket.on("connect_error", (err) => {
    connectionAttempts++;
    console.error(`[socket] ❌ Erro de conexão (tentativa ${connectionAttempts}):`, err?.message || err);
    
    if (!intentionalClose) {
      scheduleReconnect();
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("[socket] 🔌 Desconectado:", reason);
    
    // Só reconecta se não foi intencional e não é um erro de auth
    if (!intentionalClose && reason !== "io client disconnect" && reason !== "transport close") {
      scheduleReconnect();
    }
  });

  socket.on("error", (error) => {
    handleSocketError(error, "socket error");
  });

  socket.on("message-created", (data) => {
    try {
      if (!shouldProcessEvent('message-created', data)) return;
      messageHandlers.forEach(h => {
        try { 
          h(data); 
        } catch (err) {
          console.error("[socket] Erro no handler de message-created:", err);
        }
      });
    } catch (error) {
      handleSocketError(error, "message-created handler");
    }
  });
  
  socket.on("appMessage", (data) => {
    try {
      if (!shouldProcessEvent('appMessage', data)) return;
      messageHandlers.forEach(h => {
        try { 
          h(data); 
        } catch (err) {
          console.error("[socket] Erro no handler de appMessage:", err);
        }
      });
    } catch (error) {
      handleSocketError(error, "appMessage handler");
    }
  });
  
  socket.on("ticket", (data) => {
    try {
      if (!shouldProcessEvent('ticket', data)) return;
      
      console.log("[socket] Processando evento ticket:", data);
      
      ticketHandlers.forEach(handler => {
        try { 
          handler(data); 
        } catch (err) {
          console.error("[socket] Erro no handler de ticket:", err);
          // Não permite que erro em um handler quebre os outros
        }
      });
    } catch (error) {
      handleSocketError(error, "ticket handler");
    }
  });

  if (!intentionalClose) {
    try {
      socket.connect();
    } catch (error) {
      handleSocketError(error, "connect");
    }
  }

  return socket;
}

export function onMessage(handler) {
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

export function onTicketUpdate(handler) {
  ticketHandlers.add(handler);
  return () => ticketHandlers.delete(handler);
}

export function joinStatusRoom(status) {
  if (!status) return;
  
  const s = normalizeStatus(status);
  
  if (!joinedStatusRooms.has(s)) {
    joinedStatusRooms.add(s);
  }
  
  if (socket && socket.connected) {
    try {
      socket.emit("joinTickets", s);
    } catch (error) {
      handleSocketError(error, "joinStatusRoom");
    }
  } else {
    createConnection();
  }
}

export function leaveStatusRoom(status) {
  if (!status) return;
  
  const s = normalizeStatus(status);
  joinedStatusRooms.delete(s);
  
  if (socket && socket.connected) {
    try {
      socket.emit("leaveTickets", s);
    } catch (error) {
      handleSocketError(error, "leaveStatusRoom");
    }
  }
}

export function socketConnection() { 
  return createConnection(); 
}

export default createConnection;

export function reattachAuth(newToken) {
  const token = newToken || localStorage.getItem("token") || "";
  
  if (!socket) {
    return createConnection();
  }
  
  socket.auth = { token };
  
  try { 
    socket.emit("refresh-auth", { token }); 
  } catch (err) {
    handleSocketError(err, "reattachAuth");
  }
  
  if (!socket.connected && !intentionalClose) { 
    try {
      socket.connect();
    } catch (error) {
      handleSocketError(error, "reattachAuth connect");
    }
  }
}

export function forceReconnect() {
  intentionalClose = false;
  
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  if (socket) {
    try { 
      socket.disconnect();
    } catch (err) {
      console.error("[socket] Erro ao desconectar no forceReconnect:", err);
    }
  }
  
  // Reconnect quase instantaneamente
  setTimeout(() => {
    try { 
      createConnection();
    } catch (err) {
      handleSocketError(err, "forceReconnect");
    }
  }, 50);
}

export function socketLogout() {
  intentionalClose = true;
  
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  joinedTicketRooms.clear();
  joinedStatusRooms.clear();
  processedEvents.clear();
  
  if (socket) {
    try { 
      socket.removeAllListeners();
      socket.disconnect(); 
    } catch (err) {
      console.error("[socket] Erro ao desconectar no logout:", err);
    }
    socket = null;
  }
}

export function getSocketStatus() {
  return {
    connected: socket?.connected || false,
    id: socket?.id || null,
    transport: socket?.io?.engine?.transport?.name || null,
    connectionAttempts,
    intentionalClose,
    handlers: {
      messages: messageHandlers.size,
      tickets: ticketHandlers.size
    },
    rooms: {
      tickets: Array.from(joinedTicketRooms),
      statuses: Array.from(joinedStatusRooms)
    }
  };
}

// Monitora o status da conexão e reconecta se necessário (verifica a cada 1 segundo)
setInterval(() => {
  if (!intentionalClose && socket && !socket.connected && !reconnectTimer) {
    console.log("[socket] Conexão perdida detectada, reconectando...");
    scheduleReconnect();
  }
}, 1000);