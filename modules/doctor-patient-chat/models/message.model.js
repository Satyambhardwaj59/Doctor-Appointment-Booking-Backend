import mongoose from 'mongoose';
import { SENDER_ROLES, MESSAGE_TYPES, MESSAGE_STATUS } from '../types/chat.types.js';

const attachmentSchema = new mongoose.Schema({
    url: { type: String, required: true },
    // Cloudinary public_id, kept so a future "delete attachment" feature
    // could remove the asset from Cloudinary without re-deriving it from
    // the URL. We deliberately don't store any local filesystem path.
    publicId: { type: String, default: '' },
    fileName: { type: String, default: '' },
    fileType: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
}, { _id: false });

const messageSchema = new mongoose.Schema({
    conversationId: { type: String, required: true, index: true },
    senderId: { type: String, required: true },
    senderRole: { type: String, enum: SENDER_ROLES, required: true },
    receiverId: { type: String, required: true },
    messageType: { type: String, enum: MESSAGE_TYPES, default: 'TEXT' },
    content: { type: String, default: '' },
    attachment: { type: attachmentSchema, default: null },
    status: { type: String, enum: MESSAGE_STATUS, default: 'SENT' },
    readAt: { type: Date, default: null },
    // Soft delete: healthcare conversations shouldn't lose history from a
    // hard delete. A deleted message's content/attachment are still
    // available at the DB level but hidden by the service layer, which
    // returns a "message deleted" placeholder to clients instead.
    isDeleted: { type: Boolean, default: false },
}, { timestamps: true, minimize: false });

messageSchema.index({ conversationId: 1, createdAt: -1 });

const messageModel = mongoose.models.message || mongoose.model('message', messageSchema);

export default messageModel;
