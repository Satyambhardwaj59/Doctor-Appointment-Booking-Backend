import {
    createRecord,
    listRecords,
    updateRecord,
    deleteRecord,
    restoreRecord,
    addAttachments,
    removeAttachment,
} from '../services/medicalRecord.service.js';

// POST /api/medical-records
const createMedicalRecord = async (req, res) => {
    try {
        const { id: creatorId, role: creatorRole } = req.chatUser;

        const { record, error } = await createRecord({
            creatorId,
            creatorRole,
            body: req.body,
            files: req.files,
        });

        if (error) {
            return res.json({ success: false, message: error });
        }

        res.json({ success: true, record });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not create record' });
    }
};

// GET /api/medical-records
const getMedicalRecords = async (req, res) => {
    try {
        const { id: viewerId, role } = req.chatUser;
        const { type, doctor, familyMember, dateFrom, dateTo, search, page, limit, patientId, archived } = req.query;

        const result = await listRecords(viewerId, role, {
            type,
            doctor,
            familyMember,
            dateFrom,
            dateTo,
            search,
            page,
            limit,
            patientId,
            archived,
        });

        if (result.ineligibleFamilyMember) {
            return res.json({ success: false, message: 'Family member not found' });
        }

        res.json({ success: true, ...result });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not load records' });
    }
};

// GET /api/medical-records/:id
// Ownership already verified by verifyRecordAccess, which attaches the
// loaded document to req.medicalRecord.
const getMedicalRecord = async (req, res) => {
    res.json({ success: true, record: req.medicalRecord });
};

// PATCH /api/medical-records/:id
const patchMedicalRecord = async (req, res) => {
    try {
        const { id: viewerId, role } = req.chatUser;
        const { record, error } = await updateRecord(req.params.id, viewerId, role, req.body);

        if (error) {
            return res.json({ success: false, message: error });
        }

        res.json({ success: true, record });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not update record' });
    }
};

// DELETE /api/medical-records/:id
const removeMedicalRecord = async (req, res) => {
    try {
        const { id: viewerId, role } = req.chatUser;
        const record = await deleteRecord(req.params.id, viewerId, role);

        if (!record) {
            return res.json({ success: false, message: 'Record not found or not authorized' });
        }

        res.json({ success: true, message: 'Record archived' });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not delete record' });
    }
};

// PATCH /api/medical-records/:id/restore
const restoreMedicalRecord = async (req, res) => {
    try {
        const { id: viewerId, role } = req.chatUser;
        const record = await restoreRecord(req.params.id, viewerId, role);

        if (!record) {
            return res.json({ success: false, message: 'Record not found or not authorized' });
        }

        res.json({ success: true, record, message: 'Record restored' });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not restore record' });
    }
};

// POST /api/medical-records/:id/attachments
const uploadAttachmentsToRecord = async (req, res) => {
    try {
        const { id: viewerId, role } = req.chatUser;
        const { record, error } = await addAttachments(req.params.id, viewerId, role, req.files);

        if (error) {
            return res.json({ success: false, message: error });
        }

        res.json({ success: true, record });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not upload attachments' });
    }
};

// DELETE /api/medical-records/:id/attachments/:attachmentId
const deleteAttachmentFromRecord = async (req, res) => {
    try {
        const { id: viewerId, role } = req.chatUser;
        const { record, error } = await removeAttachment(
            req.params.id,
            req.params.attachmentId,
            viewerId,
            role
        );

        if (error) {
            return res.json({ success: false, message: error });
        }

        res.json({ success: true, record });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Could not remove attachment' });
    }
};

export {
    createMedicalRecord,
    getMedicalRecords,
    getMedicalRecord,
    patchMedicalRecord,
    removeMedicalRecord,
    restoreMedicalRecord,
    uploadAttachmentsToRecord,
    deleteAttachmentFromRecord,
};
