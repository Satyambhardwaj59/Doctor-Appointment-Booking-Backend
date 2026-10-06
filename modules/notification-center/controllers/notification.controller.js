import {
    listNotifications,
    getUnreadCount,
    markRead,
    markAllRead,
    deleteNotification,
    getPreferences,
    updatePreferences,
} from '../services/notification.service.js';
import { validateListFilters, validatePreferencesUpdate } from '../validators/notification.validator.js';

// GET /api/notifications
const getNotifications = async (req, res) => {
    try {
        const validation = validateListFilters(req.query);
        if (!validation.valid) return res.json({ success: false, message: validation.message });

        const { id: userId, role } = req.chatUser;
        const result = await listNotifications(userId, role, req.query);
        res.json({ success: true, ...result });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not load notifications' });
    }
};

// GET /api/notifications/unread-count
const getUnreadCountHandler = async (req, res) => {
    try {
        const { id: userId, role } = req.chatUser;
        const unreadCount = await getUnreadCount(userId, role);
        res.json({ success: true, unreadCount });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not load unread count' });
    }
};

// PATCH /api/notifications/:id/read (ownership verified by middleware)
const markNotificationRead = async (req, res) => {
    try {
        const { id: userId, role } = req.chatUser;
        const notification = await markRead(req.params.id, userId, role);
        res.json({ success: true, notification });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not update notification' });
    }
};

// PATCH /api/notifications/read-all
const markAllNotificationsRead = async (req, res) => {
    try {
        const { id: userId, role } = req.chatUser;
        const updatedCount = await markAllRead(userId, role);
        res.json({ success: true, updatedCount });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not update notifications' });
    }
};

// DELETE /api/notifications/:id (ownership verified by middleware)
const removeNotification = async (req, res) => {
    try {
        const { id: userId, role } = req.chatUser;
        const notification = await deleteNotification(req.params.id, userId, role);
        if (!notification) return res.json({ success: false, message: 'Notification not found' });
        res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not delete notification' });
    }
};

// GET /api/notifications/preferences
const getNotificationPreferences = async (req, res) => {
    try {
        const { id: userId, role } = req.chatUser;
        const preferences = await getPreferences(userId, role);
        res.json({ success: true, preferences });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not load preferences' });
    }
};

// PATCH /api/notifications/preferences
const patchNotificationPreferences = async (req, res) => {
    try {
        const validation = validatePreferencesUpdate(req.body);
        if (!validation.valid) return res.json({ success: false, message: validation.message });

        const { id: userId, role } = req.chatUser;
        const preferences = await updatePreferences(userId, role, req.body);
        res.json({ success: true, preferences });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not update preferences' });
    }
};

export {
    getNotifications,
    getUnreadCountHandler,
    markNotificationRead,
    markAllNotificationsRead,
    removeNotification,
    getNotificationPreferences,
    patchNotificationPreferences,
};
