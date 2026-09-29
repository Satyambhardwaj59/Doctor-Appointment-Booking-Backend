import { v2 as cloudinary } from 'cloudinary';
import medicalRecordModel from '../models/medicalRecord.model.js';
import { hasEligibleAppointment } from '../../doctor-patient-chat/index.js';
import { getOwnedFamilyMember } from '../../family-accounts/index.js';
import {
    validateCreateRecord,
    validateUpdateRecord,
    validateAttachmentFiles,
} from '../validators/medicalRecord.validator.js';

const uploadAttachments = async (files = []) => {
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

// A record's `patientId` and `doctorId` are always derived server-side from
// (a) the authenticated user's own id and (b) a verified relationship —
// never trusted as opaque ids handed over in the request body.
const createRecord = async ({ creatorId, creatorRole, body, files }) => {
    const validation = validateCreateRecord(body, creatorRole);
    if (!validation.valid) return { record: null, error: validation.message };

    const fileValidation = validateAttachmentFiles(files);
    if (!fileValidation.valid) return { record: null, error: fileValidation.message };

    const patientId = creatorRole === 'doctor' ? body.patientId : creatorId;
    const doctorId = creatorRole === 'doctor' ? creatorId : body.doctorId;

    if (!patientId || !doctorId) {
        return { record: null, error: 'Both a patient and a doctor are required for this record' };
    }

    const eligibleAppointment = await hasEligibleAppointment(patientId, doctorId);
    if (!eligibleAppointment) {
        return {
            record: null,
            error: 'A medical record requires an existing appointment between this doctor and patient',
        };
    }

    let familyMemberId = null;
    if (body.familyMemberId) {
        const familyMember = await getOwnedFamilyMember(patientId, body.familyMemberId);
        if (!familyMember) {
            return { record: null, error: 'Family member not found' };
        }
        familyMemberId = familyMember._id.toString();
    }

    const attachments = await uploadAttachments(files);

    const record = await medicalRecordModel.create({
        patientId,
        doctorId,
        appointmentId: body.appointmentId || eligibleAppointment._id.toString(),
        consultationId: body.consultationId || null,
        familyMemberId,
        recordType: body.recordType,
        title: body.title.trim(),
        description: body.description || '',
        diagnosis: creatorRole === 'doctor' ? body.diagnosis || '' : '',
        doctorNotes: creatorRole === 'doctor' ? body.doctorNotes || '' : '',
        recordDate: new Date(body.recordDate),
        attachments,
        createdByRole: creatorRole,
        createdById: creatorId,
    });

    return { record, error: null };
};

// Every list/read query is scoped by the viewer's own id on the
// appropriate field — defense in depth against ever returning another
// person's records, on top of the ownership middleware.
const listRecords = async (viewerId, viewerRole, filters = {}) => {
    const query = { isDeleted: filters.archived === true || filters.archived === 'true' };

    if (viewerRole === 'doctor') {
        query.doctorId = viewerId;
        if (filters.patientId) query.patientId = filters.patientId;
    } else {
        query.patientId = viewerId;
        if (filters.familyMember) {
            const familyMember = await getOwnedFamilyMember(viewerId, filters.familyMember);
            if (!familyMember) return { records: [], total: 0, ineligibleFamilyMember: true };
            query.familyMemberId = familyMember._id.toString();
        } else {
            // Default scope is the account holder's own records — a
            // family member's records are only included when explicitly
            // requested via ?familyMember=, matching the Family Accounts
            // "switch profile" UX rather than merging everyone together.
            query.familyMemberId = null;
        }
        if (filters.doctor) query.doctorId = filters.doctor;
    }

    if (filters.type) query.recordType = filters.type;

    if (filters.dateFrom || filters.dateTo) {
        query.recordDate = {};
        if (filters.dateFrom) query.recordDate.$gte = new Date(filters.dateFrom);
        if (filters.dateTo) query.recordDate.$lte = new Date(filters.dateTo);
    }

    if (filters.search) {
        query.$text = { $search: filters.search };
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));

    const [records, total] = await Promise.all([
        medicalRecordModel
            .find(query)
            .sort({ recordDate: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
        medicalRecordModel.countDocuments(query),
    ]);

    return { records, total, page, limit };
};

// Returns null for both "not found" and "not yours" — callers should treat
// both as a generic 404 so as not to leak record existence.
const getOwnedRecord = async (recordId, viewerId, viewerRole) => {
    const record = await medicalRecordModel.findOne({ _id: recordId, isDeleted: false }).catch(() => null);
    if (!record) return null;

    const owns =
        (viewerRole === 'doctor' && record.doctorId === viewerId) ||
        (viewerRole === 'patient' && record.patientId === viewerId);

    return owns ? record : null;
};

// A doctor associated with the record always has full edit rights
// (including clinical fields). A patient may only edit a record they
// themselves created (their own uploaded documents/reports) — they can
// never edit a doctor-authored record, and the validator additionally
// blocks them from ever touching diagnosis/doctorNotes regardless.
const canEditRecord = (record, viewerId, viewerRole) => {
    if (viewerRole === 'doctor') return record.doctorId === viewerId;
    return record.patientId === viewerId && record.createdByRole === 'patient' && record.createdById === viewerId;
};

const updateRecord = async (recordId, viewerId, viewerRole, body) => {
    const record = await getOwnedRecord(recordId, viewerId, viewerRole);
    if (!record) return { record: null, error: 'Record not found' };

    if (!canEditRecord(record, viewerId, viewerRole)) {
        return { record: null, error: 'You are not authorized to edit this record' };
    }

    const validation = validateUpdateRecord(body, viewerRole);
    if (!validation.valid) return { record: null, error: validation.message };

    if (body.title !== undefined) record.title = body.title.trim();
    if (body.description !== undefined) record.description = body.description;
    if (body.recordDate !== undefined) record.recordDate = new Date(body.recordDate);
    if (body.recordType !== undefined) record.recordType = body.recordType;
    if (viewerRole === 'doctor') {
        if (body.diagnosis !== undefined) record.diagnosis = body.diagnosis;
        if (body.doctorNotes !== undefined) record.doctorNotes = body.doctorNotes;
    }

    await record.save();
    return { record, error: null };
};

const deleteRecord = async (recordId, viewerId, viewerRole) => {
    const record = await getOwnedRecord(recordId, viewerId, viewerRole);
    if (!record) return null;
    if (!canEditRecord(record, viewerId, viewerRole)) return null;

    record.isDeleted = true;
    await record.save();
    return record;
};

const restoreRecord = async (recordId, viewerId, viewerRole) => {
    const record = await medicalRecordModel
        .findOne({ _id: recordId, isDeleted: true })
        .catch(() => null);
    if (!record) return null;

    const owns =
        (viewerRole === 'doctor' && record.doctorId === viewerId) ||
        (viewerRole === 'patient' && record.patientId === viewerId);
    if (!owns || !canEditRecord(record, viewerId, viewerRole)) return null;

    record.isDeleted = false;
    await record.save();
    return record;
};

const addAttachments = async (recordId, viewerId, viewerRole, files) => {
    const record = await getOwnedRecord(recordId, viewerId, viewerRole);
    if (!record) return { record: null, error: 'Record not found' };
    if (!canEditRecord(record, viewerId, viewerRole)) {
        return { record: null, error: 'You are not authorized to edit this record' };
    }

    const fileValidation = validateAttachmentFiles(files);
    if (!fileValidation.valid) return { record: null, error: fileValidation.message };

    if (record.attachments.length + (files?.length || 0) > 10) {
        return { record: null, error: 'A record can have at most 10 attachments' };
    }

    const uploaded = await uploadAttachments(files);
    record.attachments.push(...uploaded);
    await record.save();

    return { record, error: null };
};

const removeAttachment = async (recordId, attachmentId, viewerId, viewerRole) => {
    const record = await getOwnedRecord(recordId, viewerId, viewerRole);
    if (!record) return { record: null, error: 'Record not found' };
    if (!canEditRecord(record, viewerId, viewerRole)) {
        return { record: null, error: 'You are not authorized to edit this record' };
    }

    const attachment = record.attachments.id(attachmentId);
    if (!attachment) return { record: null, error: 'Attachment not found' };

    if (attachment.publicId) {
        await cloudinary.uploader
            .destroy(attachment.publicId, { resource_type: attachment.fileType === 'application/pdf' ? 'raw' : 'image' })
            .catch(() => {});
    }

    attachment.deleteOne();
    await record.save();

    return { record, error: null };
};

export {
    createRecord,
    listRecords,
    getOwnedRecord,
    updateRecord,
    deleteRecord,
    restoreRecord,
    addAttachments,
    removeAttachment,
};
