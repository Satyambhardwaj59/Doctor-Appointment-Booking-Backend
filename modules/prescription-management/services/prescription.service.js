import { v2 as cloudinary } from 'cloudinary';
import prescriptionModel from '../models/prescription.model.js';
import medicationModel from '../models/medication.model.js';
import appointmentModel from '../../../models/appointmentModel.js';
import doctorModel from '../../../models/doctorModel.js';
import userModel from '../../../models/userModel.js';
import { getOwnedFamilyMember } from '../../family-accounts/index.js';
import {
    createRecord as createMedicalRecord,
    updateRecord as updateMedicalRecord,
} from '../../digital-medical-records/services/medicalRecord.service.js';
import { createNotification } from '../../notification-center/services/notification.service.js';
import {
    validateCreatePrescription,
    validateUpdatePrescription,
    validateMedicationStatusUpdate,
    validateAttachmentFiles,
    MAX_ATTACHMENTS,
} from '../validators/prescription.validator.js';

// ─── Schedule generation ───────────────────────────────────────────────────
// The Medicine structure has no clock-time field, so doses are placed at
// simple default times per frequency. "As Needed" medicines get no
// scheduled entries. Times use the server's local timezone.
const DOSE_HOURS = {
    Once: [8],
    Twice: [8, 20],
    Thrice: [8, 14, 20],
};
const MAX_SCHEDULE_DAYS = 90;
const MISSED_GRACE_MINUTES = 60;
const EARLY_MARK_WINDOW_MINUTES = 120;

const parseDurationDays = (duration) => {
    const match = /(\d+)\s*(day|days|d|week|weeks|w)\b/i.exec(duration || '');
    if (!match) return 0;
    const amount = Number(match[1]);
    const isWeeks = match[2].toLowerCase().startsWith('w');
    return Math.min(MAX_SCHEDULE_DAYS, isWeeks ? amount * 7 : amount);
};

const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const buildScheduleEntries = (prescription, existingKeys = new Set()) => {
    const entries = [];
    const now = new Date();
    const firstDay = startOfDay(now);

    prescription.medicines.forEach((medicine) => {
        const hours = DOSE_HOURS[medicine.frequency];
        const days = parseDurationDays(medicine.duration);
        if (!hours || days === 0) return;

        for (let day = 0; day < days; day++) {
            hours.forEach((hour) => {
                const scheduledTime = new Date(firstDay);
                scheduledTime.setDate(firstDay.getDate() + day);
                scheduledTime.setHours(hour, 0, 0, 0);

                // Don't create doses that are already in the past.
                if (scheduledTime.getTime() < now.getTime()) return;

                const key = `${medicine._id}:${scheduledTime.getTime()}`;
                if (existingKeys.has(key)) return;

                entries.push({
                    prescriptionId: prescription._id.toString(),
                    medicineId: medicine._id.toString(),
                    patientId: prescription.patientId,
                    familyMemberId: prescription.familyMemberId,
                    medicineName: medicine.name,
                    dosage: medicine.dosage,
                    timing: medicine.timing,
                    scheduledTime,
                });
            });
        }
    });

    return entries;
};

// ─── Lazy state maintenance (no background worker exists in this app) ─────
const expireStalePrescriptions = async (filter = {}) => {
    await prescriptionModel.updateMany(
        { ...filter, status: 'ACTIVE', validUntil: { $ne: null, $lt: new Date() } },
        { $set: { status: 'EXPIRED' } }
    );
};

const markOverdueMissed = async (patientId) => {
    const cutoff = new Date(Date.now() - MISSED_GRACE_MINUTES * 60 * 1000);
    const overdue = await medicationModel.find({ patientId, status: 'PENDING', scheduledTime: { $lt: cutoff } });
    if (overdue.length === 0) return;

    await medicationModel.updateMany(
        { _id: { $in: overdue.map((entry) => entry._id) } },
        { $set: { status: 'MISSED' } }
    );

    for (const entry of overdue) {
        try {
            await createNotification({
                userId: entry.patientId,
                recipientRole: 'patient',
                type: 'MEDICATION',
                title: 'Missed medication',
                message: `You missed your ${entry.medicineName} dose scheduled at ${entry.scheduledTime.toLocaleTimeString()}`,
                data: { medicationId: entry._id.toString(), prescriptionId: entry.prescriptionId },
                // Ensures this specific missed dose is only ever notified
                // once, even though this check re-runs on every
                // list/today-medications call rather than a cron job.
                dedupeKey: `medication-missed:${entry._id.toString()}`,
            });
        } catch (notifyError) {
            console.log('Could not create medication-missed notification');
        }
    }
};

const uploadAttachments = async (files) => {
    const uploads = await Promise.all(
        files.map((file) =>
            cloudinary.uploader.upload(file.path, {
                resource_type: file.mimetype === 'application/pdf' ? 'raw' : 'image',
            })
        )
    );
    return uploads.map((result, index) => ({
        url: result.secure_url,
        publicId: result.public_id,
        fileName: files[index].originalname,
        fileType: files[index].mimetype,
        fileSize: files[index].size,
    }));
};

const pickMedicineFields = (medicine) => ({
    name: String(medicine.name).trim(),
    dosage: String(medicine.dosage).trim(),
    form: medicine.form || 'Tablet',
    frequency: medicine.frequency,
    timing: medicine.timing || 'After Food',
    duration: medicine.duration || '',
    quantity: Number(medicine.quantity) || 0,
    instructions: medicine.instructions || '',
});

// ─── Prescriptions ──────────────────────────────────────────────────────

// Doctor-only. patientId and familyMemberId are derived from the verified
// appointment, never accepted from the request body.
const createPrescription = async (doctorId, body) => {
    const validation = validateCreatePrescription(body);
    if (!validation.valid) return { prescription: null, error: validation.message };

    const appointment = await appointmentModel.findById(body.appointmentId).catch(() => null);
    if (!appointment || appointment.docId !== doctorId || appointment.cancelled) {
        return { prescription: null, error: 'Appointment not found' };
    }

    const prescriptionDate = body.prescriptionDate ? new Date(body.prescriptionDate) : new Date();

    const prescription = await prescriptionModel.create({
        patientId: appointment.userId,
        doctorId,
        appointmentId: appointment._id.toString(),
        consultationId: body.consultationId || null,
        familyMemberId: appointment.familyMemberId || null,
        medicines: body.medicines.map(pickMedicineFields),
        diagnosis: body.diagnosis || '',
        instructions: body.instructions || '',
        doctorNotes: body.doctorNotes || '',
        prescriptionDate,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        status: 'ACTIVE',
    });

    // Link to Digital Medical Records by reusing its service (which performs
    // its own doctor-patient eligibility and family-member ownership checks)
    // rather than duplicating record logic here. A failure to create the
    // record must not lose the prescription itself.
    try {
        const { record } = await createMedicalRecord({
            creatorId: doctorId,
            creatorRole: 'doctor',
            body: {
                recordType: 'PRESCRIPTION',
                title: `Prescription - ${prescriptionDate.toISOString().split('T')[0]}`,
                description: prescription.instructions,
                diagnosis: prescription.diagnosis,
                doctorNotes: prescription.doctorNotes,
                recordDate: prescriptionDate.toISOString(),
                patientId: prescription.patientId,
                familyMemberId: prescription.familyMemberId,
                appointmentId: prescription.appointmentId,
                consultationId: prescription.consultationId,
            },
            files: [],
        });
        if (record) {
            prescription.medicalRecordId = record._id.toString();
            await prescription.save();
        }
    } catch (error) {
        console.log('Could not link medical record for prescription');
    }

    const entries = buildScheduleEntries(prescription);
    if (entries.length > 0) {
        await medicationModel.insertMany(entries);
    }

    try {
        await createNotification({
            userId: prescription.patientId,
            recipientRole: 'patient',
            type: 'PRESCRIPTION',
            title: 'New prescription',
            message: 'Your doctor added a new prescription',
            data: { prescriptionId: prescription._id.toString() },
        });
    } catch (notifyError) {
        console.log('Could not create new-prescription notification');
    }

    return { prescription, error: null };
};

const listPrescriptions = async (viewerId, viewerRole, filters = {}) => {
    const query = {};

    if (viewerRole === 'doctor') {
        query.doctorId = viewerId;
        if (filters.patient) query.patientId = filters.patient;
    } else {
        query.patientId = viewerId;
        if (filters.familyMember) {
            const familyMember = await getOwnedFamilyMember(viewerId, filters.familyMember);
            if (!familyMember) return { ineligibleFamilyMember: true };
            query.familyMemberId = familyMember._id.toString();
        } else {
            // Default scope: the account holder's own prescriptions.
            query.familyMemberId = null;
        }
        if (filters.doctor) query.doctorId = filters.doctor;
    }

    await expireStalePrescriptions(query);

    if (filters.status) query.status = filters.status;

    if (filters.dateFrom || filters.dateTo) {
        query.prescriptionDate = {};
        if (filters.dateFrom) query.prescriptionDate.$gte = new Date(filters.dateFrom);
        if (filters.dateTo) query.prescriptionDate.$lte = new Date(filters.dateTo);
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 10));

    const [prescriptions, total] = await Promise.all([
        prescriptionModel
            .find(query)
            .sort({ prescriptionDate: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
        prescriptionModel.countDocuments(query),
    ]);

    return { prescriptions, total, page, limit };
};

// null for both "not found" and "not yours".
const getOwnedPrescription = async (prescriptionId, viewerId, viewerRole) => {
    const prescription = await prescriptionModel.findById(prescriptionId).catch(() => null);
    if (!prescription) return null;

    const owns =
        (viewerRole === 'doctor' && prescription.doctorId === viewerId) ||
        (viewerRole === 'patient' && prescription.patientId === viewerId);
    if (!owns) return null;

    await expireStalePrescriptions({ _id: prescription._id });
    return prescriptionModel.findById(prescription._id);
};

// Prescriptions are fully doctor-authored: only the authoring doctor may
// edit them. Patients can read them and track their doses, nothing more.
const updatePrescription = async (prescriptionId, doctorId, body) => {
    const prescription = await getOwnedPrescription(prescriptionId, doctorId, 'doctor');
    if (!prescription) return { prescription: null, error: 'Prescription not found' };

    const validation = validateUpdatePrescription(body);
    if (!validation.valid) return { prescription: null, error: validation.message };

    const medicinesChanged = body.medicines !== undefined;

    if (medicinesChanged) {
        const existingIds = new Set(prescription.medicines.map((m) => m._id.toString()));
        prescription.medicines = body.medicines.map((medicine) => {
            const fields = pickMedicineFields(medicine);
            // Keep the id of a medicine that already exists so its
            // schedule history stays attached; otherwise a new id is made.
            if (medicine._id && existingIds.has(String(medicine._id))) {
                fields._id = medicine._id;
            }
            return fields;
        });
    }
    if (body.diagnosis !== undefined) prescription.diagnosis = body.diagnosis;
    if (body.instructions !== undefined) prescription.instructions = body.instructions;
    if (body.doctorNotes !== undefined) prescription.doctorNotes = body.doctorNotes;
    if (body.validUntil !== undefined) prescription.validUntil = body.validUntil ? new Date(body.validUntil) : null;
    if (body.status !== undefined) prescription.status = body.status;

    await prescription.save();

    const prescriptionKey = prescription._id.toString();

    if (medicinesChanged) {
        // Drop upcoming doses and rebuild them; taken/skipped/missed history stays.
        await medicationModel.deleteMany({ prescriptionId: prescriptionKey, status: 'PENDING' });
        if (prescription.status === 'ACTIVE') {
            const kept = await medicationModel.find({ prescriptionId: prescriptionKey });
            const keys = new Set(kept.map((e) => `${e.medicineId}:${e.scheduledTime.getTime()}`));
            const entries = buildScheduleEntries(prescription, keys);
            if (entries.length > 0) await medicationModel.insertMany(entries);
        }
    } else if (body.status === 'COMPLETED') {
        // A completed course has no further upcoming doses.
        await medicationModel.deleteMany({
            prescriptionId: prescriptionKey,
            status: 'PENDING',
            scheduledTime: { $gt: new Date() },
        });
    }

    if (prescription.medicalRecordId) {
        try {
            await updateMedicalRecord(prescription.medicalRecordId, doctorId, 'doctor', {
                description: prescription.instructions,
                diagnosis: prescription.diagnosis,
                doctorNotes: prescription.doctorNotes,
            });
        } catch (error) {
            console.log('Could not sync linked medical record');
        }
    }

    try {
        await createNotification({
            userId: prescription.patientId,
            recipientRole: 'patient',
            type: 'PRESCRIPTION',
            title: 'Prescription updated',
            message: 'Your doctor updated your prescription',
            data: { prescriptionId: prescription._id.toString() },
        });
    } catch (notifyError) {
        console.log('Could not create prescription-updated notification');
    }

    return { prescription, error: null };
};

const addAttachments = async (prescriptionId, doctorId, files) => {
    const prescription = await getOwnedPrescription(prescriptionId, doctorId, 'doctor');
    if (!prescription) return { prescription: null, error: 'Prescription not found' };

    const fileValidation = validateAttachmentFiles(files);
    if (!fileValidation.valid) return { prescription: null, error: fileValidation.message };

    if (prescription.attachments.length + files.length > MAX_ATTACHMENTS) {
        return { prescription: null, error: `A prescription can have at most ${MAX_ATTACHMENTS} attachments` };
    }

    const uploaded = await uploadAttachments(files);
    prescription.attachments.push(...uploaded);
    await prescription.save();

    return { prescription, error: null };
};

const removeAttachment = async (prescriptionId, attachmentId, doctorId) => {
    const prescription = await getOwnedPrescription(prescriptionId, doctorId, 'doctor');
    if (!prescription) return { prescription: null, error: 'Prescription not found' };

    const attachment = prescription.attachments.id(attachmentId);
    if (!attachment) return { prescription: null, error: 'Attachment not found' };

    if (attachment.publicId) {
        await cloudinary.uploader
            .destroy(attachment.publicId, {
                resource_type: attachment.fileType === 'application/pdf' ? 'raw' : 'image',
            })
            .catch(() => {});
    }

    attachment.deleteOne();
    await prescription.save();

    return { prescription, error: null };
};

// ─── Medications (dose tracking) ─────────────────────────────────────────

const resolveFamilyScope = async (patientId, familyMember) => {
    if (!familyMember) return { familyMemberId: null };
    const member = await getOwnedFamilyMember(patientId, familyMember);
    if (!member) return { ineligible: true };
    return { familyMemberId: member._id.toString() };
};

const listMedications = async (patientId, filters = {}) => {
    const scope = await resolveFamilyScope(patientId, filters.familyMember);
    if (scope.ineligible) return { ineligibleFamilyMember: true };

    await markOverdueMissed(patientId);

    const query = { patientId, familyMemberId: scope.familyMemberId };
    if (filters.status) query.status = filters.status;
    if (filters.prescriptionId) query.prescriptionId = filters.prescriptionId;
    if (filters.dateFrom || filters.dateTo) {
        query.scheduledTime = {};
        if (filters.dateFrom) query.scheduledTime.$gte = new Date(filters.dateFrom);
        if (filters.dateTo) query.scheduledTime.$lte = new Date(filters.dateTo);
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));

    const [medications, total] = await Promise.all([
        medicationModel
            .find(query)
            .sort({ scheduledTime: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
        medicationModel.countDocuments(query),
    ]);

    return { medications, total, page, limit };
};

const getTodayMedications = async (patientId, familyMember) => {
    const scope = await resolveFamilyScope(patientId, familyMember);
    if (scope.ineligible) return { ineligibleFamilyMember: true };

    await markOverdueMissed(patientId);

    const dayStart = startOfDay(new Date());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);

    const medications = await medicationModel
        .find({
            patientId,
            familyMemberId: scope.familyMemberId,
            scheduledTime: { $gte: dayStart, $lt: dayEnd },
        })
        .sort({ scheduledTime: 1 });

    const now = Date.now();
    const nextDose =
        medications.find((m) => m.status === 'PENDING' && m.scheduledTime.getTime() >= now) || null;

    return { medications, nextDose };
};

// Patient-only. The entry must belong to the authenticated patient's own
// account (family members' doses are owned by the primary account).
const updateMedicationStatus = async (medicationId, patientId, body) => {
    const validation = validateMedicationStatusUpdate(body);
    if (!validation.valid) return { medication: null, error: validation.message };

    const medication = await medicationModel.findOne({ _id: medicationId, patientId }).catch(() => null);
    if (!medication) return { medication: null, error: 'Medication not found' };

    if (body.status === 'TAKEN') {
        const minutesUntilDose = (medication.scheduledTime.getTime() - Date.now()) / 60000;
        if (minutesUntilDose > EARLY_MARK_WINDOW_MINUTES) {
            return { medication: null, error: 'This dose is too far in the future to mark as taken' };
        }
    }

    medication.status = body.status;
    medication.takenAt = body.status === 'TAKEN' ? new Date() : null;
    await medication.save();

    return { medication, error: null };
};


// ─── Printable / exportable document ────────────────────────────────────
// Composes what a prescription document needs (clinic + patient details)
// from the EXISTING models, for a prescription the caller has ALREADY been
// authorized to read (verifyPrescriptionAccess). Deliberately minimal:
//   - no doctorNotes, attachments, ids, phone, email, address or date of birth
//   - the patient's age is computed here so the raw date of birth never leaves
const calculateAge = (value) => {
    if (!value) return null;
    const dob = new Date(value);
    if (isNaN(dob.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDiff = now.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
    return age >= 0 && age < 130 ? age : null;
};

const cleanGender = (gender) => (['Male', 'Female', 'Other'].includes(gender) ? gender : '');

const getPrescriptionDocument = async (prescription) => {
    const [doctor, appointment] = await Promise.all([
        doctorModel.findById(prescription.doctorId).select('name speciality degree experience address').lean().catch(() => null),
        // Booking-time snapshot: still available if a family member was
        // later removed or the profile changed.
        appointmentModel
            .findById(prescription.appointmentId)
            .select('userData.name userData.gender userData.dob familyMemberData')
            .lean()
            .catch(() => null),
    ]);

    let patient;
    if (prescription.familyMemberId) {
        // Scoped by the prescription's own patientId, never by anything from the request.
        const member = await getOwnedFamilyMember(prescription.patientId, prescription.familyMemberId);
        patient = {
            name: member?.name || appointment?.familyMemberData?.name || 'Family member',
            gender: cleanGender(member?.gender),
            age: calculateAge(member?.dateOfBirth),
            relationship: member?.relationship || appointment?.familyMemberData?.relationship || 'OTHER',
            isFamilyMember: true,
        };
    } else {
        let user = appointment?.userData;
        if (!user?.name) {
            user = await userModel.findById(prescription.patientId).select('name gender dob').lean().catch(() => null);
        }
        patient = {
            name: user?.name || 'Patient',
            gender: cleanGender(user?.gender),
            age: calculateAge(user?.dob),
            relationship: 'SELF',
            isFamilyMember: false,
        };
    }

    return {
        prescriptionId: prescription._id.toString(),
        prescriptionDate: prescription.prescriptionDate,
        validUntil: prescription.validUntil,
        status: prescription.status,
        diagnosis: prescription.diagnosis || '',
        instructions: prescription.instructions || '',
        medicines: (prescription.medicines || []).map((m) => ({
            name: m.name,
            dosage: m.dosage,
            form: m.form,
            frequency: m.frequency,
            timing: m.timing,
            duration: m.duration || '',
            quantity: m.quantity || 0,
            instructions: m.instructions || '',
        })),
        doctor: {
            name: doctor?.name || 'Doctor',
            speciality: doctor?.speciality || '',
            degree: doctor?.degree || '',
            experience: doctor?.experience || '',
            address: {
                line1: doctor?.address?.line1 || '',
                line2: doctor?.address?.line2 || '',
            },
        },
        patient,
    };
};

export {
    getPrescriptionDocument,
    createPrescription,
    listPrescriptions,
    getOwnedPrescription,
    updatePrescription,
    addAttachments,
    removeAttachment,
    listMedications,
    getTodayMedications,
    updateMedicationStatus,
    buildScheduleEntries,
    parseDurationDays,
};
