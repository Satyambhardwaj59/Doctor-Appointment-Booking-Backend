import {
    findOrCreateConversation,
    listConversationsForUser,
    listMessages,
    createMessage,
    markConversationRead,
    markSingleMessageRead,
    softDeleteMessage,
} from '../services/chat.service.js';
import { emitToConversation } from '../sockets/chat.socket.js';

// POST /api/chat/conversations
const startConversation = async (req, res) => {
    try {
        const { id: userId, role } = req.chatUser;
        const doctorId = role === 'doctor' ? userId : req.body.doctorId;
        const patientId = role === 'patient' ? userId : req.body.patientId;

        if (!doctorId || !patientId) {
            return res.status(400).json({ success: false, message: 'doctorId and patientId are required' });
        }

        const result = await findOrCreateConversation(patientId, doctorId);

        if (result.notFound) {
            return res.status(404).json({ success: false, message: result.notFound });
        }

        if (result.ineligible) {
            return res.status(403).json({
                success: false,
                message: 'A conversation requires at least one appointment between this doctor and patient',
            });
        }

        res.json({ success: true, conversation: result.conversation, created: result.created });
    } catch (error) {
        console.error('startConversation error:', error);
        res.status(500).json({ success: false, message: 'Could not start conversation' });
    }
};

// GET /api/chat/conversations
const getConversations = async (req, res) => {
    try {
        const { id: userId, role } = req.chatUser;
        const conversations = await listConversationsForUser(userId, role);
        res.json({ success: true, conversations });
    } catch (error) {
        console.error('getConversations error:', error);
        res.status(500).json({ success: false, message: 'Could not load conversations' });
    }
};

// GET /api/chat/conversations/:id
const getConversation = async (req, res) => {
    res.json({ success: true, conversation: req.conversation });
};

// GET /api/chat/conversations/:id/messages?page=&limit=
const getMessages = async (req, res) => {
    try {
        const { page, limit } = req.query;
        const messages = await listMessages(req.conversation._id.toString(), { page, limit });
        res.json({ success: true, messages });
    } catch (error) {
        console.error('getMessages error:', error);
        res.status(500).json({ success: false, message: 'Could not load messages' });
    }
};

// POST /api/chat/conversations/:id/messages
const sendMessage = async (req, res) => {
    try {
        const { id: userId, role } = req.chatUser;
        const conversation = req.conversation;
        const receiverId = role === 'doctor' ? conversation.patientId : conversation.doctorId;

        const { message, error } = await createMessage({
            conversationId: conversation._id.toString(),
            senderId: userId,
            senderRole: role,
            receiverId,
            body: req.body,
            file: req.file,
        });

        if (error) {
            return res.status(400).json({ success: false, message: error });
        }

        emitToConversation(conversation._id.toString(), 'chat:message-sent', message, receiverId);

        res.json({ success: true, message });
    } catch (error) {
        console.error('sendMessage error:', error);
        res.status(500).json({ success: false, message: 'Could not send message' });
    }
};

// PATCH /api/chat/conversations/:id/read
const markConversationAsRead = async (req, res) => {
    try {
        const { id: userId, role } = req.chatUser;
        const conversationId = req.conversation._id.toString();
        const updatedCount = await markConversationRead(conversationId, userId);

        if (updatedCount > 0) {
            const receiverId = role === 'doctor' ? req.conversation.patientId : req.conversation.doctorId;
            emitToConversation(conversationId, 'chat:message-read', {
                conversationId,
                readerId: userId,
                readerRole: role,
            }, receiverId);
        }

        res.json({ success: true, updatedCount });
    } catch (error) {
        console.error('markConversationAsRead error:', error);
        res.status(500).json({ success: false, message: 'Could not update read status' });
    }
};

// PATCH /api/chat/messages/:id/read
const markMessageAsRead = async (req, res) => {
    try {
        const { id: userId } = req.chatUser;
        const message = await markSingleMessageRead(req.params.id, userId);

        if (!message) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }

        res.json({ success: true, message });
    } catch (error) {
        console.error('markMessageAsRead error:', error);
        res.status(500).json({ success: false, message: 'Could not update read status' });
    }
};

// DELETE /api/chat/messages/:id
const deleteMessage = async (req, res) => {
    try {
        const { id: userId } = req.chatUser;
        const message = await softDeleteMessage(req.params.id, userId);

        if (!message) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }

        emitToConversation(message.conversationId, 'chat:message-deleted', {
            messageId: message._id.toString(),
            conversationId: message.conversationId,
        });

        res.json({ success: true, message: 'Message deleted' });
    } catch (error) {
        console.error('deleteMessage error:', error);
        res.status(500).json({ success: false, message: 'Could not delete message' });
    }
};

export {
    startConversation,
    getConversations,
    getConversation,
    getMessages,
    sendMessage,
    markConversationAsRead,
    markMessageAsRead,
    deleteMessage,
};
