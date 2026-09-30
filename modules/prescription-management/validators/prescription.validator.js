import {
    MEDICINE_FORMS,
    MEDICINE_FREQUENCIES,
    MEDICINE_TIMINGS,
    PRESCRIPTION_STATUSES,
} from '../models/prescription.model.js';

const ALLOWED_ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
const MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const MAX_MEDICINES = 30;

const isValidDate = (value) => !isNaN(new Date(value).getTime());

const validateMedicine = (medicine, index) => {
    const label = `Medicine #${index + 1}`;

    if (!medicine || typeof medicine !== 'object') {
        return `${label} is invalid`;
    }
    if (!medicine.name || !String(medicine.name).trim()) return `${label}: name is required`;
    if (!medicine.dosage || !String(medicine.dosage).trim()) return `${label}: dosage is required`;
    if (!MEDICINE_FREQUENCIES.includes(medicine.frequency)) {
        return `${label}: frequency must be one of ${MEDICINE_FREQUENCIES.join(', ')}`;
    }
    if (medicine.form !== undefined && !MEDICINE_FORMS.includes(medicine.form)) {
        return `${label}: form must be one of ${MEDICINE_FORMS.join(', ')}`;
    }
    if (medicine.timing !== undefined && !MEDICINE_TIMINGS.includes(medicine.timing)) {
        return `${label}: timing must be one of ${MEDICINE_TIMINGS.join(', ')}`;
    }
    if (medicine.quantity !== undefined && (isNaN(Number(medicine.quantity)) || Number(medicine.quantity) < 0)) {
        return `${label}: quantity must be a non-negative number`;
    }
    return null;
};

const validateMedicines = (medicines) => {
    if (!Array.isArray(medicines) || medicines.length === 0) {
        return 'At least one medicine is required';
    }
    if (medicines.length > MAX_MEDICINES) {
        return `A prescription can have at most ${MAX_MEDICINES} medicines`;
    }
    for (let i = 0; i < medicines.length; i++) {
        const error = validateMedicine(medicines[i], i);
        if (error) return error;
    }
    return null;
};

// Only the doctor creates prescriptions. patientId / familyMemberId are NOT
// accepted from the body — they are derived from the verified appointment.
const validateCreatePrescription = (body) => {
    if (!body.appointmentId) {
        return { valid: false, message: 'appointmentId is required' };
    }

    const medicinesError = validateMedicines(body.medicines);
    if (medicinesError) return { valid: false, message: medicinesError };

    if (body.prescriptionDate !== undefined) {
        if (!isValidDate(body.prescriptionDate)) {
            return { valid: false, message: 'Enter a valid prescriptionDate' };
        }
        if (new Date(body.prescriptionDate).getTime() > Date.now()) {
            return { valid: false, message: 'prescriptionDate cannot be in the future' };
        }
    }

    if (body.validUntil) {
        if (!isValidDate(body.validUntil)) {
            return { valid: false, message: 'Enter a valid validUntil date' };
        }
        const start = body.prescriptionDate ? new Date(body.prescriptionDate) : new Date();
        if (new Date(body.validUntil).getTime() < start.getTime()) {
            return { valid: false, message: 'validUntil cannot be before the prescription date' };
        }
    }

    return { valid: true };
};

const validateUpdatePrescription = (body) => {
    if (body.medicines !== undefined) {
        const medicinesError = validateMedicines(body.medicines);
        if (medicinesError) return { valid: false, message: medicinesError };
    }

    if (body.status !== undefined && !PRESCRIPTION_STATUSES.includes(body.status)) {
        return { valid: false, message: `status must be one of ${PRESCRIPTION_STATUSES.join(', ')}` };
    }

    if (body.validUntil) {
        if (!isValidDate(body.validUntil)) {
            return { valid: false, message: 'Enter a valid validUntil date' };
        }
    }

    return { valid: true };
};

// Patients may only mark a dose as taken or skipped. PENDING/MISSED are
// system states.
const validateMedicationStatusUpdate = (body) => {
    if (!['TAKEN', 'SKIPPED'].includes(body.status)) {
        return { valid: false, message: 'status must be TAKEN or SKIPPED' };
    }
    return { valid: true };
};

const validateAttachmentFiles = (files) => {
    if (!files || files.length === 0) {
        return { valid: false, message: 'Please choose at least one file' };
    }
    if (files.length > MAX_ATTACHMENTS) {
        return { valid: false, message: `You can attach at most ${MAX_ATTACHMENTS} files` };
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
    validateCreatePrescription,
    validateUpdatePrescription,
    validateMedicationStatusUpdate,
    validateAttachmentFiles,
    MAX_ATTACHMENTS,
};
