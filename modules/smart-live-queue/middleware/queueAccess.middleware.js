import queueModel from '../models/queue.model.js';
import { isValidId } from '../validators/queue.validator.js';

// Identity (req.chatUser = { id, role }) comes from the shared dual-role JWT
// middleware reused from the chat module.
const requireRole = (role, message) => (req, res, next) => {
    if (req.chatUser?.role !== role) {
        return res.json({ success: false, message });
    }
    next();
};

// Verifies the queue in the URL belongs to the authenticated doctor.
// "Not found" and "not yours" are indistinguishable to the caller.
const verifyQueueOwnership = async (req, res, next) => {
    try {
        const { queueId } = req.params;
        if (!isValidId(queueId)) {
            return res.json({ success: false, message: 'Queue not found' });
        }

        const queue = await queueModel.findOne({ _id: queueId, doctorId: req.chatUser.id });
        if (!queue) {
            return res.json({ success: false, message: 'Queue not found' });
        }

        req.queue = queue;
        next();
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Queue not found' });
    }
};

export { requireRole, verifyQueueOwnership };
