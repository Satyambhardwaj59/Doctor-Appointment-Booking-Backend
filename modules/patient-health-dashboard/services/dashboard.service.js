import mongoose from 'mongoose';
import appointmentModel from '../../../models/appointmentModel.js';
import userModel from '../../../models/userModel.js';
import doctorModel from '../../../models/doctorModel.js';
import { getOwnedFamilyMember } from '../../family-accounts/index.js';
import {
    listRecords,
    listRecordRefsByAppointments,
} from '../../digital-medical-records/services/medicalRecord.service.js';
import { listPrescriptions, getTodayMedications } from '../../prescription-management/services/prescription.service.js';
import { getMyPositions } from '../../smart-live-queue/services/queue.service.js';
import { listNotifications, getUnreadCount } from '../../notification-center/services/notification.service.js';

// Dashboard sections are previews, not lists: deliberately small limits.
const RECENT_LIMIT = 3;
const ACTIVE_PRESCRIPTIONS_LIMIT = 5;
const ACTIVE_MEDICINES_LIMIT = 6;
const NOTIFICATIONS_LIMIT = 5;

// ─── Pure helpers (no I/O) ────────────────────────────────────────────────

// slotDate is "D_M_YYYY"; slotTime comes from the browser's
// toLocaleTimeString, so it may be 12-hour ("10:30 AM") or 24-hour
// ("14:30"). If no time can be read, the appointment is treated as the end
// of its day so it never drops off the dashboard early.
const parseSlotDateTime = (slotDate, slotTime) => {
    const [day, month, year] = String(slotDate || '').split('_').map(Number);
    if (!day || !month || !year) return null;

    let hours = 23;
    let minutes = 59;
    const match = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(slotTime || '');
    if (match) {
        hours = Number(match[1]);
        minutes = Number(match[2]);
        const meridiem = match[3]?.toUpperCase();
        if (meridiem === 'PM' && hours < 12) hours += 12;
        if (meridiem === 'AM' && hours === 12) hours = 0;
    }
    return new Date(year, month - 1, day, hours, minutes);
};

const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
};

const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Only what the dashboard shows about a doctor — no fees, address, etc.
const doctorSnapshot = (docId, docData) => ({
    id: docId,
    name: docData?.name || 'Doctor',
    speciality: docData?.speciality || '',
    image: typeof docData?.image === 'string' && docData.image.startsWith('http') ? docData.image : '',
});

const appointmentSummary = (appointment, when, now) => {
    const isToday = isSameDay(when, now);
    return {
        _id: appointment._id.toString(),
        slotDate: appointment.slotDate,
        slotTime: appointment.slotTime,
        isToday,
        status: isToday ? 'TODAY' : 'UPCOMING',
        payment: !!appointment.payment,
        doctor: doctorSnapshot(appointment.docId, appointment.docData),
    };
};

// Prefer the patient who needs to act now, then the earliest in line.
const QUEUE_PRIORITY = { CALLED: 0, IN_CONSULTATION: 1, WAITING: 2, SKIPPED: 3 };
const pickQueuePosition = (positions) =>
    [...positions].sort((a, b) => {
        const byStatus = (QUEUE_PRIORITY[a.entry.status] ?? 9) - (QUEUE_PRIORITY[b.entry.status] ?? 9);
        return byStatus !== 0 ? byStatus : a.entry.queueNumber - b.entry.queueNumber;
    })[0] || null;

const medicationSummary = (entries) => {
    const summary = { total: entries.length, taken: 0, pending: 0, missed: 0, skipped: 0 };
    entries.forEach((e) => {
        const key = String(e.status).toLowerCase();
        if (key in summary) summary[key] += 1;
    });
    return summary;
};

// ─── Section loaders (each reuses an existing service) ────────────────────

const loadUpcoming = async (scope) => {
    const candidates = await appointmentModel
        .find({ ...scope, cancelled: false, isCompleted: false })
        .sort({ date: -1 })
        .limit(100)
        .lean();

    const now = new Date();
    const todayStart = startOfToday();
    const upcoming = candidates
        .map((appointment) => ({ appointment, when: parseSlotDateTime(appointment.slotDate, appointment.slotTime) }))
        .filter((x) => x.when && x.when >= todayStart)
        .sort((a, b) => a.when - b.when);

    return {
        upcomingAppointment: upcoming[0] ? appointmentSummary(upcoming[0].appointment, upcoming[0].when, now) : null,
        upcomingCount: upcoming.length,
    };
};

const loadQueue = async (patientId, familyMemberId) => {
    // null = the account holder's own entries; an id = that family member's.
    const positions = await getMyPositions(patientId, familyMemberId);
    return { queueStatus: pickQueuePosition(positions) };
};

const loadRecords = async (patientId, familyMemberId) => {
    const { records } = await listRecords(patientId, 'patient', {
        familyMember: familyMemberId || undefined,
        page: 1,
        limit: RECENT_LIMIT,
    });

    // Summary only: type, title, date, doctor. No diagnosis, notes or files.
    return {
        recentRecords: (records || []).map((r) => ({
            _id: r._id.toString(),
            recordType: r.recordType,
            title: r.title,
            recordDate: r.recordDate,
            doctorId: r.doctorId,
        })),
    };
};

const loadPrescriptions = async (patientId, familyMemberId) => {
    const scope = { familyMember: familyMemberId || undefined, page: 1 };
    const [recent, active] = await Promise.all([
        listPrescriptions(patientId, 'patient', { ...scope, limit: RECENT_LIMIT }),
        listPrescriptions(patientId, 'patient', { ...scope, status: 'ACTIVE', limit: ACTIVE_PRESCRIPTIONS_LIMIT }),
    ]);

    const activeMedications = [];
    for (const prescription of active.prescriptions || []) {
        for (const medicine of prescription.medicines || []) {
            if (activeMedications.length >= ACTIVE_MEDICINES_LIMIT) break;
            activeMedications.push({
                prescriptionId: prescription._id.toString(),
                name: medicine.name,
                dosage: medicine.dosage,
                frequency: medicine.frequency,
                timing: medicine.timing,
            });
        }
    }

    return {
        recentPrescriptions: {
            items: (recent.prescriptions || []).map((p) => ({
                _id: p._id.toString(),
                prescriptionDate: p.prescriptionDate,
                status: p.status,
                medicineCount: (p.medicines || []).length,
                doctorId: p.doctorId,
            })),
            activeCount: active.total || 0,
        },
        activeMedications,
    };
};

const loadTodayMedications = async (patientId, familyMemberId) => {
    const result = await getTodayMedications(patientId, familyMemberId || undefined);
    const entries = result.medications || [];

    return {
        todayMedications: {
            items: entries.map((m) => ({
                _id: m._id.toString(),
                medicineName: m.medicineName,
                dosage: m.dosage,
                timing: m.timing,
                scheduledTime: m.scheduledTime,
                status: m.status,
            })),
            summary: medicationSummary(entries),
            nextDose: result.nextDose
                ? {
                      _id: result.nextDose._id.toString(),
                      medicineName: result.nextDose.medicineName,
                      dosage: result.nextDose.dosage,
                      scheduledTime: result.nextDose.scheduledTime,
                  }
                : null,
        },
    };
};

// There is no consultation model on the backend (video consultation lives on
// the frontend only). The real consultation record in this app is a
// completed appointment — the live queue marks the appointment completed
// when a consultation finishes — so that is what this section reflects.
const loadConsultations = async (patientId, scope) => {
    const completed = await appointmentModel
        .find({ ...scope, isCompleted: true, cancelled: false })
        .sort({ date: -1 })
        .limit(20)
        .lean();

    const recent = completed
        .map((appointment) => ({ appointment, when: parseSlotDateTime(appointment.slotDate, appointment.slotTime) }))
        .filter((x) => x.when)
        .sort((a, b) => b.when - a.when)
        .slice(0, RECENT_LIMIT);

    const ids = recent.map((x) => x.appointment._id.toString());
    const refs = await listRecordRefsByAppointments(patientId, ids);

    return {
        recentConsultations: recent.map(({ appointment }) => ({
            appointmentId: appointment._id.toString(),
            slotDate: appointment.slotDate,
            slotTime: appointment.slotTime,
            status: 'COMPLETED',
            doctor: doctorSnapshot(appointment.docId, appointment.docData),
            relatedRecordIds: refs
                .filter((ref) => ref.appointmentId === appointment._id.toString())
                .map((ref) => ref._id.toString()),
        })),
    };
};

// Notifications belong to the account holder, so they are the same
// whichever profile is selected.
const loadNotifications = async (patientId) => {
    const [list, unreadCount] = await Promise.all([
        listNotifications(patientId, 'patient', { isRead: 'false', page: 1, limit: NOTIFICATIONS_LIMIT }),
        getUnreadCount(patientId, 'patient'),
    ]);

    return {
        unreadNotifications: {
            unreadCount,
            items: (list.notifications || []).map((n) => ({
                _id: n._id.toString(),
                type: n.type,
                title: n.title,
                message: n.message,
                createdAt: n.createdAt,
                data: n.data || {},
            })),
        },
    };
};

const loadProfile = async (patientId, member) => {
    if (member) {
        return {
            name: member.name,
            relationship: member.relationship,
            image: member.profileImage || '',
            isFamilyMember: true,
            familyMemberId: member._id.toString(),
        };
    }
    // Name only: the account's stored image can be a large inline data URI.
    const user = await userModel.findById(patientId).select('name').lean().catch(() => null);
    return { name: user?.name || '', relationship: 'SELF', image: '', isFamilyMember: false, familyMemberId: null };
};

// One query for every doctor referenced, instead of one per section.
const resolveDoctors = async (doctorIds) => {
    const valid = [...new Set(doctorIds)].filter((id) => id && mongoose.Types.ObjectId.isValid(id));
    if (valid.length === 0) return new Map();

    const doctors = await doctorModel.find({ _id: { $in: valid } }).select('name speciality').lean().catch(() => []);
    return new Map(doctors.map((d) => [d._id.toString(), { id: d._id.toString(), name: d.name, speciality: d.speciality }]));
};

// ─── Aggregation ─────────────────────────────────────────────────────────

const getDashboard = async (patientId, familyMemberId) => {
    // Ownership of the family member is verified with the existing Family
    // Accounts logic. The id alone grants nothing.
    let member = null;
    if (familyMemberId) {
        member = await getOwnedFamilyMember(patientId, familyMemberId);
        if (!member) return { error: 'Family member not found' };
    }
    const scopedMemberId = member ? member._id.toString() : null;
    // null matches appointments with no familyMemberId (the account holder's own).
    const appointmentScope = { userId: patientId, familyMemberId: scopedMemberId };

    // Sections run in parallel and fail independently: one broken section
    // shows an error in its own card, not a broken dashboard.
    const loaders = {
        appointments: () => loadUpcoming(appointmentScope),
        queue: () => loadQueue(patientId, scopedMemberId),
        records: () => loadRecords(patientId, scopedMemberId),
        prescriptions: () => loadPrescriptions(patientId, scopedMemberId),
        medications: () => loadTodayMedications(patientId, scopedMemberId),
        consultations: () => loadConsultations(patientId, appointmentScope),
        notifications: () => loadNotifications(patientId),
    };
    const names = Object.keys(loaders);
    const settled = await Promise.allSettled(names.map((name) => loaders[name]()));

    const sections = {};
    const sectionErrors = {};
    settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            Object.assign(sections, result.value);
        } else {
            sectionErrors[names[index]] = 'This section could not be loaded right now.';
            console.log(`Dashboard section "${names[index]}" failed`); // no data in logs
        }
    });

    const doctorIds = [
        ...(sections.recentRecords || []).map((r) => r.doctorId),
        ...(sections.recentPrescriptions?.items || []).map((p) => p.doctorId),
        sections.queueStatus?.doctorId,
    ];
    const doctors = await resolveDoctors(doctorIds);
    const withDoctor = (item) => ({ ...item, doctor: doctors.get(item.doctorId) || { id: item.doctorId, name: 'Doctor', speciality: '' } });

    return {
        generatedAt: new Date().toISOString(),
        profile: await loadProfile(patientId, member),
        upcomingAppointment: sections.upcomingAppointment ?? null,
        upcomingCount: sections.upcomingCount ?? 0,
        queueStatus: sections.queueStatus
            ? { ...sections.queueStatus, doctor: doctors.get(sections.queueStatus.doctorId) || { id: sections.queueStatus.doctorId, name: 'Doctor', speciality: '' } }
            : null,
        recentRecords: (sections.recentRecords || []).map(withDoctor),
        recentPrescriptions: sections.recentPrescriptions
            ? { ...sections.recentPrescriptions, items: sections.recentPrescriptions.items.map(withDoctor) }
            : { items: [], activeCount: 0 },
        activeMedications: sections.activeMedications || [],
        todayMedications: sections.todayMedications || {
            items: [],
            summary: { total: 0, taken: 0, pending: 0, missed: 0, skipped: 0 },
            nextDose: null,
        },
        recentConsultations: sections.recentConsultations || [],
        unreadNotifications: sections.unreadNotifications || { unreadCount: 0, items: [] },
        sectionErrors,
    };
};

export { getDashboard, parseSlotDateTime, pickQueuePosition, medicationSummary };
