import { RECORD_TYPES, PATIENT_CREATABLE_TYPES } from '../models/medicalRecord.model.js';

const ALLOWED_ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
const MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_ATTACHMENTS_PER_RECORD = 10;

// Validates the payload for creating a new record. `role` is the creating
// user's role, derived from the authenticated JWT — never trusted from the
// body — so this also enforces which record types each role may create.
const validateCreateRecord = (body, role) => {
    const { recordType, title, recordDate } = body;

    if (!recordType || !RECORD_TYPES.includes(recordType)) {
        return { valid: false, message: `recordType must be one of: ${RECORD_TYPES.join(', ')}` };
    }

    if (role === 'patient' && !PATIENT_CREATABLE_TYPES.includes(recordType)) {
        return {
            valid: false,
            message: 'Patients can only add document/report records, not clinical records',
        };
    }

    if (!title || !title.trim()) {
        return { valid: false, message: 'Title is required' };
    }

    if (!recordDate || isNaN(new Date(recordDate).getTime())) {
        return { valid: false, message: 'A valid recordDate is required' };
    }

    if (new Date(recordDate).getTime() > Date.now()) {
        return { valid: false, message: 'recordDate cannot be in the future' };
    }

    return { valid: true };
};

// Validates an update payload. Clinical fields (diagnosis, doctorNotes,
// recordType) may only be modified by a doctor — a patient attempting to
// change them is rejected outright rather than silently ignored, so the
// caller gets clear feedback instead of a confusing partial update.
const validateUpdateRecord = (body, role) => {
    const clinicalFields = ['diagnosis', 'doctorNotes'];
    const attemptedClinicalEdit = clinicalFields.some((field) => body[field] !== undefined);

    if (role === 'patient' && attemptedClinicalEdit) {
        return { valid: false, message: 'Only the doctor can edit clinical fields on this record' };
    }

    if (body.recordType !== undefined) {
        if (!RECORD_TYPES.includes(body.recordType)) {
            return { valid: false, message: `recordType must be one of: ${RECORD_TYPES.join(', ')}` };
        }
        if (role === 'patient' && !PATIENT_CREATABLE_TYPES.includes(body.recordType)) {
            return { valid: false, message: 'Patients cannot set a clinical record type' };
        }
    }

    if (body.title !== undefined && !body.title.trim()) {
        return { valid: false, message: 'Title cannot be empty' };
    }

    if (body.recordDate !== undefined) {
        if (isNaN(new Date(body.recordDate).getTime())) {
            return { valid: false, message: 'Enter a valid recordDate' };
        }
        if (new Date(body.recordDate).getTime() > Date.now()) {
            return { valid: false, message: 'recordDate cannot be in the future' };
        }
    }

    return { valid: true };
};

const validateAttachmentFiles = (files) => {
    if (!files || files.length === 0) return { valid: true };

    if (files.length > MAX_ATTACHMENTS_PER_RECORD) {
        return { valid: false, message: `You can attach at most ${MAX_ATTACHMENTS_PER_RECORD} files` };
    }

    for (const file of files) {
        if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.mimetype)) {
            return { valid: false, message: 'Only PDF, JPG, JPEG and PNG files are allowed' };
        }
        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
            return { valid: false, message: 'Each file must be under 15MB' };
        }
    }

    return { valid: true };
};

export {
    validateCreateRecord,
    validateUpdateRecord,
    validateAttachmentFiles,
    ALLOWED_ATTACHMENT_MIME_TYPES,
    MAX_ATTACHMENT_SIZE_BYTES,
    MAX_ATTACHMENTS_PER_RECORD,
};
