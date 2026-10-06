import express from 'express';
import {
    getNotifications,
    getUnreadCountHandler,
    markNotificationRead,
    markAllNotificationsRead,
    removeNotification,
    getNotificationPreferences,
    patchNotificationPreferences,
} from '../controllers/notification.controller.js';
import { verifyNotificationAccess } from '../middleware/notificationAccess.middleware.js';
import { authChatIdentity } from '../../doctor-patient-chat/index.js';

const notificationRouter = express.Router();

notificationRouter.get('/unread-count', authChatIdentity, getUnreadCountHandler);
notificationRouter.patch('/read-all', authChatIdentity, markAllNotificationsRead);
notificationRouter.get('/preferences', authChatIdentity, getNotificationPreferences);
notificationRouter.patch('/preferences', authChatIdentity, patchNotificationPreferences);

notificationRouter.get('/', authChatIdentity, getNotifications);
notificationRouter.patch('/:id/read', authChatIdentity, verifyNotificationAccess, markNotificationRead);
notificationRouter.delete('/:id', authChatIdentity, verifyNotificationAccess, removeNotification);

export default notificationRouter;
