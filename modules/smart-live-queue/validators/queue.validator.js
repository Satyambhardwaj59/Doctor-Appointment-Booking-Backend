import mongoose from 'mongoose';

const isValidId = (value) => typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);

// Only the appointmentId is accepted. patientId and doctorId are NEVER
// read from the body — they come from the JWT and the verified appointment.
const validateJoin = (body) => {
    if (!body || !isValidId(body.appointmentId)) {
        return { valid: false, message: 'A valid appointmentId is required' };
    }
    return { valid: true };
};

const validateEntryTarget = (body, { required }) => {
    if (body && body.entryId !== undefined && !isValidId(body.entryId)) {
        return { valid: false, message: 'entryId is invalid' };
    }
    if (required && !(body && body.entryId)) {
        return { valid: false, message: 'entryId is required' };
    }
    return { valid: true };
};

export { isValidId, validateJoin, validateEntryTarget };
