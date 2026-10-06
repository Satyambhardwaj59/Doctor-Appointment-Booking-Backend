import express from 'express';
import {
    getQueue,
    getMyPosition,
    join,
    leave,
    callNextPatient,
    start,
    complete,
    skip,
    recall,
    pause,
    resume,
} from '../controllers/queue.controller.js';
import { requireRole, verifyQueueOwnership } from '../middleware/queueAccess.middleware.js';
import { authChatIdentity } from '../../doctor-patient-chat/index.js';

const doctorOnly = requireRole('doctor', 'Only doctors can manage the queue');
const patientOnly = requireRole('patient', 'Only patients can use this action');

const queueRouter = express.Router();

queueRouter.get('/my-position', authChatIdentity, patientOnly, getMyPosition);
queueRouter.post('/join', authChatIdentity, patientOnly, join);

queueRouter.patch('/:queueId/call-next', authChatIdentity, doctorOnly, verifyQueueOwnership, callNextPatient);
queueRouter.patch('/:queueId/start', authChatIdentity, doctorOnly, verifyQueueOwnership, start);
queueRouter.patch('/:queueId/complete', authChatIdentity, doctorOnly, verifyQueueOwnership, complete);
queueRouter.patch('/:queueId/skip', authChatIdentity, doctorOnly, verifyQueueOwnership, skip);
queueRouter.patch('/:queueId/recall', authChatIdentity, doctorOnly, verifyQueueOwnership, recall);
queueRouter.patch('/:queueId/pause', authChatIdentity, doctorOnly, verifyQueueOwnership, pause);
queueRouter.patch('/:queueId/resume', authChatIdentity, doctorOnly, verifyQueueOwnership, resume);
queueRouter.delete('/:queueId/leave', authChatIdentity, patientOnly, leave);

queueRouter.get('/:doctorId', authChatIdentity, getQueue);

export default queueRouter;
