import mongoose from 'mongoose';

export const RECORD_TYPES = [
    'CONSULTATION',
    'DIAGNOSIS',
    'PRESCRIPTION',
    'LAB_REPORT',
    'MEDICAL_DOCUMENT',
    'VISIT',
    'OTHER',
];

// Only these types may be created directly by a patient (self-uploaded
// documents/reports). Clinical types are doctor-authored — see
// medicalRecord.validator.js and chatAccess-style ownership checks in
// medicalRecordAccess.middleware.js for how this is enforced.
export const PATIENT_CREATABLE_TYPES = ['MEDICAL_DOCUMENT', 'LAB_REPORT', 'OTHER'];

const attachmentSchema = new mongoose.Schema({
    url: { type: String, required: true },
    publicId: { type: String, default: '' },
    fileName: { type: String, default: '' },
    fileType: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
}, { _id: true });

const medicalRecordSchema = new mongoose.Schema({
    // The primary (authenticated) account this record belongs to — matches
    // the primaryUserId convention already used by family-accounts, rather
    // than introducing a different ownership field name.
    patientId: { type: String, required: true, index: true },
    doctorId: { type: String, required: true, index: true },
    appointmentId: { type: String, default: null },
    // No backend consultation/prescription model exists yet in this app
    // (video-consultation is currently frontend-only) — kept as a loose,
    // unvalidated reference for future wiring rather than inventing a
    // duplicate consultation system now.
    consultationId: { type: String, default: null },
    // Set when this record belongs to a family member of patientId rather
    // than the primary account holder themself. Ownership of the family
    // member is verified against the existing family-accounts feature,
    // never trusted directly from the frontend.
    familyMemberId: { type: String, default: null },

    recordType: { type: String, enum: RECORD_TYPES, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    diagnosis: { type: String, default: '' },
    doctorNotes: { type: String, default: '' },
    recordDate: { type: Date, required: true },
    attachments: { type: [attachmentSchema], default: [] },

    // Who authored this record — determines edit permissions for clinical
    // fields (diagnosis/doctorNotes are doctor-only, see the validator).
    createdByRole: { type: String, enum: ['doctor', 'patient'], required: true },
    createdById: { type: String, required: true },

    // Archive/soft-delete per the feature's security requirement to
    // prefer preserving clinical records over hard deletion.
    isDeleted: { type: Boolean, default: false },
}, { timestamps: true, minimize: false });

medicalRecordSchema.index({ patientId: 1, familyMemberId: 1, recordDate: -1 });
medicalRecordSchema.index({ doctorId: 1, recordDate: -1 });
// Supports the `search` query param without adding a separate search service.
medicalRecordSchema.index({ title: 'text', description: 'text', diagnosis: 'text' });

const medicalRecordModel =
    mongoose.model.medicalRecord || mongoose.model('medicalRecord', medicalRecordSchema);

export default medicalRecordModel;
