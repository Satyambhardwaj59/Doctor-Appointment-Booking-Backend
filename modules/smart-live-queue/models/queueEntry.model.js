import mongoose from 'mongoose';

export const QUEUE_STATUSES = [
    'WAITING',
    'CALLED',
    'IN_CONSULTATION',
    'COMPLETED',
    'SKIPPED',
    'CANCELLED',
];

const queueEntrySchema = new mongoose.Schema({
    queueId: { type: String, required: true, index: true },
    doctorId: { type: String, required: true },
    // Always taken from the verified appointment, never from the request.
    appointmentId: { type: String, required: true },
    patientId: { type: String, required: true, index: true },
    familyMemberId: { type: String, default: null },
    // Display snapshot copied from the appointment so the doctor's queue
    // can show who is waiting without extra lookups.
    patientName: { type: String, default: '' },
    familyMemberName: { type: String, default: '' },

    queueNumber: { type: Number, required: true },
    status: { type: String, enum: QUEUE_STATUSES, default: 'WAITING', index: true },

    joinedAt: { type: Date, default: Date.now },
    calledAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // Last computed estimate in minutes (an estimate, not a promise).
    estimatedWaitTime: { type: Number, default: 0 },

    // Ensures the "your turn is approaching" notification fires once.
    approachingNotified: { type: Boolean, default: false },
}, { timestamps: true, minimize: false });

// One queue entry per appointment: the duplicate-entry guard.
queueEntrySchema.index({ appointmentId: 1 }, { unique: true });
// Token numbers are unique within a queue.
queueEntrySchema.index({ queueId: 1, queueNumber: 1 }, { unique: true });

const queueEntryModel =
    mongoose.models.queueEntry || mongoose.model('queueEntry', queueEntrySchema);

export default queueEntryModel;
