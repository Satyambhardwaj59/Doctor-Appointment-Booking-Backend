import mongoose from 'mongoose';

export const MEDICINE_FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Other'];
export const MEDICINE_FREQUENCIES = ['Once', 'Twice', 'Thrice', 'As Needed'];
export const MEDICINE_TIMINGS = ['Before Food', 'After Food', 'With Food'];
export const PRESCRIPTION_STATUSES = ['ACTIVE', 'COMPLETED', 'EXPIRED'];

// Each medicine gets its own _id, which doubles as the `medicineId`
// referenced by medication schedule entries.
const medicineSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    dosage: { type: String, required: true, trim: true },
    form: { type: String, enum: MEDICINE_FORMS, default: 'Tablet' },
    frequency: { type: String, enum: MEDICINE_FREQUENCIES, required: true },
    timing: { type: String, enum: MEDICINE_TIMINGS, default: 'After Food' },
    // Free text such as "5 days" or "2 weeks". Parsed by the schedule
    // generator; unparseable values simply produce no auto-schedule.
    duration: { type: String, default: '' },
    quantity: { type: Number, default: 0, min: 0 },
    instructions: { type: String, default: '' },
});

const attachmentSchema = new mongoose.Schema({
    url: { type: String, required: true },
    publicId: { type: String, default: '' },
    fileName: { type: String, default: '' },
    fileType: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
});

const prescriptionSchema = new mongoose.Schema({
    // patientId, familyMemberId and doctorId are always derived server-side
    // from the authenticated doctor + the verified appointment record.
    patientId: { type: String, required: true, index: true },
    doctorId: { type: String, required: true, index: true },
    appointmentId: { type: String, required: true },
    // No backend consultation model exists in this app yet; kept as a loose
    // optional reference (same approach as digital-medical-records).
    consultationId: { type: String, default: null },
    familyMemberId: { type: String, default: null },
    // The digital-medical-records entry created for this prescription.
    medicalRecordId: { type: String, default: null },

    medicines: {
        type: [medicineSchema],
        validate: [(v) => v.length > 0, 'At least one medicine is required'],
    },
    diagnosis: { type: String, default: '' },
    instructions: { type: String, default: '' },
    doctorNotes: { type: String, default: '' },
    prescriptionDate: { type: Date, required: true },
    validUntil: { type: Date, default: null },
    status: { type: String, enum: PRESCRIPTION_STATUSES, default: 'ACTIVE', index: true },
    attachments: { type: [attachmentSchema], default: [] },
}, { timestamps: true, minimize: false });

prescriptionSchema.index({ patientId: 1, familyMemberId: 1, prescriptionDate: -1 });
prescriptionSchema.index({ doctorId: 1, prescriptionDate: -1 });

const prescriptionModel =
    mongoose.models.prescription || mongoose.model('prescription', prescriptionSchema);

export default prescriptionModel;
