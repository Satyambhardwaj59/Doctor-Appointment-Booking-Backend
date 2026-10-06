import mongoose from 'mongoose';

const queueSchema = new mongoose.Schema({
    doctorId: { type: String, required: true },
    // Same "D_M_YYYY" string the appointment system already uses for
    // slotDate, so a queue session lines up with appointments without any
    // date conversion.
    slotDate: { type: String, required: true },

    // Atomic token counter: tokens are handed out with $inc, so two
    // patients joining at the same instant can never receive the same number.
    nextNumber: { type: Number, default: 1 },

    isPaused: { type: Boolean, default: false },
    pausedAt: { type: Date, default: null },

    // The single patient currently CALLED or IN_CONSULTATION. Acting as a
    // lock: it can only be set while null, via an atomic conditional
    // update, so two call-next requests can never both succeed.
    activeEntryId: { type: String, default: null },

    // Incremented on every queue change. Clients ignore any update older
    // than the newest version they have already applied (duplicate/stale
    // update prevention, including after a reconnect).
    version: { type: Number, default: 0 },

    // Rolling stats used for the wait-time estimate.
    completedCount: { type: Number, default: 0 },
    totalConsultMinutes: { type: Number, default: 0 },
}, { timestamps: true, minimize: false });

queueSchema.index({ doctorId: 1, slotDate: 1 }, { unique: true });

const queueModel = mongoose.models.queue || mongoose.model('queue', queueSchema);

export default queueModel;
