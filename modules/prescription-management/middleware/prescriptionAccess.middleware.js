import { getOwnedPrescription } from '../services/prescription.service.js';

// Identity (req.chatUser = { id, role }) comes from the shared dual-role
// JWT middleware reused from the chat module; these only add authorization.

const requireRole = (role, message) => (req, res, next) => {
    if (req.chatUser?.role !== role) {
        return res.json({ success: false, message });
    }
    next();
};

// Verifies the prescription in the URL belongs to the authenticated viewer
// (authoring doctor or the owning patient account). Unknown and
// not-yours are indistinguishable to the caller.
const verifyPrescriptionAccess = async (req, res, next) => {
    try {
        const { id: viewerId, role } = req.chatUser;
        const prescription = await getOwnedPrescription(req.params.id, viewerId, role);

        if (!prescription) {
            return res.json({ success: false, message: 'Prescription not found' });
        }

        req.prescription = prescription;
        next();
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Prescription not found' });
    }
};

export { requireRole, verifyPrescriptionAccess };
