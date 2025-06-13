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
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const http = require('http');
const socketIo = require('socket.io');
const User = require('./models/users');
const multer = require('multer');
const logger = require('./logs/logger');
const csurf = require('csurf');
const helmet = require('helmet');
const { body, param,  validationResult } = require('express-validator'); // Added express-validator

const SignedUrlSession = require('./models/signedUrlSession');
const axios = require('axios'); // Add this import

const { regenerateSignedUrl, extendSessionActivity, regenerateExpiring } = require('./utilis/cloudStorage')

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
const dashboardRoutes = require('./routes/dashboard');
const bookmarksRoutes = require('./routes/bookmarks');
const referralsRoutes = require('./routes/referrals');
const purchasedContentRoutes = require('./routes/purchasedContent');

// Check for COOKIE_KEY
if (!process.env.COOKIE_KEY) {
  console.error('COOKIE_KEY is not set in environment variables');
  process.exit(1);
}

// Initialize Express app
const app = express();

// Trust the first proxy for secure cookies on Render
app.set('trust proxy', 1);

// Enforce HTTPS in production
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && !req.secure) {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 30000
  })
  .then(() => logger.info('Connected to MongoDB'))
  .catch((err) => logger.error(`MongoDB connection error: ${err.message}`));

// Log connection events
mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB connection error: ${err.message}`);
});
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected, attempting to reconnect...');
});
mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});

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

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com"
        ],
        styleSrc: [
          "'self'",
          "https://fonts.googleapis.com",
          "https://cdnjs.cloudflare.com"
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdnjs.cloudflare.com"
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          "https://storage.googleapis.com"
        ],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      }
    },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginEmbedderPolicy: false
  })
);

// Session middleware with secure cookie in production
const sessionMiddleware = session({
  secret: process.env.COOKIE_KEY,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60,
    autoRemove: 'native'
  }).on('error', (err) => logger.error(`MongoStore error: ${err.message}`)),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    httpOnly: true,
    path: '/'
  }
});
app.use(sessionMiddleware);

// Enhanced session debugging
app.use((req, res, next) => {
  if (!req.sessionID) {
    logger.warn('No sessionID generated');
  }
  req.session.save(err => {
    if (err) {
      logger.error(`Error saving session: ${err.message}`);
    }
    next();
  });
});

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// CSRF middleware
app.use(csurf());

// Make CSRF token available in views
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

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

// Route to store redirect URL in session
app.post('/store-redirect', [
  body('redirectTo')
    .notEmpty().withMessage('Redirect URL is required')
    .isString().withMessage('Redirect URL must be a string')
    .matches(/^\/profile\//).withMessage('Redirect URL must start with /profile/')
    .trim()
    .escape()
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in POST /store-redirect: ' + JSON.stringify(errors.array()));
    return res.status(400).json({ status: 'error', message: errors.array().map(err => err.msg).join(', ') });
  }

  const { redirectTo } = req.body;
  req.session.redirectTo = redirectTo;
  req.session.save(err => {
    if (err) {
      logger.error(`Error saving session in /store-redirect: ${err.message}`);
      return res.status(500).json({ status: 'error', message: 'Failed to save session' });
    }
    res.status(200).json({ status: 'success' });
  });
});

const startBackgroundJobs = () => {
  // Run immediately on startup
  regenerateExpiring();
  
  // Then run every minute
  setInterval(async () => {
    try {
      await regenerateExpiring();
    } catch (err) {
      logger.error(`Background job error: ${err.message}`);
    }
  }, 60 * 1000); // Run every minute
  
  logger.info('Background jobs started for signed URL regeneration');
};

// Call this when your server starts
startBackgroundJobs();
app.get('/media/:sessionId', [
  // Validate sessionId as a URL parameter and ensure it's a valid MongoDB ObjectId
  param('sessionId').isMongoId().withMessage('Invalid session ID')
], async (req, res) => {
  
  try {
    logger.debug(`Request to /media/${req.params.sessionId}, User: ${req.user ? req.user._id : 'none'}`);
    if (!req.user) {
      logger.warn(`No user authenticated for /media/${req.params.sessionId}`);
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { sessionId } = req.params;
    const userId = req.user._id;

    let session = await SignedUrlSession.findOne({ 
      _id: sessionId, 
      userId,
      isActive: true 
    });
    
    if (!session) {
      logger.warn(`Invalid or unauthorized media access by user ${userId} for session ${sessionId}`);
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Check if session has expired
    if (new Date() > session.sessionExpiresAt) {
      logger.warn(`Expired session access by user ${userId} for session ${sessionId}`);
      await SignedUrlSession.deleteOne({ _id: sessionId });
      return res.status(403).json({ error: 'Session expired' });
    }

    // Check if signed URL is about to expire (within 2 minutes) and regenerate
    const twoMinutesFromNow = new Date(Date.now() + 2 * 60 * 1000);
    if (session.signedUrlExpiresAt < twoMinutesFromNow) {
      logger.info(`Regenerating signed URL for session ${sessionId} on access`);
      session = await regenerateSignedUrl(sessionId);
    }

    // Extend user session activity (reset 24hr timer for all user sessions)
    try {
      await extendSessionActivity(userId);
    } catch (err) {
      logger.warn(`Failed to extend session activity for user ${userId}: ${err.message}`);
      // Don't fail the request for this
    }

    const method = req.method.toLowerCase();
    if (method !== 'head' && method !== 'get') {
      return res.status(405).send('Method not allowed');
    }

    // Fetch stream from storage using the current (possibly regenerated) signed URL
    const axiosConfig = {
      method,
      url: session.signedUrl,
      responseType: method === 'get' ? 'stream' : undefined,
      timeout: 120000,
      headers: { 'Connection': 'keep-alive' },
    };
    if (method === 'get' && req.headers.range) {
      axiosConfig.headers.Range = req.headers.range;
      res.set('Accept-Ranges', 'bytes');
    }
    const axiosResponse = await axios(axiosConfig);

    // Build response headers
    const headers = {
      'Content-Type': axiosResponse.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=300', // Cache for 5 minutes
      'Connection': 'keep-alive'
    };
    if (method === 'get') {
      if (req.headers.range && axiosResponse.headers['content-range']) {
        headers['Content-Range'] = axiosResponse.headers['content-range'];
        headers['Content-Length'] = axiosResponse.headers['content-length'];
        res.status(206);
      } else {
        headers['Content-Length'] = axiosResponse.headers['content-length'];
        res.status(200);
      }
    }
    res.set(headers);

    if (method === 'head') {
      return res.status(axiosResponse.status).end();
    }

    // --- Stream handling (unchanged) ---
    let completed = false;
    res.on('finish', () => { completed = true; });

    axiosResponse.data.pipe(res);

    axiosResponse.data.on('error', err => {
      // only log if the response didn't finish normally
      if (!completed) {
        if (err.code === 'ECONNABORTED' || err.message.includes('aborted')) {
          logger.info(`Stream aborted by client for session ${sessionId}: ${err.message}`);
        } else {
          logger.error(`Stream error for session ${sessionId}: ${err.message}`);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Stream error' });
          }
        }
      }
    });
    // --- end stream handling ---
    
  } catch (err) {
    if (err.response) {
      logger.warn(`Storage provider error for session ${req.params.sessionId}: ${err.response.status} ${err.response.statusText}`);
      return res.status(err.response.status).send(err.response.statusText);
    }
    logger.error(`Error in media proxy for session ${req.params.sessionId}: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Media upload route for chat
const { chatBucket: bucket } = require('./utilis/cloudStorage');
app.post('/chat/upload-media', upload.single('media'), [
  body('media').custom((value, { req }) => {
    if (!req.file) {
      throw new Error('No file uploaded');
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'video/mp4'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      throw new Error('Invalid file type. Only JPEG, PNG, and MP4 are allowed.');
    }
    return true;
  })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in POST /chat/upload-media: ' + JSON.stringify(errors.array()));
    return res.status(400).json({ success: false, message: errors.array().map(err => err.msg).join(', ') });
  }

  try {
    const file = req.file;
    const fileName = `${Date.now()}-${file.originalname}`;
    const blob = bucket.file(fileName);
    const blobStream = blob.createWriteStream({
      metadata: { contentType: file.mimetype },
    });

    blobStream.on('error', (err) => {
      logger.error(`Blob stream error: ${err.message}`);
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
    logger.error(`Upload error in /chat/upload-media: ${err.message}`);
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
app.use('/dashboard', dashboardRoutes);
app.use('/bookmarks', bookmarksRoutes);
app.use('/referrals', referralsRoutes);
app.use('/purchased-content', purchasedContentRoutes);

// Google Cloud Storage example endpoint (optional, for debugging)
app.get('/storage-example', async (req, res) => {
  try {
    const { storage } = require('./utilis/cloudStorage');
    const projectId = await storage.getProjectId();
    const [buckets] = await storage.getBuckets();
    res.json({ buckets });
  } catch (err) {
    logger.error(`Error in /storage-example route: ${err.message}`);
    res.status(500).json({
      message: 'Error accessing Google Cloud Storage',
      error: err.message,
    });
  }
});

// CSRF error handler
app.use((err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') return next(err);
  res.status(403).send('Form tampered with');
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
    logger.warn('Socket.io authentication error: No user in session');
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
    logger.info('Reset all users to offline on server startup');
  } catch (err) {
    logger.error(`Error resetting online status on startup: ${err.message}`);
  }
});

io.on('connection', async (socket) => {
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
    io.to(chatId).emit('newMessage', message);
    try {
      const Chat = require('./models/chat');
      const chat = await Chat.findById(chatId);
      if (chat) {
        chat.messages.push(message);
        chat.updatedAt = new Date();
        await chat.save();
      } else {
        logger.error(`Chat not found: ${chatId}`);
      }
    } catch (err) {
      logger.error(`Error saving chat message: ${err.message}`);
    }
  });

  socket.on('disconnect', async () => {
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
  logger.info(`Server is running on port ${PORT}`);
});