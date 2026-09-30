import express from 'express';
import {
    createNewPrescription,
    getPrescriptions,
    getPrescription,
    patchPrescription,
    uploadPrescriptionAttachments,
    deletePrescriptionAttachment,
    getMedications,
    getTodaysMedications,
    patchMedicationStatus,
} from '../controllers/prescription.controller.js';
import { requireRole, verifyPrescriptionAccess } from '../middleware/prescriptionAccess.middleware.js';
import { authChatIdentity } from '../../doctor-patient-chat/index.js';
import upload from '../../../middleware/multer.js';

const doctorOnly = requireRole('doctor', 'Only doctors can modify prescriptions');
const patientOnly = requireRole('patient', 'Only patients can access medication schedules');

const prescriptionRouter = express.Router();

prescriptionRouter.post('/', authChatIdentity, doctorOnly, createNewPrescription);
prescriptionRouter.get('/', authChatIdentity, getPrescriptions);
prescriptionRouter.get('/:id', authChatIdentity, verifyPrescriptionAccess, getPrescription);
prescriptionRouter.patch('/:id', authChatIdentity, doctorOnly, verifyPrescriptionAccess, patchPrescription);

prescriptionRouter.post(
    '/:id/attachments',
    authChatIdentity,
    doctorOnly,
    verifyPrescriptionAccess,
    upload.array('attachments', 10),
    uploadPrescriptionAttachments
);
prescriptionRouter.delete(
    '/:id/attachments/:attachmentId',
    authChatIdentity,
    doctorOnly,
    verifyPrescriptionAccess,
    deletePrescriptionAttachment
);

const medicationRouter = express.Router();

medicationRouter.get('/today', authChatIdentity, patientOnly, getTodaysMedications);
medicationRouter.get('/', authChatIdentity, patientOnly, getMedications);
medicationRouter.patch('/:id/status', authChatIdentity, patientOnly, patchMedicationStatus);

export { prescriptionRouter, medicationRouter };
