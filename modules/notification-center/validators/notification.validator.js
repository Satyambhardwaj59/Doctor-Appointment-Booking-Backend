import { NOTIFICATION_TYPES } from '../models/notification.model.js';

export const PREFERENCE_CATEGORIES = [
    'appointments',
    'consultations',
    'prescriptions',
    'medications',
    'chat',
    'medicalRecords',
    'family',
];

// The only keys createNotification's `data` payload may ever carry. This
// keeps notifications navigation-only — no diagnosis, medicine names,
// message content, etc. — per the feature's security requirement not to
// expose sensitive medical information inside a notification.
const ALLOWED_DATA_KEYS = [
    'appointmentId',
    'consultationId',
    'prescriptionId',
    'medicationId',
    'conversationId',
    'recordId',
    'familyMemberId',
    'queueId',
    'doctorId',
    'patientId',
];

const sanitizeNotificationData = (data = {}) => {
    const clean = {};
    for (const key of ALLOWED_DATA_KEYS) {
        if (data[key] !== undefined && data[key] !== null) {
            clean[key] = String(data[key]);
        }
    }
    return clean;
};

const validateListFilters = (query) => {
    if (query.type && !NOTIFICATION_TYPES.includes(query.type)) {
        return { valid: false, message: `type must be one of ${NOTIFICATION_TYPES.join(', ')}` };
    }
    if (query.isRead !== undefined && !['true', 'false'].includes(query.isRead)) {
        return { valid: false, message: 'isRead must be true or false' };
    }
    return { valid: true };
};

const validatePreferencesUpdate = (body) => {
    const keys = Object.keys(body || {});
    if (keys.length === 0) {
        return { valid: false, message: 'No preference fields provided' };
    }
    for (const key of keys) {
        if (!PREFERENCE_CATEGORIES.includes(key)) {
            return { valid: false, message: `Unknown preference category: ${key}` };
        }
        if (typeof body[key] !== 'boolean') {
            return { valid: false, message: `${key} must be true or false` };
        }
    }
    return { valid: true };
};

export { sanitizeNotificationData, validateListFilters, validatePreferencesUpdate };
