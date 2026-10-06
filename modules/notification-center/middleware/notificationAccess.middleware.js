import { getOwnedNotification } from '../services/notification.service.js';

const verifyNotificationAccess = async (req, res, next) => {
    try {
        const { id: userId, role } = req.chatUser;
        const notification = await getOwnedNotification(req.params.id, userId, role);

        if (!notification) {
            return res.json({ success: false, message: 'Notification not found' });
        }

        req.notification = notification;
        next();
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Notification not found' });
    }
};

export { verifyNotificationAccess };
