import videoConsultationRouter from './routes/videoConsultation.routes.js';
import { initVideoConsultationSocket, emitIncomingCallNotification } from './sockets/videoConsultation.socket.js';

export { videoConsultationRouter, initVideoConsultationSocket, emitIncomingCallNotification };
