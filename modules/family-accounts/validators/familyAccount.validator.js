import validator from 'validator';
import { RELATIONSHIP_VALUES } from '../models/familyAccount.model.js';

// Basic, permissive phone check so we don't reject legitimate international
// formats. Mirrors the "light validation" style already used in the app
// (the existing userModel doesn't validate phone at all beyond a default).
const isValidPhone = (phone) => /^[0-9+\-\s()]{7,15}$/.test(phone);

const isValidPastDate = (value) => {
    const date = new Date(value);
    if (isNaN(date.getTime())) return false;
    return date.getTime() <= Date.now();
};

// Validates payload for creating a family member.
// Returns { valid: boolean, message?: string }
const validateCreateFamilyMember = (body) => {
    const { name, relationship, dateOfBirth, gender, phone, email } = body;

    if (!name || !name.trim()) {
        return { valid: false, message: 'Name is required' };
    }

    if (!relationship || !RELATIONSHIP_VALUES.includes(relationship)) {
        return {
            valid: false,
            message: `Relationship must be one of: ${RELATIONSHIP_VALUES.join(', ')}`
        };
    }

    if (dateOfBirth && !isValidPastDate(dateOfBirth)) {
        return { valid: false, message: 'Enter a valid date of birth' };
    }

    if (phone && !isValidPhone(phone)) {
        return { valid: false, message: 'Enter a valid phone number' };
    }

    if (email && !validator.isEmail(email)) {
        return { valid: false, message: 'Enter a valid email' };
    }

    if (gender && !['Male', 'Female', 'Other', 'Not Selected'].includes(gender)) {
        return { valid: false, message: 'Enter a valid gender' };
    }

    return { valid: true };
};

// Validates payload for updating a family member. Every field is optional,
// but whatever is supplied must be well-formed.
const validateUpdateFamilyMember = (body) => {
    const { name, relationship, dateOfBirth, gender, phone, email } = body;

    if (name !== undefined && !name.trim()) {
        return { valid: false, message: 'Name cannot be empty' };
    }

    if (relationship !== undefined && !RELATIONSHIP_VALUES.includes(relationship)) {
        return {
            valid: false,
            message: `Relationship must be one of: ${RELATIONSHIP_VALUES.join(', ')}`
        };
    }

    if (dateOfBirth && !isValidPastDate(dateOfBirth)) {
        return { valid: false, message: 'Enter a valid date of birth' };
    }

    if (phone && !isValidPhone(phone)) {
        return { valid: false, message: 'Enter a valid phone number' };
    }

    if (email && !validator.isEmail(email)) {
        return { valid: false, message: 'Enter a valid email' };
    }

    if (gender && !['Male', 'Female', 'Other', 'Not Selected'].includes(gender)) {
        return { valid: false, message: 'Enter a valid gender' };
    }

    return { valid: true };
};

export { validateCreateFamilyMember, validateUpdateFamilyMember, isValidPhone, isValidPastDate };
