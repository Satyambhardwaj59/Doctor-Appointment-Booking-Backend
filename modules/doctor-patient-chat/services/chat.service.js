import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';
import conversationModel from '../models/conversation.model.js';
import messageModel from '../models/message.model.js';
import appointmentModel from '../../../models/appointmentModel.js';
import doctorModel from '../../../models/doctorModel.js';
import userModel from '../../../models/userModel.js';
import { validateMessagePayload, validateAttachmentFile } from '../validators/chat.validator.js';
import { DEFAULT_MESSAGES_PAGE_SIZE } from '../types/chat.types.js';

// Helper to sanitize doctor payload
const formatDocData = (doctor) => {
    if (!doctor) return null;
    return {
        _id: doctor._id?.toString() || doctor._id,
        name: doctor.name,
        image: doctor.image,
        speciality: doctor.speciality,
        degree: doctor.degree,
        experience: doctor.experience,
        fees: doctor.fees,
        available: doctor.available,
    };
};

// Helper to sanitize user payload
const formatUserData = (user) => {
    if (!user) return null;
    return {
        _id: user._id?.toString() || user._id,
        name: user.name,
        image: user.image,
        phone: user.phone,
        dob: user.dob,
        gender: user.gender,
    };
};

// Find any appointment between patient and doctor (prioritize non-cancelled)
const hasEligibleAppointment = async (patientId, doctorId) => {
    let appointment = await appointmentModel
        .findOne({ userId: patientId, docId: doctorId, cancelled: false })
        .sort({ date: -1 });
    if (!appointment) {
        appointment = await appointmentModel
            .findOne({ userId: patientId, docId: doctorId })
            .sort({ date: -1 });
    }
    return appointment;
};

const toPublicMessage = (message) => {
    const plain = message.toObject ? message.toObject() : message;
    if (plain.isDeleted) {
        return { ...plain, content: 'This message was deleted', attachment: null };
    }
    return plain;
};

// ─── Conversations ─────────────────────────────────────────────────────────

const findOrCreateConversation = async (patientId, doctorId) => {
    const [doctor, user] = await Promise.all([
        doctorModel.findById(doctorId).select('-password').catch(() => null),
        userModel.findById(patientId).select('-password').catch(() => null),
    ]);

    if (!doctor) {
        return { conversation: null, created: false, notFound: 'Doctor not found' };
    }
    if (!user) {
        return { conversation: null, created: false, notFound: 'Patient not found' };
    }

    let conversation = await conversationModel.findOne({ doctorId, patientId });
    let created = false;

    if (!conversation) {
        const appointment = await hasEligibleAppointment(patientId, doctorId);
        conversation = await conversationModel.create({
            doctorId,
            patientId,
            appointmentId: appointment ? appointment._id.toString() : null,
        });
        created = true;
    }

    const unreadCount = await messageModel.countDocuments({
        conversationId: conversation._id.toString(),
        receiverId: patientId,
        status: { $ne: 'READ' },
        isDeleted: false,
    });

    const convObj = conversation.toObject ? conversation.toObject() : conversation;
    return {
        conversation: {
            ...convObj,
            unreadCount,
            docData: formatDocData(doctor),
            userData: formatUserData(user),
        },
        created,
    };
};

const listConversationsForUser = async (userId, role) => {
    const filter = role === 'doctor' ? { doctorId: userId } : { patientId: userId };
    const conversations = await conversationModel.find(filter).sort({ updatedAt: -1 });

    const withDetails = await Promise.all(
        conversations.map(async (conversation) => {
            const [unreadCount, doctor, user] = await Promise.all([
                messageModel.countDocuments({
                    conversationId: conversation._id.toString(),
                    receiverId: userId,
                    status: { $ne: 'READ' },
                    isDeleted: false,
                }),
                doctorModel.findById(conversation.doctorId).select('-password').catch(() => null),
                userModel.findById(conversation.patientId).select('-password').catch(() => null),
            ]);

            return {
                ...conversation.toObject(),
                unreadCount,
                docData: formatDocData(doctor),
                userData: formatUserData(user),
            };
        })
    );

    return withDetails;
};

const getOwnedConversation = async (conversationId, userId, role) => {
    const conversation = await conversationModel.findById(conversationId).catch(() => null);
    if (!conversation) return null;

    const belongs =
        (role === 'doctor' && conversation.doctorId === userId) ||
        (role === 'patient' && conversation.patientId === userId);

    if (!belongs) return null;

    const [doctor, user] = await Promise.all([
        doctorModel.findById(conversation.doctorId).select('-password').catch(() => null),
        userModel.findById(conversation.patientId).select('-password').catch(() => null),
    ]);

    const convObj = conversation.toObject ? conversation.toObject() : conversation;
    return {
        ...convObj,
        docData: formatDocData(doctor),
        userData: formatUserData(user),
    };
};

const getConversationById = async (conversationId) => {
    return conversationModel.findById(conversationId).catch(() => null);
};

// ─── Messages ───────────────────────────────────────────────────────────────

const listMessages = async (conversationId, { page = 1, limit = DEFAULT_MESSAGES_PAGE_SIZE } = {}) => {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || DEFAULT_MESSAGES_PAGE_SIZE));

    const messages = await messageModel
        .find({ conversationId })
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit);

    return messages.reverse().map(toPublicMessage);
};

const createMessage = async ({ conversationId, senderId, senderRole, receiverId, body, file }) => {
    const payloadValidation = validateMessagePayload(body, !!file);
    if (!payloadValidation.valid) {
        if (file?.path && fs.existsSync(file.path)) {
            fs.unlink(file.path, () => {});
        }
        return { message: null, error: payloadValidation.message };
    }

    const fileValidation = validateAttachmentFile(file);
    if (!fileValidation.valid) {
        if (file?.path && fs.existsSync(file.path)) {
            fs.unlink(file.path, () => {});
        }
        return { message: null, error: fileValidation.message };
    }

    let attachment = null;
    if (file) {
        try {
            const uploadResult = await cloudinary.uploader.upload(file.path, {
                resource_type: payloadValidation.messageType === 'IMAGE' ? 'image' : 'auto',
            });
            attachment = {
                url: uploadResult.secure_url,
                publicId: uploadResult.public_id,
                fileName: file.originalname,
                fileType: file.mimetype,
                fileSize: file.size,
            };
        } finally {
            if (file?.path && fs.existsSync(file.path)) {
                fs.unlink(file.path, () => {});
            }
        }
    }

    const message = await messageModel.create({
        conversationId,
        senderId,
        senderRole,
        receiverId,
        messageType: payloadValidation.messageType,
        content: body.content || '',
        attachment,
        status: 'SENT',
    });

    await conversationModel.findByIdAndUpdate(conversationId, {
        lastMessage: payloadValidation.messageType === 'TEXT' ? message.content : `📎 ${payloadValidation.messageType}`,
        lastMessageAt: message.createdAt,
        lastMessageSender: senderRole,
    });

    return { message: toPublicMessage(message), error: null };
};

const markMessageDelivered = async (messageId) => {
    return messageModel.findOneAndUpdate(
        { _id: messageId, status: 'SENT' },
        { $set: { status: 'DELIVERED' } }
    );
};

const markConversationRead = async (conversationId, readerId) => {
    const result = await messageModel.updateMany(
        { conversationId, receiverId: readerId, status: { $ne: 'READ' }, isDeleted: false },
        { $set: { status: 'READ', readAt: new Date() } }
    );
    return result.modifiedCount || 0;
};

const markSingleMessageRead = async (messageId, readerId) => {
    return messageModel.findOneAndUpdate(
        { _id: messageId, receiverId: readerId },
        { $set: { status: 'READ', readAt: new Date() } },
        { new: true }
    );
};

const softDeleteMessage = async (messageId, requesterId) => {
    const message = await messageModel.findOne({ _id: messageId, senderId: requesterId });
    if (!message) return null;

    message.isDeleted = true;
    await message.save();
    return message;
};

export {
    findOrCreateConversation,
    listConversationsForUser,
    getOwnedConversation,
    getConversationById,
    listMessages,
    createMessage,
    markMessageDelivered,
    markConversationRead,
    markSingleMessageRead,
    softDeleteMessage,
    toPublicMessage,
};
