import { getOwnedFamilyMember } from '../services/familyAccount.service.js';

// Verifies the family member in the URL (:id) belongs to the authenticated
// user (req.user.userId, set by the existing authUser middleware). Ownership
// is always derived from the JWT-authenticated user — never from the
// request body — per the app's security requirements.
//
// On success, attaches the loaded document to req.familyMember so
// downstream controllers don't need to re-query it.
const verifyFamilyMemberOwnership = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;

        const familyMember = await getOwnedFamilyMember(userId, id);

        if (!familyMember) {
            return res.json({ success: false, message: 'Family member not found' });
        }

        req.familyMember = familyMember;
        next();
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Family member not found' });
    }
};

export default verifyFamilyMemberOwnership;
