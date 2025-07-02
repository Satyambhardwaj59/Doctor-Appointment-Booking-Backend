import jwt from 'jsonwebtoken';

// Doctor Authentication middleware
const authDoctor = async (req, res, next) => {
  try {
    const { dtoken } = req.headers;

    if (!dtoken) {
      return res.status(401).json({ success: false, message: "Token missing" });
    }

    const token_decode = jwt.verify(dtoken, process.env.JWT_SECRET);

    if (!token_decode.id) {
      return res.status(400).json({ success: false, message: "Token payload invalid" });
    }

    req.user = { docId: token_decode.id };

    next();

  } catch (err) {
    console.error("JWT error:", err.message);
    return res.status(401).json({ success: false, message: err.message });
  }
};

export default authDoctor;
