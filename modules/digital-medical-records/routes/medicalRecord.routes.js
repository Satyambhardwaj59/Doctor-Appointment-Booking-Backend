import express from 'express';
import {
    createMedicalRecord,
    getMedicalRecords,
    getMedicalRecord,
    patchMedicalRecord,
    removeMedicalRecord,
    restoreMedicalRecord,
    uploadAttachmentsToRecord,
    deleteAttachmentFromRecord,
} from '../controllers/medicalRecord.controller.js';
import { verifyRecordAccess } from '../middleware/medicalRecordAccess.middleware.js';
import { authChatIdentity } from '../../doctor-patient-chat/index.js';
import upload from '../../../middleware/multer.js';

const medicalRecordRouter = express.Router();

medicalRecordRouter.post(
    '/',
    authChatIdentity,
    upload.array('attachments', 10),
    createMedicalRecord
);
medicalRecordRouter.get('/', authChatIdentity, getMedicalRecords);
medicalRecordRouter.get('/:id', authChatIdentity, verifyRecordAccess, getMedicalRecord);
medicalRecordRouter.patch('/:id', authChatIdentity, verifyRecordAccess, patchMedicalRecord);
medicalRecordRouter.delete('/:id', authChatIdentity, verifyRecordAccess, removeMedicalRecord);
medicalRecordRouter.patch('/:id/restore', authChatIdentity, restoreMedicalRecord);

medicalRecordRouter.post(
    '/:id/attachments',
    authChatIdentity,
    verifyRecordAccess,
    upload.array('attachments', 10),
    uploadAttachmentsToRecord
);
medicalRecordRouter.delete(
    '/:id/attachments/:attachmentId',
    authChatIdentity,
    verifyRecordAccess,
    deleteAttachmentFromRecord
);

export default medicalRecordRouter;
