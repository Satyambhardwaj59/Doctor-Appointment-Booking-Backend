import { v2 as cloudinary } from 'cloudinary';
import familyMemberModel from '../models/familyAccount.model.js';

// Every query in this service is scoped by primaryUserId. This is
// intentional defense-in-depth: even if a route/middleware check were ever
// bypassed or modified incorrectly, the database query itself still can't
// return or mutate another user's family member.

const createFamilyMember = async (primaryUserId, payload, imageFile) => {
    const { name, relationship, dateOfBirth, gender, phone, email } = payload;

    let profileImage = '';
    if (imageFile) {
        const uploadResult = await cloudinary.uploader.upload(imageFile.path, {
            resource_type: 'image'
        });
        profileImage = uploadResult.secure_url;
    }

    const familyMember = new familyMemberModel({
        primaryUserId,
        name: name.trim(),
        relationship,
        dateOfBirth: dateOfBirth || '',
        gender: gender || 'Not Selected',
        phone: phone || '',
        email: email || '',
        profileImage
    });

    return familyMember.save();
};

const getFamilyMembers = async (primaryUserId) => {
    return familyMemberModel
        .find({ primaryUserId, isDeleted: false })
        .sort({ createdAt: 1 });
};

// Looks up a family member and verifies ownership in one step. Returns
// null if not found OR not owned — callers should treat both cases as
// "not found" in their response so as not to leak existence to other users.
const getOwnedFamilyMember = async (primaryUserId, familyMemberId) => {
    const familyMember = await familyMemberModel.findOne({
        _id: familyMemberId,
        primaryUserId,
        isDeleted: false
    });
    return familyMember;
};

const updateFamilyMember = async (primaryUserId, familyMemberId, payload, imageFile) => {
    const familyMember = await getOwnedFamilyMember(primaryUserId, familyMemberId);
    if (!familyMember) return null;

    const { name, relationship, dateOfBirth, gender, phone, email } = payload;

    if (name !== undefined) familyMember.name = name.trim();
    if (relationship !== undefined) familyMember.relationship = relationship;
    if (dateOfBirth !== undefined) familyMember.dateOfBirth = dateOfBirth;
    if (gender !== undefined) familyMember.gender = gender;
    if (phone !== undefined) familyMember.phone = phone;
    if (email !== undefined) familyMember.email = email;

    if (imageFile) {
        const uploadResult = await cloudinary.uploader.upload(imageFile.path, {
            resource_type: 'image'
        });
        familyMember.profileImage = uploadResult.secure_url;
    }

    return familyMember.save();
};

// Soft delete: family members are never hard-removed since past
// appointments store a snapshot referencing them (see the minimal
// appointment integration). This keeps that history intact while removing
// the member from the user's active family list.
const removeFamilyMember = async (primaryUserId, familyMemberId) => {
    const familyMember = await getOwnedFamilyMember(primaryUserId, familyMemberId);
    if (!familyMember) return null;

    familyMember.isDeleted = true;
    return familyMember.save();
};

// Used by the appointment booking flow (userController.bookAppointment) to
// confirm a selected family member belongs to the booking user, and to get
// a lightweight snapshot to store on the appointment. Returns null when the
// family member doesn't exist or isn't owned by this user.
const getFamilyMemberSnapshotForAppointment = async (primaryUserId, familyMemberId) => {
    const familyMember = await getOwnedFamilyMember(primaryUserId, familyMemberId);
    if (!familyMember) return null;

    return {
        familyMemberId: familyMember._id.toString(),
        name: familyMember.name,
        relationship: familyMember.relationship
    };
};

export {
    createFamilyMember,
    getFamilyMembers,
    getOwnedFamilyMember,
    updateFamilyMember,
    removeFamilyMember,
    getFamilyMemberSnapshotForAppointment
};
