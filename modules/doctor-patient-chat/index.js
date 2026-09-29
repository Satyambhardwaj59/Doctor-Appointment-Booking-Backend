export { default as chatRouter } from './routes/chat.routes.js';
export { default as registerChatNamespace, emitToConversation } from './sockets/chat.socket.js';
export { authChatIdentity } from './middleware/chatAccess.middleware.js';
export { hasEligibleAppointment } from './services/chat.service.js';
