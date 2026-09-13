/**
 * Validators for video consultation request bodies.
 * Follows the project's plain-JS pattern (no external validation library beyond mongoose).
 */

/**
 * Validate body for creating a consultation.
 * @param {Object} body
 * @returns {{ valid: boolean, message?: string }}
 */
export const validateCreateConsultation = (body) => {
  const { appointmentId } = body;

  if (!appointmentId || typeof appointmentId !== 'string' || appointmentId.trim().length === 0) {
    return { valid: false, message: 'appointmentId is required' };
  }

  return { valid: true };
};

/**
 * Validate consultation notes submission.
 * @param {Object} body
 * @returns {{ valid: boolean, message?: string }}
 */
export const validateSubmitNotes = (body) => {
  const { notes } = body;

  if (notes === undefined || notes === null) {
    return { valid: false, message: 'notes field is required' };
  }

  if (typeof notes !== 'string') {
    return { valid: false, message: 'notes must be a string' };
  }

  if (notes.length > 5000) {
    return { valid: false, message: 'notes must be 5000 characters or fewer' };
  }

  return { valid: true };
};

/**
 * Validate that the consultation ID param is a non-empty string.
 * @param {string} id
 * @returns {{ valid: boolean, message?: string }}
 */
export const validateConsultationId = (id) => {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return { valid: false, message: 'Valid consultation ID is required' };
  }
  return { valid: true };
};
