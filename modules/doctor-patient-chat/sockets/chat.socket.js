import jwt from 'jsonwebtoken';
import doctorModel from '../../../models/doctorModel.js';
import {
    getConversationById,
    createMessage,
    markMessageDelivered,
    markConversationRead,
} from '../services/chat.service.js';
import { CHAT_NAMESPACE, SOCKET_EVENTS } from '../types/chat.types.js';

const conversationRoom = (conversationId) => `conversation:${conversationId}`;
const userRoom = (userId) => `user:${userId}`;

let activeNamespace = null;

const emitToConversation = (conversationId, event, payload, receiverId = null) => {
    if (!activeNamespace) return;
    activeNamespace.to(conversationRoom(conversationId)).emit(event, payload);
    if (receiverId) {
        activeNamespace.to(userRoom(receiverId)).emit(event, payload);
    }
};

const isAuthorizedForConversation = (conversation, userId, role) =>
    !!conversation &&
    ((role === 'doctor' && conversation.doctorId === userId) ||
        (role === 'patient' && conversation.patientId === userId));

const registerChatNamespace = (io) => {
    const chatNamespace = io.of(CHAT_NAMESPACE);
    activeNamespace = chatNamespace;

    // Track online socket connections per identity `${role}:${userId}`
    const onlineConnections = new Map();

    // Authentication middleware
    chatNamespace.use(async (socket, next) => {
        try {
            const auth = socket.handshake.auth || {};
            const query = socket.handshake.query || {};
            const headers = socket.handshake.headers || {};

            const dtoken = auth.dtoken || query.dtoken || headers.dtoken;
            const token = auth.token || query.token || headers.token || headers.authorization?.replace(/^Bearer\s+/i, '');

            if (dtoken) {
                const decoded = jwt.verify(dtoken, process.env.JWT_SECRET);
                socket.chatUser = { id: decoded.id, role: 'doctor' };
                socket.data.userId = decoded.id;
                socket.data.role = 'doctor';
                return next();
            }

            if (token) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                let role = decoded.role || 'patient';
                if (role !== 'doctor') {
                    const isDoc = await doctorModel.exists({ _id: decoded.id });
                    if (isDoc) role = 'doctor';
                }
                socket.chatUser = { id: decoded.id, role };
                socket.data.userId = decoded.id;
                socket.data.role = role;
                return next();
            }

            next(new Error('Authentication required'));
        } catch (error) {
            next(new Error('Invalid or expired token'));
        }
    });

    chatNamespace.on('connection', (socket) => {
        const { id: userId, role } = socket.chatUser;
        const identityKey = `${role}:${userId}`;

        // Join individual user room for private notifications
        socket.join(userRoom(userId));
        socket.join(identityKey);

        if (!onlineConnections.has(identityKey)) {
            onlineConnections.set(identityKey, new Set());
        }
        const wasOffline = onlineConnections.get(identityKey).size === 0;
        onlineConnections.get(identityKey).add(socket.id);

        if (wasOffline) {
            socket.broadcast.emit(SOCKET_EVENTS.USER_ONLINE, { id: userId, role });
        }

        // Join a conversation room
        socket.on(SOCKET_EVENTS.JOIN, async ({ conversationId }) => {
            try {
                if (!conversationId) return;
                const conversation = await getConversationById(conversationId);
                if (!isAuthorizedForConversation(conversation, userId, role)) {
                    return socket.emit(SOCKET_EVENTS.ERROR, { message: 'Not authorized for this conversation' });
                }
                socket.join(conversationRoom(conversationId));
                socket.emit(SOCKET_EVENTS.JOINED, { conversationId });
            } catch (error) {
                socket.emit(SOCKET_EVENTS.ERROR, { message: 'Could not join conversation' });
            }
        });

        // Leave a conversation room
        socket.on(SOCKET_EVENTS.LEAVE, ({ conversationId }) => {
            if (conversationId) {
                socket.leave(conversationRoom(conversationId));
            }
        });

        // Real-time text message sending via socket
        socket.on(SOCKET_EVENTS.MESSAGE, async (payload, ack) => {
            try {
                const { conversationId, content } = payload || {};
                if (!conversationId) {
                    return ack?.({ success: false, message: 'conversationId is required' });
                }

                const room = conversationRoom(conversationId);

                // Auto-join room if authorized and not already joined
                const conversation = await getConversationById(conversationId);
                if (!isAuthorizedForConversation(conversation, userId, role)) {
                    return ack?.({ success: false, message: 'Not authorized for this conversation' });
                }
                if (!socket.rooms.has(room)) {
                    socket.join(room);
                }

                const receiverId = role === 'doctor' ? conversation.patientId : conversation.doctorId;
                const receiverRole = role === 'doctor' ? 'patient' : 'doctor';

                const { message, error } = await createMessage({
                    conversationId,
                    senderId: userId,
                    senderRole: role,
                    receiverId,
                    body: { messageType: 'TEXT', content },
                    file: null,
                });

                if (error) {
                    return ack?.({ success: false, message: error });
                }

                // Broadcast to conversation room and receiver's private room
                chatNamespace.to(room).emit(SOCKET_EVENTS.MESSAGE_SENT, message);
                chatNamespace.to(userRoom(receiverId)).emit(SOCKET_EVENTS.MESSAGE_SENT, message);

                // If recipient is connected, mark DELIVERED immediately
                const receiverKey = `${receiverRole}:${receiverId}`;
                if (onlineConnections.has(receiverKey) && onlineConnections.get(receiverKey).size > 0) {
                    await markMessageDelivered(message._id);
                    chatNamespace.to(room).emit(SOCKET_EVENTS.MESSAGE_DELIVERED, { messageId: message._id?.toString() });
                }

                ack?.({ success: true, message });
            } catch (error) {
                console.error('Socket message error:', error);
                ack?.({ success: false, message: 'Could not send message' });
            }
        });

        // Typing indicator
        socket.on(SOCKET_EVENTS.TYPING, ({ conversationId }) => {
            if (conversationId) {
                socket.to(conversationRoom(conversationId)).emit(SOCKET_EVENTS.TYPING, { conversationId, userId, role });
            }
        });

        // Stop typing indicator
        socket.on(SOCKET_EVENTS.STOP_TYPING, ({ conversationId }) => {
            if (conversationId) {
                socket.to(conversationRoom(conversationId)).emit(SOCKET_EVENTS.STOP_TYPING, { conversationId, userId, role });
            }
        });

        // Read receipt
        socket.on(SOCKET_EVENTS.MESSAGE_READ, async ({ conversationId }) => {
            try {
                if (!conversationId) return;
                await markConversationRead(conversationId, userId);
                chatNamespace
                    .to(conversationRoom(conversationId))
                    .emit(SOCKET_EVENTS.MESSAGE_READ, { conversationId, readerId: userId, readerRole: role });
            } catch (error) {
                socket.emit(SOCKET_EVENTS.ERROR, { message: 'Could not update read status' });
            }
        });

        // Presence check request
        socket.on('chat:check-online', ({ userId: targetUserId, role: targetRole }, callback) => {
            const targetKey = `${targetRole}:${targetUserId}`;
            const isOnline = onlineConnections.has(targetKey) && onlineConnections.get(targetKey).size > 0;
            callback?.({ online: isOnline, userId: targetUserId, role: targetRole });
        });

        // Disconnect
        socket.on('disconnect', () => {
            const connections = onlineConnections.get(identityKey);
            if (!connections) return;

            connections.delete(socket.id);
            if (connections.size === 0) {
                onlineConnections.delete(identityKey);
                socket.broadcast.emit(SOCKET_EVENTS.USER_OFFLINE, { id: userId, role });
            }
        });
    });

    return chatNamespace;
};

export default registerChatNamespace;
export { emitToConversation };
