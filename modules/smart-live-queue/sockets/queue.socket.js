import jwt from 'jsonwebtoken';

const QUEUE_NAMESPACE = '/queue';

const userRoom = (role, userId) => `queue:${role}:${userId}`;

let activeNamespace = null;

const emitToUser = (userId, role, event, payload) => {
    if (!activeNamespace) return;
    activeNamespace.to(userRoom(role, userId)).emit(event, payload);
};

const registerQueueNamespace = (io) => {
    const queueNamespace = io.of(QUEUE_NAMESPACE);
    activeNamespace = queueNamespace;

    queueNamespace.use((socket, next) => {
        try {
            const { token, dtoken } = socket.handshake.auth || {};

            if (dtoken) {
                const decoded = jwt.verify(dtoken, process.env.JWT_SECRET);
                socket.queueUser = { id: decoded.id, role: 'doctor' };
                return next();
            }
            if (token) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                socket.queueUser = { id: decoded.id, role: 'patient' };
                return next();
            }
            next(new Error('Authentication required'));
        } catch (error) {
            next(new Error('Invalid or expired token'));
        }
    });

    queueNamespace.on('connection', (socket) => {
        const { id, role } = socket.queueUser;
        // No client-specified rooms: a socket can only ever be in its own
        // room, so there is nothing for it to subscribe to illegitimately.
        socket.join(userRoom(role, id));
    });

    return queueNamespace;
};

export default registerQueueNamespace;
export { emitToUser, userRoom };
