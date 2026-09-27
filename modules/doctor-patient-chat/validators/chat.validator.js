import {
    MESSAGE_TYPES,
    MAX_MESSAGE_LENGTH,
    ALLOWED_ATTACHMENT_MIME_TYPES,
    MAX_ATTACHMENT_SIZE_BYTES,
} from '../types/chat.types.js';

// Validates the text/type portion of an outgoing message. File-specific
// checks live in validateAttachmentFile below, since a message might be
// TEXT-only (no file on the request) or IMAGE/FILE (file required).
const validateMessagePayload = (body, hasFile) => {
    const messageType = body.messageType || 'TEXT';

    if (!MESSAGE_TYPES.includes(messageType)) {
        return { valid: false, message: 'Invalid message type' };
    }

    if (messageType === 'TEXT') {
        if (!body.content || !body.content.trim()) {
            return { valid: false, message: 'Message cannot be empty' };
        }
        if (body.content.length > MAX_MESSAGE_LENGTH) {
            return { valid: false, message: `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters` };
        }
    } else {
        // IMAGE / FILE messages require an actual uploaded file.
        if (!hasFile) {
            return { valid: false, message: 'An attachment is required for this message type' };
        }
        if (body.content && body.content.length > MAX_MESSAGE_LENGTH) {
            return { valid: false, message: `Caption cannot exceed ${MAX_MESSAGE_LENGTH} characters` };
        }
    }

    return { valid: true, messageType };
};

// Validates an uploaded attachment (multer file object) before it's sent
// to Cloudinary. Rejects disallowed mime types and oversized files.
const validateAttachmentFile = (file) => {
    if (!file) return { valid: true };

    if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.mimetype)) {
        return { valid: false, message: 'File type not allowed' };
    }

    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        return { valid: false, message: 'File exceeds the 10MB size limit' };
    }

    return { valid: true };
};

export { validateMessagePayload, validateAttachmentFile };
