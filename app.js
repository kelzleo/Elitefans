/**
 * app.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const expressLayouts = require('express-ejs-layouts');
const passport = require('passport');
const session = require('express-session');
const flash = require('connect-flash');
const http = require('http');
const socketIo = require('socket.io');
const User = require('./models/users');
const multer = require('multer');


// Import configuration and keys
const keys = require('./config/keys');
require('./config/passport-setup');

// Import middleware
const updateUserStatus = require('./middleware/updateUserStatus');

// Import routes
const indexRoutes = require('./routes/index');
const profileRoutes = require('./routes/profile');
const usersRoutes = require('./routes/users');
const requestCreatorRoutes = require('./routes/requestCreator');
const adminRoutes = require('./routes/admin');
const uploadRoute = require('./routes/uploadRoute');
const homeRoutes = require('./routes/home');
const createRoutes = require('./routes/creator');
const chatBroadcastRoutes = require('./routes/chatBroadcast');
const chatRoutes = require('./routes/chat');
const chatListRoutes = require('./routes/chatList');
const notificationsRoute = require('./routes/notifications');
const postsRoute = require('./routes/posts');
const dashboardRoutes = require('./routes/dashboard');
const bookmarksRoutes = require('./routes/bookmarks');
const referralsRoutes = require('./routes/referrals');
const purchasedContentRoutes = require('./routes/purchasedContent');

// Initialize Express app
const app = express();

// Trust the first proxy for secure cookies
app.set('trust proxy', 1);

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000,
  })
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Multer setup for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Middleware setup
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.json({ limit: '5mb' }));

// Session middleware
const MongoStore = require('connect-mongo');
const sessionMiddleware = session({
  secret: keys.session.cookieKey,
  resave: false,
  saveUninitialized: true,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60, // 24 hours
  }).on('error', (err) => console.error('MongoStore error:', err)),
  cookie: {
    secure: process.env.NODE_ENV === 'production' ? true : false, // Allow HTTP in development
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    httpOnly: true,
  },
});

// Debug session middleware
app.use((req, res, next) => {
  console.log('Session before middleware - SessionID:', req.sessionID, 'Session:', req.session, 'Cookies:', req.headers.cookie);
  sessionMiddleware(req, res, (err) => {
    if (err) {
      console.error('Session middleware error:', err);
      return next(err);
    }
    console.log('Session after middleware - SessionID:', req.sessionID, 'Session:', req.session);
    next();
  });
});

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Apply updateUserStatus middleware
app.use(updateUserStatus);
app.use((req, res, next) => {
  res.locals.isWelcomePage = req.path === '/';
  next();
});

// Flash middleware
app.use(flash());
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.currentUser = req.user;
  next();
});

app.locals.formatRelativeTime = (date) => {
  const now = new Date();
  const lastSeen = new Date(date);
  const diffMs = now - lastSeen;

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return `${diffSeconds} second${diffSeconds === 1 ? '' : 's'} ago`;
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else {
    const diffWeeks = Math.floor(diffDays / 7);
    return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`;
  }
};

// Media upload route for chat
const { chatBucket: bucket } = require('./utilis/cloudStorage');
app.post('/chat/upload-media', upload.single('media'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  try {
    const file = req.file;
    const allowedTypes = ['image/jpeg', 'image/png', 'video/mp4'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ success: false, message: 'Invalid file type. Only JPEG, PNG, and MP4 are allowed.' });
    }
    const fileName = `${Date.now()}-${file.originalname}`;
    const blob = bucket.file(fileName);
    const blobStream = blob.createWriteStream({
      metadata: { contentType: file.mimetype },
    });

    blobStream.on('error', (err) => {
      console.error('Blob stream error:', err);
      let message = 'Error uploading file.';
      if (err.message.includes('billing')) {
        message = 'Billing account issue. Please contact support.';
      } else if (err.message.includes('permission')) {
        message = 'Permission denied for storage operation.';
      }
      res.status(500).json({ success: false, message, error: err.message });
    });

    blobStream.on('finish', async () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      res.json({ success: true, url: publicUrl });
    });

    blobStream.end(file.buffer);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Routes
app.use('/', indexRoutes);
app.use('/users', usersRoutes);
app.use('/profile', profileRoutes);
app.use('/request-Creator', requestCreatorRoutes);
app.use('/admin', adminRoutes);
app.use('/api', uploadRoute);
app.use('/home', homeRoutes);
app.use('/create', createRoutes);
app.use('/chat/broadcast', chatBroadcastRoutes);
app.use('/chat', chatRoutes);
app.use('/chats', chatListRoutes);
app.use('/notifications', notificationsRoute);
app.use('/posts', postsRoute);
app.use('/dashboard', dashboardRoutes);
app.use('/bookmarks', bookmarksRoutes);
app.use('/referrals', referralsRoutes);
app.use('/purchased-content', purchasedContentRoutes);

// Google Cloud Storage example endpoint (optional, for debugging)
app.get('/storage-example', async (req, res) => {
  try {
    const { storage } = require('./utilis/cloudStorage');
    console.log('Route accessed: /storage-example');
    const projectId = await storage.getProjectId();
    console.log(`Google Cloud project ID: ${projectId}`);
    const [buckets] = await storage.getBuckets();
    console.log('Buckets retrieved:', buckets.length > 0 ? buckets : 'No buckets found');
    res.json({ buckets });
  } catch (err) {
    console.error('Error in /storage-example route:', err);
    res.status(500).json({
      message: 'Error accessing Google Cloud Storage',
      error: err.message,
      stack: err.stack,
    });
  }
});

// Chat (Socket.io) Setup
const server = http.createServer(app);
const io = socketIo(server);

// Share session with Socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Authenticate Socket.io with Passport
io.use((socket, next) => {
  if (socket.request.session.passport && socket.request.session.passport.user) {
    socket.userId = socket.request.session.passport.user;
    next();
  } else {
    next(new Error('Authentication error'));
  }
});

// Store connected users and their last heartbeat
const connectedUsers = new Map();

// Heartbeat interval and timeout (in milliseconds)
const HEARTBEAT_INTERVAL = 15000; // 15 seconds
const HEARTBEAT_TIMEOUT = 30000; // 30 seconds

// Reset all users' online status on server startup
mongoose.connection.once('open', async () => {
  try {
    await User.updateMany({}, { $set: { isOnline: false } });
    console.log('Reset all users to offline on server startup');
  } catch (err) {
    console.error('Error resetting online status on startup:', err);
  }
});

io.on('connection', async (socket) => {
  console.log('New client connected:', socket.id, 'User:', socket.userId);

  // Set user to online and store in connectedUsers
  if (socket.userId) {
    await User.findByIdAndUpdate(socket.userId, {
      isOnline: true,
      lastSeen: new Date(),
    });

    connectedUsers.set(socket.userId, {
      socketId: socket.id,
      lastHeartbeat: new Date(),
    });
  }

  // Handle heartbeat from client
  socket.on('heartbeat', () => {
    if (socket.userId) {
      connectedUsers.set(socket.userId, {
        socketId: socket.id,
        lastHeartbeat: new Date(),
      });
    }
  });

  socket.on('joinRoom', ({ chatId }) => {
    socket.join(chatId);
    console.log(`Socket ${socket.id} joined room ${chatId}`);
  });

  socket.on('sendMessage', async ({ chatId, sender, text, media, isTip = false, tipAmount = null }) => {
    const message = { 
      sender, 
      text, 
      media,
      timestamp: new Date(),
      isTip,
      tipAmount,
      read: false,
    };
    console.log('Emitting new message to room:', chatId, 'Message:', message);
    io.to(chatId).emit('newMessage', message);
    try {
      const Chat = require('./models/chat');
      const chat = await Chat.findById(chatId);
      if (chat) {
        chat.messages.push(message);
        chat.updatedAt = new Date();
        await chat.save();
        console.log('Message saved to chat:', chatId);
      } else {
        console.error('Chat not found:', chatId);
      }
    } catch (err) {
      console.error('Error saving chat message:', err);
    }
  });

  socket.on('disconnect', async () => {
    console.log('Client disconnected:', socket.id, 'User:', socket.userId);
    if (socket.userId) {
      connectedUsers.delete(socket.userId);
      await User.findByIdAndUpdate(socket.userId, {
        isOnline: false,
        lastSeen: new Date(),
      });
    }
  });
});

// Periodically check for inactive users
setInterval(async () => {
  const now = new Date();
  for (const [userId, info] of connectedUsers.entries()) {
    const timeSinceLastHeartbeat = now - info.lastHeartbeat;
    if (timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT) {
      console.log(`User ${userId} missed heartbeat, marking as offline`);
      connectedUsers.delete(userId);
      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen: new Date(),
      });
    }
  }
}, HEARTBEAT_INTERVAL);

// Make io accessible in routes
app.set('socketio', io);

// Start the server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});