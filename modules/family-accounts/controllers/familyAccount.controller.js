import {
    createFamilyMember,
    getFamilyMembers,
    updateFamilyMember,
    removeFamilyMember
} from '../services/familyAccount.service.js';
import {
    validateCreateFamilyMember,
    validateUpdateFamilyMember
} from '../validators/familyAccount.validator.js';

// POST /api/family-members
const addFamilyMember = async (req, res) => {
    try {
        const { userId } = req.user;

        const validation = validateCreateFamilyMember(req.body);
        if (!validation.valid) {
            return res.json({ success: false, message: validation.message });
        }

        const familyMember = await createFamilyMember(userId, req.body, req.file);

        res.json({ success: true, message: 'Family member added', familyMember });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not add family member' });
    }
};

// GET /api/family-members
const listFamilyMembers = async (req, res) => {
    try {
        const { userId } = req.user;
        const familyMembers = await getFamilyMembers(userId);

        res.json({ success: true, familyMembers });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not load family members' });
    }
};

// GET /api/family-members/:id
// Ownership already verified by verifyFamilyMemberOwnership middleware,
// which attaches the loaded document to req.familyMember.
const getFamilyMember = async (req, res) => {
    res.json({ success: true, familyMember: req.familyMember });
};

// PATCH /api/family-members/:id
const editFamilyMember = async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;

        const validation = validateUpdateFamilyMember(req.body);
        if (!validation.valid) {
            return res.json({ success: false, message: validation.message });
        }

        const familyMember = await updateFamilyMember(userId, id, req.body, req.file);

        if (!familyMember) {
            return res.json({ success: false, message: 'Family member not found' });
        }

        res.json({ success: true, message: 'Family member updated', familyMember });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not update family member' });
    }
};

// DELETE /api/family-members/:id
const deleteFamilyMember = async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;

        const familyMember = await removeFamilyMember(userId, id);

        if (!familyMember) {
            return res.json({ success: false, message: 'Family member not found' });
        }

        res.json({ success: true, message: 'Family member removed' });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not remove family member' });
    }
};

export {
    addFamilyMember,
    listFamilyMembers,
    getFamilyMember,
    editFamilyMember,
    deleteFamilyMember
};
