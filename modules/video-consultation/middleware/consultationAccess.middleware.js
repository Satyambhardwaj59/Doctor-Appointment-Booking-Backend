import jwt from 'jsonwebtoken';
import videoConsultationModel from '../models/videoConsultationModel.js';

/**
 * Dual-role consultation access middleware.
 *
 * Reads `token` (patient) OR `dtoken` (doctor) from request headers.
 * Decodes the JWT, identifies the role, then verifies that the authenticated
 * user is actually a participant (doctor or patient) in the requested consultation.
 *
 * Sets req.user = { id: string, role: 'patient' | 'doctor' }
 * Sets req.consultation = <consultation document> for downstream use.
 *
 * Never trusts any user-supplied role claim in the request body/params.
 */
const consultationAccessMiddleware = async (req, res, next) => {
  try {
    const { token, dtoken } = req.headers;

    if (!token && !dtoken) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Determine which token was provided — establishes role without trusting the client
    let userId;
    let role;

    if (dtoken) {
      const decoded = jwt.verify(dtoken, process.env.JWT_SECRET);
      if (!decoded?.id) {
        return res.status(401).json({ success: false, message: 'Invalid doctor token' });
      }
      userId = decoded.id;
      role = 'doctor';
    } else {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded?.id) {
        return res.status(401).json({ success: false, message: 'Invalid user token' });
      }
      userId = decoded.id;
      role = 'patient';
    }

    // Verify ownership — the consultation must exist and belong to this user
    const consultationId = req.params.id;

    if (consultationId) {
      const consultation = await videoConsultationModel.findById(consultationId);

      if (!consultation) {
        return res.status(404).json({ success: false, message: 'Consultation not found' });
      }

      const isOwner =
        (role === 'patient' && consultation.patientId === userId) ||
        (role === 'doctor' && consultation.doctorId === userId);

      if (!isOwner) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      // Attach for downstream controllers
      req.consultation = consultation;
    }

    req.user = { id: userId, role };
    next();
  } catch (err) {
    // Never expose raw JWT errors to the client
    return res.status(401).json({ success: false, message: 'Authentication failed' });
  }
};

export default consultationAccessMiddleware;
