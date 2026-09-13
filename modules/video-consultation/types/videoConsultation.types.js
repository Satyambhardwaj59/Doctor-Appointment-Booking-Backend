/**
 * @typedef {'UPCOMING' | 'WAITING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'} ConsultationStatus
 * @typedef {'patient' | 'doctor'} UserRole
 *
 * @typedef {Object} ConsultationParticipant
 * @property {string} id
 * @property {UserRole} role
 *
 * @typedef {Object} JoinWindowConfig
 * @property {number} doctorMinutesBefore
 * @property {number} patientMinutesBefore
 */

export const CONSULTATION_STATUS = {
  UPCOMING: 'UPCOMING',
  WAITING: 'WAITING',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
};

export const USER_ROLE = {
  PATIENT: 'patient',
  DOCTOR: 'doctor',
};

// Socket event names — single source of truth
export const SOCKET_EVENTS = {
  JOIN_ROOM: 'video:join-room',
  USER_JOINED: 'video:user-joined',
  USER_LEFT: 'video:user-left',
  OFFER: 'video:offer',
  ANSWER: 'video:answer',
  ICE_CANDIDATE: 'video:ice-candidate',
  CALL_ENDED: 'video:call-ended',
  CONNECTION_STATUS: 'video:connection-status',
  ERROR: 'video:error',
};
