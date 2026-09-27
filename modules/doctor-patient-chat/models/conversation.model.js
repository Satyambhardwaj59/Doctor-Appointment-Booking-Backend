import mongoose from 'mongoose';
import { SENDER_ROLES } from '../types/chat.types.js';

const conversationSchema = new mongoose.Schema({
    // Stored as plain Strings to match the existing convention used by
    // appointmentModel (userId/docId are Strings, not ObjectId refs).
    doctorId: { type: String, required: true, index: true },
    patientId: { type: String, required: true, index: true },
    // The appointment that established the doctor-patient relationship
    // this conversation is based on. Nullable: a conversation can outlive
    // the specific appointment that started it (see chat.service.js for
    // the eligibility rule).
    appointmentId: { type: String, default: null },
    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: null },
    lastMessageSender: { type: String, enum: SENDER_ROLES, default: null },
}, { timestamps: true, minimize: false });

// A doctor and patient share at most one conversation.
conversationSchema.index({ doctorId: 1, patientId: 1 }, { unique: true });

const conversationModel =
    mongoose.models.conversation || mongoose.model('conversation', conversationSchema);

export default conversationModel;
