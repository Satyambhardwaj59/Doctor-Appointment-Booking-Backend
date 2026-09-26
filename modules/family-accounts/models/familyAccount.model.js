import mongoose from 'mongoose';

// Allowed relationship values for a family member relative to the primary account holder
const RELATIONSHIP_VALUES = [
    'SELF',
    'SPOUSE',
    'CHILD',
    'PARENT',
    'SIBLING',
    'GRANDPARENT',
    'OTHER'
];

const familyMemberSchema = new mongoose.Schema({
    // Owning (authenticated) user. Stored as a String to match the existing
    // convention used across the app (see appointmentModel.userId / docId),
    // where the JWT-derived id is kept as a plain string rather than an
    // ObjectId ref.
    primaryUserId: {
        type: String,
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    relationship: {
        type: String,
        required: true,
        enum: RELATIONSHIP_VALUES
    },
    dateOfBirth: {
        type: String,
        default: ''
    },
    gender: {
        type: String,
        default: 'Not Selected'
    },
    phone: {
        type: String,
        default: ''
    },
    email: {
        type: String,
        default: ''
    },
    profileImage: {
        type: String,
        default: ''
    },
    // Soft-delete flag. Family members are never hard-deleted because
    // existing appointments may reference them (see appointmentModel's
    // familyMemberData snapshot) — removing the document would orphan that
    // history. "Removing" a family member just hides it from listings.
    isDeleted: {
        type: Boolean,
        default: false
    }
}, { timestamps: true, minimize: false });

const familyMemberModel =
    mongoose.model.familyMember || mongoose.model('familyMember', familyMemberSchema);

export default familyMemberModel;
export { RELATIONSHIP_VALUES };
