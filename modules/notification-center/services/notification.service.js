import notificationModel from '../models/notification.model.js';
import userModel from '../../../models/userModel.js';
import doctorModel from '../../../models/doctorModel.js';
import { emitToUser } from '../sockets/notification.socket.js';
import { sanitizeNotificationData, PREFERENCE_CATEGORIES } from '../validators/notification.validator.js';

const DEFAULT_PREFERENCES = PREFERENCE_CATEGORIES.reduce((acc, key) => {
    acc[key] = true;
    return acc;
}, {});

// SYSTEM notifications are never gated by a category preference — there is
// no "system" toggle, and account-level notices shouldn't be silenceable.
const CATEGORY_BY_TYPE = {
    APPOINTMENT: 'appointments',
    CONSULTATION: 'consultations',
    PRESCRIPTION: 'prescriptions',
    MEDICATION: 'medications',
    CHAT: 'chat',
    MEDICAL_RECORD: 'medicalRecords',
    FAMILY: 'family',
};

const profileModelFor = (role) => (role === 'doctor' ? doctorModel : userModel);

const getPreferences = async (userId, role) => {
    const profile = await profileModelFor(role)
        .findById(userId)
        .select('notificationPreferences')
        .catch(() => null);
    return { ...DEFAULT_PREFERENCES, ...(profile?.notificationPreferences || {}) };
};

const updatePreferences = async (userId, role, updates) => {
    const current = await getPreferences(userId, role);
    const next = { ...current, ...updates };
    await profileModelFor(role).findByIdAndUpdate(userId, { notificationPreferences: next });
    return next;
};

// The single entry point every other feature module calls to notify a
// user — creation, category preference gating, dedupe, and the live
// socket emit all happen here, so no feature has to reimplement any of
// this itself (see the integration points in userController.js,
// chat.service.js, prescription.service.js and medicalRecord.service.js).
//
// userId/role here are ALWAYS supplied by the calling backend service from
// data it already trusts server-side (e.g. appointment.docId, the
// authenticated sender's own id) — never anything sourced from a request
// body, so there's nothing for a caller to spoof.
const createNotification = async ({ userId, recipientRole, type, title, message, data, dedupeKey, expiresAt }) => {
    const category = CATEGORY_BY_TYPE[type];
    if (category) {
        const preferences = await getPreferences(userId, recipientRole);
        if (preferences[category] === false) return null;
    }

    if (dedupeKey) {
        const existing = await notificationModel.findOne({ userId, dedupeKey });
        if (existing) return existing;
    }

    let notification;
    try {
        notification = await notificationModel.create({
            userId,
            recipientRole,
            type,
            title,
            message,
            data: sanitizeNotificationData(data),
            dedupeKey: dedupeKey || null,
            expiresAt: expiresAt || null,
        });
    } catch (error) {
        // A dedupeKey race (two callers creating the same notification at
        // once) trips the sparse unique index — treat as already-created
        // rather than surfacing an error to the caller.
        if (error?.code === 11000) return notificationModel.findOne({ userId, dedupeKey });
        throw error;
    }

    const unreadCount = await notificationModel.countDocuments({ userId, recipientRole, isRead: false });
    emitToUser(userId, recipientRole, 'notification:new', notification);
    emitToUser(userId, recipientRole, 'notification:unread-count', { unreadCount });

    return notification;
};

const listNotifications = async (userId, role, filters = {}) => {
    const query = { userId, recipientRole: role };
    if (filters.type) query.type = filters.type;
    if (filters.isRead !== undefined) query.isRead = filters.isRead === 'true';

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));

    const [notifications, total] = await Promise.all([
        notificationModel
            .find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
        notificationModel.countDocuments(query),
    ]);

    return { notifications, total, page, limit };
};

const getUnreadCount = async (userId, role) =>
    notificationModel.countDocuments({ userId, recipientRole: role, isRead: false });

// Returns null for both "not found" and "not yours".
const getOwnedNotification = async (id, userId, role) => {
    const notification = await notificationModel.findOne({ _id: id, userId, recipientRole: role }).catch(() => null);
    return notification || null;
};

const markRead = async (id, userId, role) => {
    const notification = await getOwnedNotification(id, userId, role);
    if (!notification) return null;

    if (!notification.isRead) {
        notification.isRead = true;
        notification.readAt = new Date();
        await notification.save();
        emitToUser(userId, role, 'notification:unread-count', {
            unreadCount: await getUnreadCount(userId, role),
        });
    }
    return notification;
};

const markAllRead = async (userId, role) => {
    const result = await notificationModel.updateMany(
        { userId, recipientRole: role, isRead: false },
        { $set: { isRead: true, readAt: new Date() } }
    );
    emitToUser(userId, role, 'notification:unread-count', { unreadCount: 0 });
    return result.modifiedCount || 0;
};

const deleteNotification = async (id, userId, role) => {
    const notification = await getOwnedNotification(id, userId, role);
    if (!notification) return null;
    await notification.deleteOne();
    return notification;
};

export {
    createNotification,
    listNotifications,
    getUnreadCount,
    getOwnedNotification,
    markRead,
    markAllRead,
    deleteNotification,
    getPreferences,
    updatePreferences,
};
