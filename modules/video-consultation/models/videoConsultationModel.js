import mongoose from 'mongoose';

const videoConsultationSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: String,
      required: true,
      unique: true,
    },
    doctorId: {
      type: String,
      required: true,
    },
    patientId: {
      type: String,
      required: true,
    },
    // Secure random room identifier — never sequential/predictable
    roomId: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ['UPCOMING', 'WAITING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED'],
      default: 'UPCOMING',
    },
    startedAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    // Duration in minutes (computed on end)
    duration: {
      type: Number,
      default: null,
    },
    // Doctor-entered post-consultation notes
    consultationNotes: {
      type: String,
      default: '',
    },
    notesSubmitted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// Prevent model recompilation in development (hot-reload safety)
const videoConsultationModel =
  mongoose.models.videoConsultation ||
  mongoose.model('videoConsultation', videoConsultationSchema);

export default videoConsultationModel;
