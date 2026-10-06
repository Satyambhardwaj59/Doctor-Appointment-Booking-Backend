import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = [
    'APPOINTMENT',
    'CONSULTATION',
    'PRESCRIPTION',
    'MEDICATION',
    'CHAT',
    'MEDICAL_RECORD',
    'FAMILY',
    'SYSTEM',
];

const notificationSchema = new mongoose.Schema({
    // Recipient identity. Stored as a plain String id (matches the app's
    // convention elsewhere) plus the role, since patient and doctor ids
    // come from separate collections/tokens.
    userId: { type: String, required: true, index: true },
    recipientRole: { type: String, enum: ['doctor', 'patient'], required: true },

    type: { type: String, enum: NOTIFICATION_TYPES, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    // Only the minimum needed to navigate to the related feature, e.g.
    // { conversationId }, { prescriptionId }, { recordId }, { appointmentId }.
    // Never store clinical detail here — see the validator's allow-list.
    data: { type: Object, default: {} },

    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },

    // Optional idempotency key for "prevent duplicate notifications where
    // possible" (e.g. one MEDICATION-missed notification per dose entry).
    // Sparse so notifications without a key don't collide with each other.
    dedupeKey: { type: String, default: null },

    // Optional TTL (e.g. appointment reminders lose relevance after the
    // appointment time passes). Not set by default.
    expiresAt: { type: Date, default: null },
}, { timestamps: true, minimize: false });

notificationSchema.index({ userId: 1, recipientRole: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true, sparse: true });
// MongoDB TTL index: documents are removed automatically once expiresAt
// passes, when set. Absent for notifications with no expiresAt (null).
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const notificationModel =
    mongoose.models.notification || mongoose.model('notification', notificationSchema);

export default notificationModel;
