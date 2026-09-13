import { v4 as uuidv4 } from 'uuid';
import videoConsultationModel from '../models/videoConsultationModel.js';
import appointmentModel from '../../../models/appointmentModel.js';
import { CONSULTATION_STATUS } from '../types/videoConsultation.types.js';

// Configurable join windows (minutes before appointment)
const DOCTOR_JOIN_WINDOW_MINUTES = parseInt(process.env.VIDEO_CONSULTATION_JOIN_WINDOW_DOCTOR || '15', 10);
const PATIENT_JOIN_WINDOW_MINUTES = parseInt(process.env.VIDEO_CONSULTATION_JOIN_WINDOW_PATIENT || '10', 10);

// Consultation expires if not joined 30 minutes after appointment time
const EXPIRY_MINUTES_AFTER = 30;

/**
 * Parse slot date/time from the appointment format ("13_9_2026", "10:30 am")
 * into a JavaScript Date object.
 */
const parseAppointmentDateTime = (slotDate, slotTime) => {
  // slotDate format: "day_month_year"
  const [day, month, year] = slotDate.split('_').map(Number);

  // slotTime format: "10:30 am" or "2:00 pm"
  const [timePart, meridian] = slotTime.trim().toLowerCase().split(' ');
  let [hours, minutes] = timePart.split(':').map(Number);

  if (meridian === 'pm' && hours !== 12) hours += 12;
  if (meridian === 'am' && hours === 12) hours = 0;

  // month is 1-indexed in slotDate, Date uses 0-indexed
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
};

/**
 * Check if the current time falls within the allowed join window for a role.
 */
const isWithinJoinWindow = (appointmentDate, role) => {
  const now = new Date();
  const windowMinutes = role === 'doctor' ? DOCTOR_JOIN_WINDOW_MINUTES : PATIENT_JOIN_WINDOW_MINUTES;

  const earliestJoin = new Date(appointmentDate.getTime() - windowMinutes * 60 * 1000);
  const latestJoin = new Date(appointmentDate.getTime() + EXPIRY_MINUTES_AFTER * 60 * 1000);

  return now >= earliestJoin && now <= latestJoin;
};

/**
 * Create a new video consultation for an appointment.
 * Both patient and doctor assigned to the appointment can initiate it.
 */
export const createConsultation = async (appointmentId, requesterId, role = 'patient') => {
  // Verify the appointment exists and belongs to this participant
  const appointment = await appointmentModel.findById(appointmentId);

  if (!appointment) {
    throw { statusCode: 404, message: 'Appointment not found' };
  }

  const isOwner = role === 'doctor'
    ? appointment.docId?.toString() === requesterId?.toString()
    : appointment.userId?.toString() === requesterId?.toString();

  if (!isOwner) {
    throw { statusCode: 403, message: 'You do not have access to this appointment' };
  }

  if (appointment.cancelled) {
    throw { statusCode: 400, message: 'Cannot create consultation for a cancelled appointment' };
  }

  // Idempotent — return existing consultation if already created
  const existing = await videoConsultationModel.findOne({ appointmentId });
  if (existing) {
    return existing;
  }

  // Generate a secure, random, non-guessable room ID
  const roomId = uuidv4();

  const consultation = new videoConsultationModel({
    appointmentId,
    doctorId: appointment.docId,
    patientId,
    roomId,
    status: CONSULTATION_STATUS.UPCOMING,
  });

  await consultation.save();
  return consultation;
};

/**
 * Get a consultation by ID with role-based authorization.
 * The consultation document is pre-attached by consultationAccess middleware,
 * so this service layer can simply return it (or fetch additional data).
 */
export const getConsultation = async (consultationId) => {
  const consultation = await videoConsultationModel.findById(consultationId);
  if (!consultation) {
    throw { statusCode: 404, message: 'Consultation not found' };
  }
  return consultation;
};

/**
 * Validate whether a user can join the consultation right now.
 * Returns the updated consultation with status updated to WAITING if valid.
 */
export const joinConsultation = async (consultation, role) => {
  // Fetch the appointment to parse time
  const appointment = await appointmentModel.findById(consultation.appointmentId);
  if (!appointment) {
    throw { statusCode: 404, message: 'Related appointment not found' };
  }

  // Can't join already completed/cancelled consultations
  if ([CONSULTATION_STATUS.COMPLETED, CONSULTATION_STATUS.CANCELLED].includes(consultation.status)) {
    throw {
      statusCode: 400,
      message:
        consultation.status === CONSULTATION_STATUS.COMPLETED
          ? 'This consultation has already ended'
          : 'This consultation has been cancelled',
    };
  }

  const appointmentDate = parseAppointmentDateTime(appointment.slotDate, appointment.slotTime);

  // Server is the source of truth for time window
  if (!isWithinJoinWindow(appointmentDate, role)) {
    const now = new Date();
    if (now < new Date(appointmentDate.getTime() - DOCTOR_JOIN_WINDOW_MINUTES * 60 * 1000)) {
      throw {
        statusCode: 400,
        message: `Too early to join. You can join up to ${role === 'doctor' ? DOCTOR_JOIN_WINDOW_MINUTES : PATIENT_JOIN_WINDOW_MINUTES} minutes before the appointment.`,
      };
    } else {
      // Mark as expired if time has passed
      await videoConsultationModel.findByIdAndUpdate(consultation._id, {
        status: CONSULTATION_STATUS.EXPIRED,
      });
      throw { statusCode: 400, message: 'This consultation window has expired' };
    }
  }

  // Move to WAITING state
  if (consultation.status === CONSULTATION_STATUS.UPCOMING) {
    consultation = await videoConsultationModel.findByIdAndUpdate(
      consultation._id,
      { status: CONSULTATION_STATUS.WAITING },
      { new: true }
    );
  }

  return consultation;
};

/**
 * Start the consultation — can only be initiated by the doctor.
 * Sets status to ACTIVE and records startedAt.
 */
export const startConsultation = async (consultationId, docId) => {
  const consultation = await videoConsultationModel.findById(consultationId);
  if (!consultation) {
    throw { statusCode: 404, message: 'Consultation not found' };
  }

  if (consultation.doctorId !== docId) {
    throw { statusCode: 403, message: 'Access denied' };
  }

  if (consultation.status === CONSULTATION_STATUS.ACTIVE) {
    return consultation; // Already started — idempotent
  }

  if (consultation.status === CONSULTATION_STATUS.COMPLETED) {
    throw { statusCode: 400, message: 'This consultation has already ended' };
  }

  return await videoConsultationModel.findByIdAndUpdate(
    consultationId,
    { status: CONSULTATION_STATUS.ACTIVE, startedAt: new Date() },
    { new: true }
  );
};

/**
 * End the consultation. Either participant can end it.
 * Computes duration and sets status to COMPLETED.
 */
export const endConsultation = async (consultation) => {
  if (consultation.status === CONSULTATION_STATUS.COMPLETED) {
    return consultation; // Idempotent
  }

  const endedAt = new Date();
  let duration = null;

  if (consultation.startedAt) {
    const ms = endedAt.getTime() - new Date(consultation.startedAt).getTime();
    duration = Math.round(ms / 60000); // minutes
  }

  return await videoConsultationModel.findByIdAndUpdate(
    consultation._id,
    {
      status: CONSULTATION_STATUS.COMPLETED,
      endedAt,
      duration,
    },
    { new: true }
  );
};

/**
 * Submit doctor's post-consultation notes.
 * Validates that notes haven't already been submitted.
 */
export const submitConsultationNotes = async (consultationId, docId, notes) => {
  const consultation = await videoConsultationModel.findById(consultationId);
  if (!consultation) {
    throw { statusCode: 404, message: 'Consultation not found' };
  }

  if (consultation.doctorId !== docId) {
    throw { statusCode: 403, message: 'Access denied' };
  }

  if (consultation.status !== CONSULTATION_STATUS.COMPLETED) {
    throw { statusCode: 400, message: 'Notes can only be submitted after the consultation is completed' };
  }

  if (consultation.notesSubmitted) {
    throw { statusCode: 400, message: 'Notes have already been submitted for this consultation' };
  }

  return await videoConsultationModel.findByIdAndUpdate(
    consultationId,
    { consultationNotes: notes, notesSubmitted: true },
    { new: true }
  );
};

/**
 * Get consultation history for the authenticated user.
 * Patients see their own; doctors see their own. No cross-access.
 */
export const getConsultationHistory = async (userId, role, page = 1, limit = 10) => {
  const query = role === 'doctor' ? { doctorId: userId } : { patientId: userId };

  const skip = (page - 1) * limit;

  const [consultations, total] = await Promise.all([
    videoConsultationModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    videoConsultationModel.countDocuments(query),
  ]);

  // Enrich each consultation with appointment data
  const enriched = await Promise.all(
    consultations.map(async (c) => {
      const appointment = await appointmentModel.findById(c.appointmentId).lean();
      return { ...c, appointment };
    })
  );

  return {
    consultations: enriched,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
};

/**
 * Get the current status of a consultation.
 */
export const getConsultationStatus = async (consultationId) => {
  const consultation = await videoConsultationModel.findById(consultationId).lean();
  if (!consultation) {
    throw { statusCode: 404, message: 'Consultation not found' };
  }
  return { status: consultation.status, roomId: consultation.roomId };
};
