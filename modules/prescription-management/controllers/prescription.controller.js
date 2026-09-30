import {
    createPrescription,
    listPrescriptions,
    updatePrescription,
    addAttachments,
    removeAttachment,
    listMedications,
    getTodayMedications,
    updateMedicationStatus,
} from '../services/prescription.service.js';

// POST /api/prescriptions (doctor only)
const createNewPrescription = async (req, res) => {
    try {
        const { prescription, error } = await createPrescription(req.chatUser.id, req.body);
        if (error) return res.json({ success: false, message: error });
        res.json({ success: true, prescription });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not create prescription' });
    }
};

// GET /api/prescriptions
const getPrescriptions = async (req, res) => {
    try {
        const { id: viewerId, role } = req.chatUser;
        const { status, patient, familyMember, doctor, dateFrom, dateTo, page, limit } = req.query;

        const result = await listPrescriptions(viewerId, role, {
            status, patient, familyMember, doctor, dateFrom, dateTo, page, limit,
        });

        if (result.ineligibleFamilyMember) {
            return res.json({ success: false, message: 'Family member not found' });
        }
        res.json({ success: true, ...result });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not load prescriptions' });
    }
};

// GET /api/prescriptions/:id (ownership verified by middleware)
const getPrescription = async (req, res) => {
    res.json({ success: true, prescription: req.prescription });
};

// PATCH /api/prescriptions/:id (doctor only)
const patchPrescription = async (req, res) => {
    try {
        const { prescription, error } = await updatePrescription(req.params.id, req.chatUser.id, req.body);
        if (error) return res.json({ success: false, message: error });
        res.json({ success: true, prescription });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not update prescription' });
    }
};

// POST /api/prescriptions/:id/attachments (doctor only)
const uploadPrescriptionAttachments = async (req, res) => {
    try {
        const { prescription, error } = await addAttachments(req.params.id, req.chatUser.id, req.files);
        if (error) return res.json({ success: false, message: error });
        res.json({ success: true, prescription });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not upload attachments' });
    }
};

// DELETE /api/prescriptions/:id/attachments/:attachmentId (doctor only)
const deletePrescriptionAttachment = async (req, res) => {
    try {
        const { prescription, error } = await removeAttachment(
            req.params.id,
            req.params.attachmentId,
            req.chatUser.id
        );
        if (error) return res.json({ success: false, message: error });
        res.json({ success: true, prescription });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not remove attachment' });
    }
};

// GET /api/medications (patient only)
const getMedications = async (req, res) => {
    try {
        const { status, familyMember, prescriptionId, dateFrom, dateTo, page, limit } = req.query;
        const result = await listMedications(req.chatUser.id, {
            status, familyMember, prescriptionId, dateFrom, dateTo, page, limit,
        });

        if (result.ineligibleFamilyMember) {
            return res.json({ success: false, message: 'Family member not found' });
        }
        res.json({ success: true, ...result });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not load medications' });
    }
};

// GET /api/medications/today (patient only)
const getTodaysMedications = async (req, res) => {
    try {
        const result = await getTodayMedications(req.chatUser.id, req.query.familyMember);

        if (result.ineligibleFamilyMember) {
            return res.json({ success: false, message: 'Family member not found' });
        }
        res.json({ success: true, ...result });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not load today\'s medications' });
    }
};

// PATCH /api/medications/:id/status (patient only)
const patchMedicationStatus = async (req, res) => {
    try {
        const { medication, error } = await updateMedicationStatus(req.params.id, req.chatUser.id, req.body);
        if (error) return res.json({ success: false, message: error });
        res.json({ success: true, medication });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not update medication status' });
    }
};

export {
    createNewPrescription,
    getPrescriptions,
    getPrescription,
    patchPrescription,
    uploadPrescriptionAttachments,
    deletePrescriptionAttachment,
    getMedications,
    getTodaysMedications,
    patchMedicationStatus,
};
