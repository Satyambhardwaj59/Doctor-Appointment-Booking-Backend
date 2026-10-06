import {
    joinQueue,
    leaveQueue,
    getDoctorQueue,
    getPatientQueueForDoctor,
    getMyPositions,
    callNext,
    startConsultation,
    completeConsultation,
    skipPatient,
    recallPatient,
    pauseQueue,
    resumeQueue,
} from '../services/queue.service.js';
import { isValidId, validateJoin, validateEntryTarget } from '../validators/queue.validator.js';

// Wraps a handler so unexpected errors never leak internals to the client.
const safe = (message, handler) => async (req, res) => {
    try {
        await handler(req, res);
    } catch (error) {
        console.log(error);
        res.json({ success: false, message });
    }
};

// GET /api/queues/:doctorId
const getQueue = safe('Could not load the queue', async (req, res) => {
    const { id: viewerId, role } = req.chatUser;
    const { doctorId } = req.params;

    if (role === 'doctor') {
        // A doctor can only open their own queue.
        if (doctorId !== viewerId) return res.json({ success: false, message: 'Queue not found' });
        return res.json({ success: true, queue: await getDoctorQueue(viewerId) });
    }

    const result = await getPatientQueueForDoctor(viewerId, doctorId);
    if (result.error) return res.json({ success: false, message: result.error });
    res.json({ success: true, positions: result.positions });
});

// GET /api/queues/my-position (patient)
const getMyPosition = safe('Could not load your queue position', async (req, res) => {
    res.json({ success: true, positions: await getMyPositions(req.chatUser.id) });
});

// POST /api/queues/join (patient)
const join = safe('Could not join the queue', async (req, res) => {
    const validation = validateJoin(req.body);
    if (!validation.valid) return res.json({ success: false, message: validation.message });

    const result = await joinQueue(req.chatUser.id, req.body.appointmentId);
    if (result.error) return res.json({ success: false, message: result.error });

    res.json({
        success: true,
        alreadyJoined: !!result.alreadyJoined,
        queueId: result.queue._id.toString(),
        entryId: result.entry._id.toString(),
    });
});

// DELETE /api/queues/:queueId/leave (patient)
const leave = safe('Could not leave the queue', async (req, res) => {
    const { queueId } = req.params;
    if (!isValidId(queueId)) return res.json({ success: false, message: 'Queue not found' });

    const appointmentId = req.query.appointmentId;
    if (appointmentId !== undefined && !isValidId(appointmentId)) {
        return res.json({ success: false, message: 'appointmentId is invalid' });
    }

    const result = await leaveQueue(req.chatUser.id, queueId, appointmentId);
    if (result.error) return res.json({ success: false, message: result.error });
    res.json({ success: true, message: 'You have left the queue' });
});

// Doctor actions: ownership already verified by verifyQueueOwnership.
const respond = (res, result, key = 'entry') => {
    if (result.error) return res.json({ success: false, message: result.error });
    res.json({ success: true, [key]: result[key] });
};

const callNextPatient = safe('Could not call the next patient', async (req, res) =>
    respond(res, await callNext(req.queue._id)));

const start = safe('Could not start the consultation', async (req, res) =>
    respond(res, await startConsultation(req.queue._id)));

const complete = safe('Could not complete the consultation', async (req, res) =>
    respond(res, await completeConsultation(req.queue._id)));

const skip = safe('Could not skip the patient', async (req, res) => {
    const validation = validateEntryTarget(req.body, { required: false });
    if (!validation.valid) return res.json({ success: false, message: validation.message });
    respond(res, await skipPatient(req.queue._id, req.body?.entryId));
});

const recall = safe('Could not recall the patient', async (req, res) => {
    const validation = validateEntryTarget(req.body, { required: false });
    if (!validation.valid) return res.json({ success: false, message: validation.message });
    respond(res, await recallPatient(req.queue._id, req.body?.entryId));
});

const pause = safe('Could not pause the queue', async (req, res) => {
    const result = await pauseQueue(req.queue._id);
    if (result.error) return res.json({ success: false, message: result.error });
    res.json({ success: true, message: 'Queue paused' });
});

const resume = safe('Could not resume the queue', async (req, res) => {
    const result = await resumeQueue(req.queue._id);
    if (result.error) return res.json({ success: false, message: result.error });
    res.json({ success: true, message: 'Queue resumed' });
});

export { getQueue, getMyPosition, join, leave, callNextPatient, start, complete, skip, recall, pause, resume };
