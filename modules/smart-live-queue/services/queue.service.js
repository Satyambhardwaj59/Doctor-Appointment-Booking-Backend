import queueModel from '../models/queue.model.js';
import queueEntryModel from '../models/queueEntry.model.js';
import appointmentModel from '../../../models/appointmentModel.js';
import { createNotification } from '../../notification-center/services/notification.service.js';
import { emitToUser } from '../sockets/queue.socket.js';

// ─── Tunables ──────────────────────────────────────────────────────────
// No consultation-duration data exists in this app yet, so estimates start
// from a default and gradually shift toward the doctor's real average as
// consultations are completed (weighted as if the default were observed
// SMOOTHING_WEIGHT times, so the first few real data points don't swing it).
const DEFAULT_AVG_MINUTES = 15;
const SMOOTHING_WEIGHT = 3;
const APPROACHING_AHEAD = 2;
const MIN_CONSULT_MINUTES = 1;
const MAX_CONSULT_MINUTES = 120;
const MAX_CALL_ATTEMPTS = 5;

const ACTIVE_STATUSES = ['CALLED', 'IN_CONSULTATION'];
const LIVE_STATUSES = ['WAITING', 'CALLED', 'IN_CONSULTATION', 'SKIPPED'];

// Same "D_M_YYYY" string the appointment system stores in slotDate.
const slotDateFor = (date = new Date()) =>
    `${date.getDate()}_${date.getMonth() + 1}_${date.getFullYear()}`;

// ─── Pure estimate + view helpers (no I/O, unit-testable) ─────────────────

const effectiveAvgMinutes = (queue) => {
    const count = queue.completedCount || 0;
    const total = queue.totalConsultMinutes || 0;
    return Math.max(1, (DEFAULT_AVG_MINUTES * SMOOTHING_WEIGHT + total) / (SMOOTHING_WEIGHT + count));
};

// entries: plain objects in any status. Returns the active entry, waiting
// entries in token order, and per-waiting-entry position/ahead/estimate.
const computeQueueState = (queue, entries, now = Date.now()) => {
    const avg = effectiveAvgMinutes(queue);
    const active = entries.find((e) => ACTIVE_STATUSES.includes(e.status)) || null;
    const waiting = entries
        .filter((e) => e.status === 'WAITING')
        .sort((a, b) => a.queueNumber - b.queueNumber);
    const skipped = entries.filter((e) => e.status === 'SKIPPED');

    let remainingActive = 0;
    if (active) {
        if (active.status === 'IN_CONSULTATION' && active.startedAt) {
            const elapsed = (now - new Date(active.startedAt).getTime()) / 60000;
            remainingActive = Math.max(0, avg - elapsed);
        } else {
            // Called but not started yet: assume a full consultation.
            remainingActive = avg;
        }
    }

    const estimates = new Map();
    waiting.forEach((entry, index) => {
        estimates.set(entry._id.toString(), {
            position: index + 1,
            patientsAhead: index + (active ? 1 : 0),
            estimatedWaitMinutes: Math.ceil(remainingActive + index * avg),
        });
    });

    return { avg, active, waiting, skipped, estimates };
};

const entryDto = (entry, state) => ({
    _id: entry._id.toString(),
    appointmentId: entry.appointmentId,
    queueNumber: entry.queueNumber,
    status: entry.status,
    patientName: entry.patientName,
    familyMemberName: entry.familyMemberName,
    joinedAt: entry.joinedAt,
    calledAt: entry.calledAt,
    startedAt: entry.startedAt,
    estimatedWaitTime: state.estimates.get(entry._id.toString())?.estimatedWaitMinutes ?? 0,
});

// What a PATIENT may see: only their own token plus anonymous aggregates
// (current number being served, how many are waiting). Never other
// patients' identities.
const patientView = (queue, state, entry) => {
    const id = entry._id.toString();
    const estimate = state.estimates.get(id);
    return {
        view: 'patient',
        queueId: queue._id.toString(),
        doctorId: queue.doctorId,
        slotDate: queue.slotDate,
        version: queue.version,
        isPaused: queue.isPaused,
        nowServing: state.active ? state.active.queueNumber : null,
        waitingCount: state.waiting.length,
        // Always flagged: this is an approximation, not a prediction.
        isEstimate: true,
        entry: {
            _id: id,
            appointmentId: entry.appointmentId,
            queueNumber: entry.queueNumber,
            status: entry.status,
            position: estimate ? estimate.position : null,
            patientsAhead: estimate ? estimate.patientsAhead : 0,
            estimatedWaitMinutes: estimate ? estimate.estimatedWaitMinutes : 0,
        },
    };
};

const doctorView = (queue, state) => ({
    view: 'doctor',
    queueId: queue._id.toString(),
    doctorId: queue.doctorId,
    slotDate: queue.slotDate,
    version: queue.version,
    isPaused: queue.isPaused,
    nowServing: state.active ? state.active.queueNumber : null,
    active: state.active ? entryDto(state.active, state) : null,
    waiting: state.waiting.map((e) => entryDto(e, state)),
    skipped: state.skipped.map((e) => entryDto(e, state)),
    waitingCount: state.waiting.length,
    completedCount: queue.completedCount || 0,
    avgConsultationMinutes: Math.round(state.avg * 10) / 10,
    isEstimate: true,
});

// ─── Data access helpers ──────────────────────────────────────────────

const getOrCreateQueue = async (doctorId, slotDate) => {
    try {
        return await queueModel.findOneAndUpdate(
            { doctorId, slotDate },
            { $setOnInsert: { doctorId, slotDate } },
            { upsert: true, new: true }
        );
    } catch (error) {
        // Two requests creating today's queue at the same instant: one wins,
        // the other simply reads it.
        if (error?.code === 11000) return queueModel.findOne({ doctorId, slotDate });
        throw error;
    }
};

// Loads the queue and its live entries. Also self-heals the active-patient
// lock if it points at an entry that is no longer CALLED/IN_CONSULTATION
// (e.g. the server stopped between acquiring the lock and updating the entry).
const loadState = async (queueId) => {
    let queue = await queueModel.findById(queueId).lean();
    const entries = await queueEntryModel
        .find({ queueId: queueId.toString(), status: { $in: LIVE_STATUSES } })
        .sort({ queueNumber: 1 })
        .lean();

    if (queue?.activeEntryId) {
        const stillActive = entries.some(
            (e) => e._id.toString() === queue.activeEntryId && ACTIVE_STATUSES.includes(e.status)
        );
        if (!stillActive) {
            await queueModel.updateOne(
                { _id: queueId, activeEntryId: queue.activeEntryId },
                { $set: { activeEntryId: null } }
            );
            queue = { ...queue, activeEntryId: null };
        }
    }
    return { queue, entries };
};

const releaseLock = (queueId, entryId) =>
    queueModel.updateOne({ _id: queueId, activeEntryId: entryId.toString() }, { $set: { activeEntryId: null } });

// ─── Notifications (via the existing Notification Center) ───────────────

const safeNotify = async ({ entry, queue, title, message, dedupeKey }) => {
    try {
        await createNotification({
            userId: entry.patientId,
            recipientRole: 'patient',
            type: 'CONSULTATION',
            title,
            message,
            // Navigation ids only — no clinical detail.
            data: { queueId: queue._id.toString(), appointmentId: entry.appointmentId, doctorId: queue.doctorId },
            dedupeKey,
        });
    } catch (error) {
        console.log('Could not create queue notification');
    }
};

const notifyApproaching = async (queue, state, event, affected) => {
    for (const entry of state.waiting) {
        const id = entry._id.toString();
        const estimate = state.estimates.get(id);
        if (!estimate || estimate.patientsAhead > APPROACHING_AHEAD || entry.approachingNotified) continue;
        // Someone who just joined an already-short queue doesn't need an
        // immediate "approaching" alert.
        if (event === 'queue:joined' && affected && affected._id.toString() === id) continue;

        // Atomic claim so concurrent updates can't both send it.
        const claimed = await queueEntryModel.findOneAndUpdate(
            { _id: entry._id, status: 'WAITING', approachingNotified: false },
            { $set: { approachingNotified: true } }
        );
        if (!claimed) continue;

        const ahead = estimate.patientsAhead;
        await safeNotify({
            entry,
            queue,
            title: 'Your turn is approaching',
            message: ahead === 0 ? "You're next in the queue" : `About ${ahead} patient${ahead > 1 ? 's' : ''} ahead of you`,
            // Keyed by token: a recalled patient keeps their token (no repeat),
            // while someone who leaves and rejoins gets a new token (notified afresh).
            dedupeKey: `queue-approaching:${id}:${entry.queueNumber}`,
        });
    }
};

// ─── Change fan-out ─────────────────────────────────────────────────

// Called after EVERY queue mutation: bumps the version, recomputes
// estimates, pushes live updates, then fires any notifications.
//   event     - specific event name (queue:called, queue:paused, ...)
//   affected  - the entry the action was about (gets the specific event)
//   broadcast - send the specific event to every patient in the queue
const afterQueueChange = async (queueId, { event = 'queue:updated', affected = null, broadcast = false } = {}) => {
    await queueModel.updateOne({ _id: queueId }, { $inc: { version: 1 } });
    const { queue, entries } = await loadState(queueId);
    const state = computeQueueState(queue, entries);

    const ops = state.waiting.map((e) => ({
        updateOne: {
            filter: { _id: e._id },
            update: { $set: { estimatedWaitTime: state.estimates.get(e._id.toString()).estimatedWaitMinutes } },
        },
    }));
    if (ops.length > 0) await queueEntryModel.bulkWrite(ops);

    const dView = { ...doctorView(queue, state), event };
    emitToUser(queue.doctorId, 'doctor', 'queue:updated', dView);
    if (event !== 'queue:updated') emitToUser(queue.doctorId, 'doctor', event, dView);

    // Everyone still in the queue, plus the affected entry even if it just
    // left the live set (completed / cancelled) so their screen updates.
    const targets = new Map(entries.map((e) => [e._id.toString(), e]));
    if (affected) {
        const plain = typeof affected.toObject === 'function' ? affected.toObject() : affected;
        targets.set(plain._id.toString(), plain);
    }

    for (const entry of targets.values()) {
        const view = { ...patientView(queue, state, entry), event };
        emitToUser(entry.patientId, 'patient', 'queue:updated', view);
        const isAffected = affected && entry._id.toString() === affected._id.toString();
        if (event !== 'queue:updated' && (broadcast || isAffected)) {
            emitToUser(entry.patientId, 'patient', event, view);
        }
    }

    await notifyApproaching(queue, state, event, affected);
    return { queue, state, entries };
};

// ─── Patient actions ──────────────────────────────────────────────────

const nextToken = async (queueId) => {
    // new:false returns the document BEFORE the increment, so the value
    // read is exactly the number this caller was assigned.
    const before = await queueModel.findOneAndUpdate({ _id: queueId }, { $inc: { nextNumber: 1 } }, { new: false });
    return before.nextNumber;
};

const joinQueue = async (patientId, appointmentId) => {
    const appointment = await appointmentModel.findById(appointmentId).catch(() => null);
    // Ownership is derived from the authenticated patient, never the body.
    if (!appointment || appointment.userId !== patientId) return { error: 'Appointment not found' };
    if (appointment.cancelled) return { error: 'This appointment was cancelled' };
    if (appointment.isCompleted) return { error: 'This appointment is already completed' };

    const today = slotDateFor();
    if (appointment.slotDate !== today) {
        return { error: 'You can only join the queue on the day of your appointment' };
    }

    const queue = await getOrCreateQueue(appointment.docId, today);

    const existing = await queueEntryModel.findOne({ appointmentId });
    if (existing && existing.status !== 'CANCELLED') {
        return { queue, entry: existing, alreadyJoined: true };
    }

    const queueNumber = await nextToken(queue._id);
    let entry;

    if (existing) {
        // Rejoining after leaving: a fresh token at the back of the line.
        entry = await queueEntryModel.findOneAndUpdate(
            { _id: existing._id, status: 'CANCELLED' },
            {
                $set: {
                    status: 'WAITING',
                    queueNumber,
                    joinedAt: new Date(),
                    calledAt: null,
                    startedAt: null,
                    completedAt: null,
                    estimatedWaitTime: 0,
                    approachingNotified: false,
                },
            },
            { new: true }
        );
        if (!entry) return { queue, entry: await queueEntryModel.findOne({ appointmentId }), alreadyJoined: true };
    } else {
        try {
            entry = await queueEntryModel.create({
                queueId: queue._id.toString(),
                doctorId: appointment.docId,
                appointmentId,
                patientId,
                familyMemberId: appointment.familyMemberId || null,
                patientName: appointment.userData?.name || '',
                familyMemberName: appointment.familyMemberData?.name || '',
                queueNumber,
            });
        } catch (error) {
            // The unique appointmentId index caught a simultaneous duplicate join.
            if (error?.code === 11000) {
                return { queue, entry: await queueEntryModel.findOne({ appointmentId }), alreadyJoined: true };
            }
            throw error;
        }
    }

    const result = await afterQueueChange(queue._id, { event: 'queue:joined', affected: entry });
    return { queue: result.queue, entry, view: patientView(result.queue, result.state, entry.toObject()) };
};

const leaveQueue = async (patientId, queueId, appointmentId) => {
    const filter = { queueId: queueId.toString(), patientId, status: { $in: ['WAITING', 'SKIPPED'] } };
    if (appointmentId) filter.appointmentId = appointmentId;

    const candidates = await queueEntryModel.find(filter);
    if (candidates.length === 0) return { error: 'You are not waiting in this queue' };
    if (candidates.length > 1) return { error: 'Please specify which appointment to leave' };

    const entry = await queueEntryModel.findOneAndUpdate(
        { _id: candidates[0]._id, status: { $in: ['WAITING', 'SKIPPED'] } },
        { $set: { status: 'CANCELLED' } },
        { new: true }
    );
    if (!entry) return { error: 'You are not waiting in this queue' };

    await afterQueueChange(queueId, { event: 'queue:updated', affected: entry });
    return { entry };
};

// ─── Reads ────────────────────────────────────────────────────────────

const getDoctorQueue = async (doctorId) => {
    const queue = await getOrCreateQueue(doctorId, slotDateFor());
    const loaded = await loadState(queue._id);
    return doctorView(loaded.queue, computeQueueState(loaded.queue, loaded.entries));
};

const getPatientQueueForDoctor = async (patientId, doctorId) => {
    const queue = await queueModel.findOne({ doctorId, slotDate: slotDateFor() }).lean();
    if (!queue) return { error: 'You are not in this queue' };

    const { queue: fresh, entries } = await loadState(queue._id);
    const state = computeQueueState(fresh, entries);
    const mine = entries.filter((e) => e.patientId === patientId);
    if (mine.length === 0) return { error: 'You are not in this queue' };

    return { positions: mine.map((e) => patientView(fresh, state, e)) };
};

// familyMemberId: undefined = every entry on the account (the queue page),
// null = the account holder's own entries, an id = that family member's.
const getMyPositions = async (patientId, familyMemberId) => {
    const queues = await queueModel.find({ slotDate: slotDateFor() }).lean();
    if (queues.length === 0) return [];

    const entryFilter = {
        patientId,
        queueId: { $in: queues.map((q) => q._id.toString()) },
        status: { $in: LIVE_STATUSES },
    };
    if (familyMemberId !== undefined) entryFilter.familyMemberId = familyMemberId;

    const mine = await queueEntryModel.find(entryFilter).lean();

    const positions = [];
    const queueIds = [...new Set(mine.map((e) => e.queueId))];
    for (const queueId of queueIds) {
        const { queue, entries } = await loadState(queueId);
        const state = computeQueueState(queue, entries);
        mine.filter((e) => e.queueId === queueId).forEach((e) => positions.push(patientView(queue, state, e)));
    }
    return positions;
};

// ─── Doctor actions ───────────────────────────────────────────────────
// Every status change below is a conditional findOneAndUpdate keyed on the
// entry's CURRENT status, so a stale or duplicate request simply matches
// nothing instead of corrupting state.

const callNext = async (queueId) => {
    let changed = false;

    for (let attempt = 0; attempt < MAX_CALL_ATTEMPTS; attempt++) {
        const { queue } = await loadState(queueId); // also heals a stale lock
        if (queue.isPaused) return { error: 'The queue is paused. Resume it to call the next patient.' };
        if (queue.activeEntryId) return { error: 'Finish or skip the current patient before calling the next one' };

        const candidate = await queueEntryModel.findOne({ queueId: queueId.toString(), status: 'WAITING' }).sort({ queueNumber: 1 });
        if (!candidate) {
            if (changed) await afterQueueChange(queueId);
            return { error: 'No patients are waiting' };
        }

        // The lock: succeeds only if nobody is active AND the queue isn't
        // paused, atomically. Two simultaneous call-next requests cannot
        // both pass this.
        const locked = await queueModel.findOneAndUpdate(
            { _id: queueId, activeEntryId: null, isPaused: false },
            { $set: { activeEntryId: candidate._id.toString() } },
            { new: true }
        );
        if (!locked) return { error: 'Another call is already in progress' };

        const entry = await queueEntryModel.findOneAndUpdate(
            { _id: candidate._id, status: 'WAITING' },
            { $set: { status: 'CALLED', calledAt: new Date() } },
            { new: true }
        );
        if (!entry) {
            // Cancelled/skipped between the read and the claim: try the next one.
            await releaseLock(queueId, candidate._id);
            continue;
        }

        const appointment = await appointmentModel.findById(entry.appointmentId).catch(() => null);
        if (!appointment || appointment.cancelled) {
            await queueEntryModel.updateOne({ _id: entry._id }, { $set: { status: 'CANCELLED' } });
            await releaseLock(queueId, entry._id);
            changed = true;
            continue;
        }

        const { queue: updated } = await afterQueueChange(queueId, { event: 'queue:called', affected: entry });
        await safeNotify({
            entry,
            queue: updated,
            title: 'You have been called',
            message: 'Your doctor is ready for you. Please proceed to your consultation.',
            dedupeKey: `queue-called:${entry._id}:${updated.version}`,
        });
        return { entry };
    }

    if (changed) await afterQueueChange(queueId);
    return { error: 'No patients are waiting' };
};

const startConsultation = async (queueId) => {
    const queue = await queueModel.findById(queueId);
    if (!queue?.activeEntryId) return { error: 'No patient has been called' };

    const entry = await queueEntryModel
        .findOneAndUpdate(
            { _id: queue.activeEntryId, queueId: queueId.toString(), status: 'CALLED' },
            { $set: { status: 'IN_CONSULTATION', startedAt: new Date() } },
            { new: true }
        )
        .catch(() => null);
    if (!entry) return { error: 'The called patient cannot be started (already started, skipped or cancelled)' };

    const { queue: updated } = await afterQueueChange(queueId, { event: 'queue:started', affected: entry });
    await safeNotify({
        entry,
        queue: updated,
        title: 'Consultation started',
        message: 'Your doctor has started your consultation.',
        dedupeKey: `queue-started:${entry._id}`,
    });
    return { entry };
};

const completeConsultation = async (queueId) => {
    const queue = await queueModel.findById(queueId);
    if (!queue?.activeEntryId) return { error: 'No consultation is in progress' };

    const entry = await queueEntryModel
        .findOneAndUpdate(
            { _id: queue.activeEntryId, queueId: queueId.toString(), status: 'IN_CONSULTATION' },
            { $set: { status: 'COMPLETED', completedAt: new Date() } },
            { new: true }
        )
        .catch(() => null);
    if (!entry) return { error: 'There is no consultation in progress to complete' };

    // Clamped so one forgotten/instant consultation can't skew every estimate.
    const rawMinutes = entry.startedAt ? (entry.completedAt - entry.startedAt) / 60000 : DEFAULT_AVG_MINUTES;
    const minutes = Math.min(MAX_CONSULT_MINUTES, Math.max(MIN_CONSULT_MINUTES, rawMinutes));

    // Release the lock and record the duration in one atomic update.
    await queueModel.updateOne(
        { _id: queueId, activeEntryId: entry._id.toString() },
        { $set: { activeEntryId: null }, $inc: { completedCount: 1, totalConsultMinutes: minutes } }
    );

    // Reuse the existing appointment record as the source of truth.
    try {
        await appointmentModel.findByIdAndUpdate(entry.appointmentId, { isCompleted: true });
    } catch (error) {
        console.log('Could not mark appointment completed');
    }

    await afterQueueChange(queueId, { event: 'queue:completed', affected: entry });
    return { entry };
};

const skipPatient = async (queueId, entryId) => {
    const queue = await queueModel.findById(queueId);
    const target = entryId || queue?.activeEntryId;
    if (!target) return { error: 'No patient to skip' };

    const entry = await queueEntryModel
        .findOneAndUpdate(
            { _id: target, queueId: queueId.toString(), status: { $in: ['WAITING', 'CALLED'] } },
            { $set: { status: 'SKIPPED' } },
            { new: true }
        )
        .catch(() => null);
    if (!entry) return { error: 'That patient cannot be skipped' };

    await releaseLock(queueId, entry._id);
    await afterQueueChange(queueId, { event: 'queue:skipped', affected: entry });
    return { entry };
};

const recallPatient = async (queueId, entryId) => {
    let target = entryId;
    if (!target) {
        const latest = await queueEntryModel
            .findOne({ queueId: queueId.toString(), status: 'SKIPPED' })
            .sort({ updatedAt: -1 });
        target = latest?._id;
    }
    if (!target) return { error: 'No skipped patients to recall' };

    const entry = await queueEntryModel
        .findOneAndUpdate(
            { _id: target, queueId: queueId.toString(), status: 'SKIPPED' },
            { $set: { status: 'WAITING', estimatedWaitTime: 0 } },
            { new: true }
        )
        .catch(() => null);
    if (!entry) return { error: 'That patient is not in the skipped list' };

    const appointment = await appointmentModel.findById(entry.appointmentId).catch(() => null);
    if (!appointment || appointment.cancelled) {
        await queueEntryModel.updateOne({ _id: entry._id }, { $set: { status: 'CANCELLED' } });
        await afterQueueChange(queueId);
        return { error: 'That appointment was cancelled' };
    }

    // The recalled patient keeps their original token number, so they are
    // next in line.
    await afterQueueChange(queueId, { event: 'queue:updated', affected: entry });
    return { entry };
};

const notifyWaiting = async (queue, entries, title, message, keyPrefix) => {
    for (const entry of entries.filter((e) => e.status === 'WAITING')) {
        await safeNotify({
            entry,
            queue,
            title,
            message,
            dedupeKey: `${keyPrefix}:${entry._id}:${queue.version}`,
        });
    }
};

const pauseQueue = async (queueId) => {
    const paused = await queueModel.findOneAndUpdate(
        { _id: queueId, isPaused: false },
        { $set: { isPaused: true, pausedAt: new Date() } },
        { new: true }
    );
    if (!paused) return { error: 'The queue is already paused' };

    const { queue, entries } = await afterQueueChange(queueId, { event: 'queue:paused', broadcast: true });
    await notifyWaiting(queue, entries, 'Queue delayed', "Your doctor has paused the queue. We'll let you know when it resumes.", 'queue-paused');
    return { queue };
};

const resumeQueue = async (queueId) => {
    const resumed = await queueModel.findOneAndUpdate(
        { _id: queueId, isPaused: true },
        { $set: { isPaused: false, pausedAt: null } },
        { new: true }
    );
    if (!resumed) return { error: 'The queue is not paused' };

    const { queue, entries } = await afterQueueChange(queueId, { event: 'queue:resumed', broadcast: true });
    await notifyWaiting(queue, entries, 'Queue resumed', 'The queue is moving again.', 'queue-resumed');
    return { queue };
};

// ─── Integration hook for appointment cancellation ───────────────────

// Called from the existing cancel-appointment controllers so a cancelled
// appointment never stays in (or gets called from) the queue.
const cancelEntryForAppointment = async (appointmentId) => {
    const entry = await queueEntryModel.findOneAndUpdate(
        { appointmentId: appointmentId.toString(), status: { $in: ['WAITING', 'CALLED', 'SKIPPED'] } },
        { $set: { status: 'CANCELLED' } },
        { new: true }
    );
    if (!entry) return null;

    await releaseLock(entry.queueId, entry._id);
    await afterQueueChange(entry.queueId, { event: 'queue:updated', affected: entry });
    return entry;
};

export {
    slotDateFor,
    effectiveAvgMinutes,
    computeQueueState,
    patientView,
    doctorView,
    getOrCreateQueue,
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
    cancelEntryForAppointment,
};
