import jwt from 'jsonwebtoken';
import doctorModel from '../../../models/doctorModel.js';
import { getOwnedConversation } from '../services/chat.service.js';

// Chat endpoints are shared between doctors and patients.
// Normalizes authentication into req.chatUser = { id, role: 'doctor' | 'patient' }.
const authChatIdentity = async (req, res, next) => {
    try {
        const { token, dtoken } = req.headers;
        const authHeader = req.headers.authorization;
        let bearerToken = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            bearerToken = authHeader.split(' ')[1];
        }

        if (dtoken) {
            const decoded = jwt.verify(dtoken, process.env.JWT_SECRET);
            req.chatUser = { id: decoded.id, role: 'doctor' };
            return next();
        }

        const effectiveToken = token || bearerToken;
        if (effectiveToken) {
            const decoded = jwt.verify(effectiveToken, process.env.JWT_SECRET);
            let role = decoded.role || 'patient';
            if (role !== 'doctor') {
                const isDoc = await doctorModel.exists({ _id: decoded.id });
                if (isDoc) role = 'doctor';
            }
            req.chatUser = { id: decoded.id, role };
            return next();
        }

        return res.status(401).json({ success: false, message: 'Not Authorized. Please login again.' });
    } catch (error) {
        console.error('Chat auth error:', error.message);
        return res.status(401).json({ success: false, message: 'Not Authorized. Please login again.' });
    }
};

const verifyConversationAccess = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { id: userId, role } = req.chatUser;

        const conversation = await getOwnedConversation(id, userId, role);

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        req.conversation = conversation;
        next();
    } catch (error) {
        console.error('Verify conversation access error:', error.message);
        res.status(404).json({ success: false, message: 'Conversation not found' });
    }
};

export { authChatIdentity, verifyConversationAccess };
