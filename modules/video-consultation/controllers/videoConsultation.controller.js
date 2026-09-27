import * as videoConsultationService from '../services/videoConsultation.service.js';
import { validateCreateConsultation, validateSubmitNotes } from '../validators/videoConsultation.validator.js';
import { emitIncomingCallNotification } from '../sockets/videoConsultation.socket.js';

/**
 * POST /api/video-consultations
 * Create a consultation for an appointment. Patient or doctor.
 */
export const createConsultation = async (req, res) => {
  try {
    const validation = validateCreateConsultation(req.body);
    if (!validation.valid) {
      return res.json({ success: false, message: validation.message });
    }

    const { appointmentId } = req.body;
    const requesterId = req.user?.id || req.user?.userId || req.body?.userId;
    const role = req.user?.role || 'patient';

    const consultation = await videoConsultationService.createConsultation(appointmentId, requesterId, role);
    
    // Notify the other party about the incoming call session
    emitIncomingCallNotification(consultation._id, requesterId, role).catch(() => {});

    res.json({ success: true, consultation });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/video-consultations/:id
 * Get full consultation details. Both roles.
 */
export const getConsultation = async (req, res) => {
  try {
    // consultation already attached by middleware
    const consultation = req.consultation;
    res.json({ success: true, consultation });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/video-consultations/:id/join
 * Validate time window and update status. Both roles.
 */
export const joinConsultation = async (req, res) => {
  try {
    const { role, id } = req.user;
    const consultation = await videoConsultationService.joinConsultation(req.consultation, role);

    // Notify the other party when user enters/joins
    emitIncomingCallNotification(consultation._id, id, role).catch(() => {});

    res.json({
      success: true,
      consultation,
      roomId: consultation.roomId,
      message: 'Joining allowed',
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/video-consultations/:id/start
 * Mark consultation as ACTIVE. Doctor only.
 */
export const startConsultation = async (req, res) => {
  try {
    const docId = req.user.docId; // Set by authDoctor middleware
    const consultation = await videoConsultationService.startConsultation(req.params.id, docId);
    res.json({ success: true, consultation });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/video-consultations/:id/end
 * End a consultation. Both roles.
 */
export const endConsultation = async (req, res) => {
  try {
    const consultation = await videoConsultationService.endConsultation(req.consultation);
    res.json({ success: true, consultation });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/video-consultations/:id/status
 * Get current status (lightweight). Both roles.
 */
export const getConsultationStatus = async (req, res) => {
  try {
    const statusData = await videoConsultationService.getConsultationStatus(req.params.id);
    res.json({ success: true, ...statusData });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/video-consultations/history
 * Get consultation history for the authenticated user.
 */
export const getConsultationHistory = async (req, res) => {
  try {
    const { id, role } = req.user;
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);

    const result = await videoConsultationService.getConsultationHistory(id, role, page, limit);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/video-consultations/:id/notes
 * Submit post-consultation notes. Doctor only.
 */
export const submitNotes = async (req, res) => {
  try {
    const validation = validateSubmitNotes(req.body);
    if (!validation.valid) {
      return res.json({ success: false, message: validation.message });
    }

    const docId = req.user.docId; // Set by authDoctor middleware
    const { notes } = req.body;

    const consultation = await videoConsultationService.submitConsultationNotes(
      req.params.id,
      docId,
      notes
    );
    res.json({ success: true, consultation, message: 'Notes submitted successfully' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};
