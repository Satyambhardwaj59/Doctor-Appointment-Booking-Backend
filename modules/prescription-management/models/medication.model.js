import mongoose from 'mongoose';

export const MEDICATION_STATUSES = ['PENDING', 'TAKEN', 'SKIPPED', 'MISSED'];

const medicationSchema = new mongoose.Schema({
    prescriptionId: { type: String, required: true, index: true },
    // Matches prescription.medicines[]._id
    medicineId: { type: String, required: true },
    // Denormalized (copied from the prescription at generation time) so
    // ownership checks and "today" queries don't need a join.
    patientId: { type: String, required: true, index: true },
    familyMemberId: { type: String, default: null },
    medicineName: { type: String, default: '' },
    dosage: { type: String, default: '' },
    timing: { type: String, default: '' },

    scheduledTime: { type: Date, required: true },
    status: { type: String, enum: MEDICATION_STATUSES, default: 'PENDING' },
    takenAt: { type: Date, default: null },
}, { timestamps: true, minimize: false });

medicationSchema.index({ patientId: 1, familyMemberId: 1, scheduledTime: 1 });

const medicationModel =
    mongoose.models.medication || mongoose.model('medication', medicationSchema);

export default medicationModel;
