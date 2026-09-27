import jwt from 'jsonwebtoken';
import videoConsultationModel from '../models/videoConsultationModel.js';
import appointmentModel from '../../../models/appointmentModel.js';
import { SOCKET_EVENTS, CONSULTATION_STATUS } from '../types/videoConsultation.types.js';

// Track connected participants per room: Map<roomId, Set<socketId>>
const roomParticipants = new Map();
let activeVideoNamespace = null;

/**
 * Verify a JWT and extract user info.
 * Returns { userId, role } or throws.
 */
const verifyToken = (token, dtoken) => {
  if (dtoken) {
    const decoded = jwt.verify(dtoken, process.env.JWT_SECRET);
    if (!decoded?.id) throw new Error('Invalid doctor token');
    return { userId: decoded.id, role: 'doctor' };
  }
  if (token) {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded?.id) throw new Error('Invalid user token');
    return { userId: decoded.id, role: 'patient' };
  }
  throw new Error('No authentication token provided');
};

/**
 * Initialize the Video Consultation Socket.IO namespace.
 * Registers all `video:*` events within /video namespace.
 *
 * @param {import('socket.io').Server} io
 */
export const initVideoConsultationSocket = (io) => {
  const videoNamespace = io.of('/video');
  activeVideoNamespace = videoNamespace;

  // ── Socket Authentication Middleware ──────────────────────────────────────
  videoNamespace.use((socket, next) => {
    try {
      const { token, dtoken } = socket.handshake.auth;
      const { userId, role } = verifyToken(token, dtoken);
      socket.data.userId = userId;
      socket.data.role = role;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  // ── Connection Handler ────────────────────────────────────────────────────
  videoNamespace.on('connection', (socket) => {
    const { userId, role } = socket.data;

    // Join personal user notification rooms so direct call invites can be delivered
    socket.join(`user:${userId}`);
    socket.join(`${role}:${userId}`);

    // ── video:call-user (notify recipient) ──────────────────────────────────
    socket.on(SOCKET_EVENTS.CALL_USER, async ({ consultationId }) => {
      try {
        if (!consultationId) return;
        await emitIncomingCallNotification(consultationId, userId, role);
      } catch (err) {
        console.error('Error in video:call-user:', err);
      }
    });

    // ── video:reject-call ──────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.REJECT_CALL, ({ consultationId, callerId, callerRole }) => {
      if (callerId) {
        videoNamespace.to(`user:${callerId}`).emit(SOCKET_EVENTS.CALL_REJECTED, {
          consultationId,
          rejectedBy: userId,
        });
        if (callerRole) {
          videoNamespace.to(`${callerRole}:${callerId}`).emit(SOCKET_EVENTS.CALL_REJECTED, {
            consultationId,
            rejectedBy: userId,
          });
        }
      }
    });

    // ── video:join-room ───────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.JOIN_ROOM, async ({ consultationId }) => {
      try {
        const consultation = await videoConsultationModel.findById(consultationId);

        if (!consultation) {
          socket.emit(SOCKET_EVENTS.ERROR, { message: 'Consultation not found' });
          return;
        }

        // Verify this socket user owns this consultation
        const isOwner =
          (role === 'patient' && consultation.patientId === userId) ||
          (role === 'doctor' && consultation.doctorId === userId);

        if (!isOwner) {
          socket.emit(SOCKET_EVENTS.ERROR, { message: 'Access denied' });
          return;
        }

        // Cannot join completed/cancelled consultations via socket
        if ([CONSULTATION_STATUS.COMPLETED, CONSULTATION_STATUS.CANCELLED].includes(consultation.status)) {
          socket.emit(SOCKET_EVENTS.ERROR, { message: 'This consultation is no longer active' });
          return;
        }

        const roomId = consultation.roomId;
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.consultationId = consultationId;

        // Track participants
        if (!roomParticipants.has(roomId)) {
          roomParticipants.set(roomId, new Set());
        }
        roomParticipants.get(roomId).add(socket.id);

        const participantCount = roomParticipants.get(roomId).size;

        // Notify other participants in the room
        socket.to(roomId).emit(SOCKET_EVENTS.USER_JOINED, {
          userId,
          role,
          socketId: socket.id,
          participantCount,
        });

        // Confirm to the joining socket
        socket.emit(SOCKET_EVENTS.CONNECTION_STATUS, {
          status: 'joined',
          roomId,
          participantCount,
          role,
        });
      } catch {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to join room' });
      }
    });

    // ── WebRTC Signaling — relay only, never stored ───────────────────────

    socket.on(SOCKET_EVENTS.OFFER, ({ offer, targetSocketId }) => {
      if (!socket.data.roomId) return;
      if (targetSocketId) {
        videoNamespace.to(targetSocketId).emit(SOCKET_EVENTS.OFFER, {
          offer,
          fromSocketId: socket.id,
        });
      } else {
        socket.to(socket.data.roomId).emit(SOCKET_EVENTS.OFFER, {
          offer,
          fromSocketId: socket.id,
        });
      }
    });

    socket.on(SOCKET_EVENTS.ANSWER, ({ answer, targetSocketId }) => {
      if (!socket.data.roomId) return;
      if (targetSocketId) {
        videoNamespace.to(targetSocketId).emit(SOCKET_EVENTS.ANSWER, {
          answer,
          fromSocketId: socket.id,
        });
      } else {
        socket.to(socket.data.roomId).emit(SOCKET_EVENTS.ANSWER, {
          answer,
          fromSocketId: socket.id,
        });
      }
    });

    socket.on(SOCKET_EVENTS.ICE_CANDIDATE, ({ candidate, targetSocketId }) => {
      if (!socket.data.roomId) return;
      if (targetSocketId) {
        videoNamespace.to(targetSocketId).emit(SOCKET_EVENTS.ICE_CANDIDATE, {
          candidate,
          fromSocketId: socket.id,
        });
      } else {
        socket.to(socket.data.roomId).emit(SOCKET_EVENTS.ICE_CANDIDATE, {
          candidate,
          fromSocketId: socket.id,
        });
      }
    });

    // ── video:call-ended ──────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.CALL_ENDED, async () => {
      const { roomId, consultationId } = socket.data;
      if (!roomId) return;

      // Update consultation status to COMPLETED
      try {
        const consultation = await videoConsultationModel.findById(consultationId);
        if (consultation && consultation.status === CONSULTATION_STATUS.ACTIVE) {
          const endedAt = new Date();
          let duration = null;
          if (consultation.startedAt) {
            const ms = endedAt.getTime() - new Date(consultation.startedAt).getTime();
            duration = Math.round(ms / 60000);
          }
          await videoConsultationModel.findByIdAndUpdate(consultationId, {
            status: CONSULTATION_STATUS.COMPLETED,
            endedAt,
            duration,
          });
        }
      } catch {
        // Silently handle — the HTTP endpoint can also end the consultation
      }

      socket.to(roomId).emit(SOCKET_EVENTS.CALL_ENDED, { userId, role });
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const { roomId } = socket.data;
      if (!roomId) return;

      const participants = roomParticipants.get(roomId);
      if (participants) {
        participants.delete(socket.id);
        if (participants.size === 0) {
          roomParticipants.delete(roomId);
        } else {
          socket.to(roomId).emit(SOCKET_EVENTS.USER_LEFT, {
            userId,
            role,
            socketId: socket.id,
            participantCount: participants.size,
          });
        }
      }
    });
  });
};

/**
 * Emit an incoming call notification to the recipient participant.
 * Can be called from HTTP endpoints or internal socket events.
 */
export const emitIncomingCallNotification = async (consultationId, callerId, callerRole) => {
  if (!activeVideoNamespace) return;
  try {
    const consultation = await videoConsultationModel.findById(consultationId);
    if (!consultation) return;
    const appointment = await appointmentModel.findById(consultation.appointmentId);
    if (!appointment) return;

    const isDoc = callerRole === 'doctor';
    const recipientId = isDoc ? consultation.patientId : consultation.doctorId;
    const recipientRole = isDoc ? 'patient' : 'doctor';

    const callPayload = {
      consultationId: consultation._id.toString(),
      roomId: consultation.roomId,
      appointmentId: consultation.appointmentId.toString(),
      callerId,
      callerRole,
      callerName: isDoc ? (appointment.docData?.name || 'Doctor') : (appointment.userData?.name || 'Patient'),
      callerImage: isDoc ? appointment.docData?.image : appointment.userData?.image,
      callerSpeciality: isDoc ? appointment.docData?.speciality : undefined,
      timestamp: new Date().toISOString(),
    };

    activeVideoNamespace.to(`user:${recipientId}`).emit(SOCKET_EVENTS.INCOMING_CALL, callPayload);
    activeVideoNamespace.to(`${recipientRole}:${recipientId}`).emit(SOCKET_EVENTS.INCOMING_CALL, callPayload);
  } catch (err) {
    console.error('Error emitting incoming call notification:', err);
  }
};

