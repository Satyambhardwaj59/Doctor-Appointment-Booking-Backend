import express from 'express';
import {
    startConversation,
    getConversations,
    getConversation,
    getMessages,
    sendMessage,
    markConversationAsRead,
    markMessageAsRead,
    deleteMessage,
} from '../controllers/chat.controller.js';
import { authChatIdentity, verifyConversationAccess } from '../middleware/chatAccess.middleware.js';
import upload from '../../../middleware/multer.js';

const chatRouter = express.Router();

chatRouter.post('/conversations', authChatIdentity, startConversation);
chatRouter.get('/conversations', authChatIdentity, getConversations);
chatRouter.get('/conversations/:id', authChatIdentity, verifyConversationAccess, getConversation);
chatRouter.get('/conversations/:id/messages', authChatIdentity, verifyConversationAccess, getMessages);
chatRouter.post(
    '/conversations/:id/messages',
    authChatIdentity,
    verifyConversationAccess,
    upload.single('attachment'),
    sendMessage
);
chatRouter.patch('/conversations/:id/read', authChatIdentity, verifyConversationAccess, markConversationAsRead);
chatRouter.patch('/messages/:id/read', authChatIdentity, markMessageAsRead);
chatRouter.delete('/messages/:id', authChatIdentity, deleteMessage);

export default chatRouter;
