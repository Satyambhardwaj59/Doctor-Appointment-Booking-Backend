// Shared enums/constants for the Doctor-Patient Chat feature.
// Centralized here so the model, validator, service, controller and socket
// layers all reference the same values instead of duplicating string literals.

export const SENDER_ROLES = ['doctor', 'patient'];

export const MESSAGE_TYPES = ['TEXT', 'IMAGE', 'FILE'];

export const MESSAGE_STATUS = ['SENT', 'DELIVERED', 'READ'];

// Kept small and conservative: images + common document types. No
// executables, scripts, or archives — chat attachments should never be
// able to deliver a runnable payload.
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_MESSAGE_LENGTH = 2000;

export const DEFAULT_MESSAGES_PAGE_SIZE = 30;

// Socket.IO namespace + event names, shared between the socket handler
// registration and (documented here for) the frontend client.
export const CHAT_NAMESPACE = '/chat';

export const SOCKET_EVENTS = {
    JOIN: 'chat:join',
    JOINED: 'chat:joined',
    LEAVE: 'chat:leave',
    MESSAGE: 'chat:message',
    MESSAGE_SENT: 'chat:message-sent',
    MESSAGE_DELIVERED: 'chat:message-delivered',
    MESSAGE_READ: 'chat:message-read',
    TYPING: 'chat:typing',
    STOP_TYPING: 'chat:stop-typing',
    USER_ONLINE: 'chat:user-online',
    USER_OFFLINE: 'chat:user-offline',
    MESSAGE_DELETED: 'chat:message-deleted',
    ERROR: 'chat:error',
};
