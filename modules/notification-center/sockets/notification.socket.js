import jwt from 'jsonwebtoken';

const NOTIFICATION_NAMESPACE = '/notifications';

const userRoom = (role, userId) => `notify:${role}:${userId}`;

let activeNamespace = null;

// Lets any other feature's service (chat, prescriptions, medical records,
// appointments, ...) push a live update without importing socket.io
// directly or creating another server — they only ever call
// notification.service.js's createNotification, which uses this.
const emitToUser = (userId, role, event, payload) => {
    if (!activeNamespace) return;
    activeNamespace.to(userRoom(role, userId)).emit(event, payload);
};

// Registers the /notifications namespace onto the app's single shared
// Socket.IO server (created once in Server.js, reused by chat too).
const registerNotificationNamespace = (io) => {
    const notificationNamespace = io.of(NOTIFICATION_NAMESPACE);
    activeNamespace = notificationNamespace;

    // Same dual-role JWT handshake auth as the chat namespace: a socket
    // that fails this never reaches 'connection'.
    notificationNamespace.use((socket, next) => {
        try {
            const { token, dtoken } = socket.handshake.auth || {};

            if (dtoken) {
                const decoded = jwt.verify(dtoken, process.env.JWT_SECRET);
                socket.notifyUser = { id: decoded.id, role: 'doctor' };
                return next();
            }
            if (token) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                socket.notifyUser = { id: decoded.id, role: 'patient' };
                return next();
            }
            next(new Error('Authentication required'));
        } catch (error) {
            next(new Error('Invalid or expired token'));
        }
    });

    notificationNamespace.on('connection', (socket) => {
        const { id, role } = socket.notifyUser;
        // No client-specified room to join here (unlike chat's per-
        // conversation join) — the only room a socket can ever be in is
        // its own, derived entirely from its verified identity. This is
        // what "prevent unauthorized subscriptions" reduces to for this
        // feature: there is nothing else to subscribe to.
        socket.join(userRoom(role, id));
    });

    return notificationNamespace;
};

export default registerNotificationNamespace;
export { emitToUser, userRoom };
