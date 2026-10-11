import express from 'express';
import { getPatientDashboard } from '../controllers/dashboard.controller.js';
import authUser from '../../../middleware/authUser.js';

const dashboardRouter = express.Router();

// Reuses the app's existing patient authentication (authUser reads the
// patient `token` header). A doctor's `dtoken` is not recognised by it, so
// doctors and admins cannot reach this endpoint.
dashboardRouter.get('/dashboard', authUser, getPatientDashboard);
dashboardRouter.get('/', authUser, getPatientDashboard);

export default dashboardRouter;
