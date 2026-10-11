import mongoose from 'mongoose';

// The dashboard accepts exactly one client-supplied value: an optional
// familyMemberId. patientId is never read from the request — it comes from
// the verified JWT. Query params can arrive as arrays/objects
// (?familyMemberId[]=x), so anything that isn't a plain ObjectId string is
// rejected rather than coerced.
const validateDashboardQuery = (query) => {
    const raw = query?.familyMemberId;

    if (raw === undefined || raw === '') {
        return { valid: true, familyMemberId: null };
    }

    if (typeof raw !== 'string' || !mongoose.Types.ObjectId.isValid(raw)) {
        return { valid: false, message: 'familyMemberId is invalid' };
    }

    return { valid: true, familyMemberId: raw };
};

export { validateDashboardQuery };
