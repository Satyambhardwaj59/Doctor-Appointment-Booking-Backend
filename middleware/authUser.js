import jwt from 'jsonwebtoken';

// User Authentication middleware
const authUser = async (req, res, next) => {
  try {
    const { token } = req.headers;

    if (!token) {
      return res.status(401).json({ success: false, message: "Token missing" });
    }

    const token_decode = jwt.verify(token, process.env.JWT_SECRET);

    if (!token_decode.id) {
      return res.status(400).json({ success: false, message: "Token payload invalid" });
    }

    req.user = { userId: token_decode.id };

    next();

  } catch (err) {
    console.error("JWT error:", err.message);
    return res.status(401).json({ success: false, message: err.message });
  }
};

export default authUser;
