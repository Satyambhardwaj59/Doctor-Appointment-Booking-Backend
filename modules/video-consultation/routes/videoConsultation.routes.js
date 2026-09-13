import express from 'express';
import authUser from '../../../middleware/authUser.js';
import authDoctor from '../../../middleware/authDoctor.js';
import consultationAccessMiddleware from '../middleware/consultationAccess.middleware.js';
import {
  createConsultation,
  getConsultation,
  joinConsultation,
  startConsultation,
  endConsultation,
  getConsultationStatus,
  getConsultationHistory,
  submitNotes,
} from '../controllers/videoConsultation.controller.js';

const videoConsultationRouter = express.Router();

// ─────────────────────────────────────────────
// Patient-only routes (uses existing authUser)
// ─────────────────────────────────────────────

// Create or get a consultation for an appointment (patient or doctor)
videoConsultationRouter.post('/', consultationAccessMiddleware, createConsultation);

// ─────────────────────────────────────────────
// Dual-role routes (patient OR doctor)
// consultationAccess middleware handles both tokens + ownership check
// ─────────────────────────────────────────────

// History — no :id param, uses consultationAccess without ownership lookup
videoConsultationRouter.get('/history', consultationAccessMiddleware, getConsultationHistory);

// Get consultation details
videoConsultationRouter.get('/:id', consultationAccessMiddleware, getConsultation);

// Validate time window and move to WAITING
videoConsultationRouter.post('/:id/join', consultationAccessMiddleware, joinConsultation);

// End consultation (either participant)
videoConsultationRouter.post('/:id/end', consultationAccessMiddleware, endConsultation);

// Lightweight status check
videoConsultationRouter.get('/:id/status', consultationAccessMiddleware, getConsultationStatus);

// ─────────────────────────────────────────────
// Doctor-only routes (uses existing authDoctor)
// ─────────────────────────────────────────────

// Start consultation (doctor activates it)
videoConsultationRouter.post('/:id/start', authDoctor, startConsultation);

// Submit post-call notes
videoConsultationRouter.post('/:id/notes', authDoctor, submitNotes);

export default videoConsultationRouter;
