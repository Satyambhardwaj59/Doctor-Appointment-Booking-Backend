import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import 'dotenv/config';
import connectDB from './config/mongodb.js';
import connectCloudinary from './config/cloudinary.js';
import adminRouter from './routes/adminRoute.js';
import doctorRouter from './routes/doctorRoute.js';
import userRouter from './routes/userRoute.js';
import { videoConsultationRouter, initVideoConsultationSocket } from './modules/video-consultation/index.js';
import { familyAccountRouter } from './modules/family-accounts/index.js';

// app config
const app = express();
const port = process.env.PORT || 4000;

connectCloudinary();

// middlewares
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'token', 'dtoken', 'atoken'],
  credentials: true,
}));

// api endpoints
app.use('/api/admin', adminRouter);
app.use('/api/doctor', doctorRouter);
app.use('/api/user', userRouter);
app.use('/api/video-consultations', videoConsultationRouter);
app.use('/api/family-members', familyAccountRouter);

app.get('/', (req, res) => {
  res.send('API working , form hello world')
});

// Wrap with http.Server for Socket.IO
const httpServer = http.createServer(app);

// Socket.IO — allows cross-origin from frontend
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Initialize video consultation socket handlers
initVideoConsultationSocket(io);

connectDB().then(() => {
  httpServer.listen(port, () => {
    console.log('Server is running on port: ', port);
  });
}).catch(err => {
  console.error('Database connection failed:', err);
})