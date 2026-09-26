import express from 'express';
import {
    addFamilyMember,
    listFamilyMembers,
    getFamilyMember,
    editFamilyMember,
    deleteFamilyMember
} from '../controllers/familyAccount.controller.js';
import authUser from '../../../middleware/authUser.js';
import upload from '../../../middleware/multer.js';
import verifyFamilyMemberOwnership from '../middleware/familyAccountAccess.middleware.js';

const familyAccountRouter = express.Router();

familyAccountRouter.post('/', authUser, upload.single('profileImage'), addFamilyMember);
familyAccountRouter.get('/', authUser, listFamilyMembers);
familyAccountRouter.get('/:id', authUser, verifyFamilyMemberOwnership, getFamilyMember);
familyAccountRouter.patch('/:id', authUser, upload.single('profileImage'), verifyFamilyMemberOwnership, editFamilyMember);
familyAccountRouter.delete('/:id', authUser, verifyFamilyMemberOwnership, deleteFamilyMember);

export default familyAccountRouter;
