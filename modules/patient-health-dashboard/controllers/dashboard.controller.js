import { getDashboard } from '../services/dashboard.service.js';
import { validateDashboardQuery } from '../validators/dashboard.validator.js';

// GET /api/patient/dashboard?familyMemberId=
// req.user.userId is set by the existing authUser middleware from the JWT —
// the patient is never identified by anything in the request itself.
const getPatientDashboard = async (req, res) => {
    try {
        const validation = validateDashboardQuery(req.query);
        if (!validation.valid) {
            return res.json({ success: false, message: validation.message });
        }

        const result = await getDashboard(req.user.userId, validation.familyMemberId);
        if (result.error) {
            return res.json({ success: false, message: result.error });
        }

        res.json({ success: true, ...result });
    } catch (error) {
        console.log('Dashboard request failed');
        res.json({ success: false, message: 'Could not load the dashboard' });
    }
};

export { getPatientDashboard };
