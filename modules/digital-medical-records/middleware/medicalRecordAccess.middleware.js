import { getOwnedRecord } from '../services/medicalRecord.service.js';

// Verifies the record in the URL (:id) belongs to the authenticated viewer
// (doctor or patient), never trusting the id's association from the
// frontend. Attaches the loaded record to req.medicalRecord.
const verifyRecordAccess = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { id: viewerId, role } = req.chatUser;

        const record = await getOwnedRecord(id, viewerId, role);

        if (!record) {
            return res.json({ success: false, message: 'Record not found' });
        }

        req.medicalRecord = record;
        next();
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Record not found' });
    }
};

export { verifyRecordAccess };
