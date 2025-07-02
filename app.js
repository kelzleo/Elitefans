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
const Post = require('./models/Post');
const multer = require('multer');
const logger = require('./logs/logger');
const csurf = require('csurf');
const helmet = require('helmet');
const { body, param, validationResult } = require('express-validator');
const SignedUrlSession = require('./models/signedUrlSession');
const axios = require('axios');
const cron = require('node-cron');

const { regenerateSignedUrl, extendSessionActivity, regenerateExpiring, createSignedUrlSession, cleanupExpiredSessions } = require('./utilis/cloudStorage');

const keys = require('./config/keys');
require('./config/passport-setup');

const updateUserStatus = require('./middleware/updateUserStatus');

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

if (!process.env.COOKIE_KEY) {
  console.error('COOKIE_KEY is not set in environment variables');
  process.exit(1);
}

const app = express();

app.set('trust proxy', 1);

app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && !req.secure) {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});

mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 30000,
  })
  .then(() => logger.info('Connected to MongoDB'))
  .catch((err) => logger.error(`MongoDB connection error: ${err.message}`));

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB connection error: ${err.message}`);
});
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected, attempting to reconnect...');
});
mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});

const upload = multer({
  storage: multer.memoryStorage(),
  
});

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
          "https://cdnjs.cloudflare.com",
        ],
        styleSrc: [
          "'self'",
          "https://fonts.googleapis.com",
          "https://cdnjs.cloudflare.com",
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdnjs.cloudflare.com",
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          "https://storage.googleapis.com",
        ],
        mediaSrc: [  // <--- ADD THIS**
        "'self'",
        "https://storage.googleapis.com",
      ],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginEmbedderPolicy: false,
  })
);

const INACTIVITY_MS = 30 * 60 * 1000;
const ABS_MS = 4 * 60 * 60 * 1000;

const sessionMiddleware = session({
  secret: process.env.COOKIE_KEY,
  saveUninitialized: false,
  resave: false,
  rolling: true,
  cookie: {
    maxAge: INACTIVITY_MS,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
  },
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    collectionName: 'sessions',
    ttl: INACTIVITY_MS / 1000,
    autoRemove: 'native',
    touchAfter: 0,
  }),
});
app.use(sessionMiddleware);

app.use(passport.initialize());
app.use(passport.session());





app.use(csurf());
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

app.use((req, res, next) => {
  if (!req.session) return next();

  if (req.user && !req.session.firstLoginAt) {
    req.session.firstLoginAt = Date.now();
  }

  if (req.session.firstLoginAt && Date.now() - req.session.firstLoginAt > ABS_MS) {
    return req.session.destroy((err) => {
      if (err) logger.error('Error destroying session after absolute timeout', err);
      res.clearCookie('connect.sid', { path: '/' });
      return res.redirect('/login?msg=session_expired');
    });
  }

  next();
});

app.use((req, res, next) => {
  if (!req.sessionID) {
    logger.warn('No sessionID generated');
  }
  req.session.save((err) => {
    if (err) logger.error(`Error saving session: ${err.message}`);
    next();
  });
});

app.use(updateUserStatus);
app.use((req, res, next) => {
  res.locals.isWelcomePage = req.path === '/';
  next();
});

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

app.post('/store-redirect', [
  body('redirectTo')
    .notEmpty()
    .withMessage('Redirect URL is required')
    .isString()
    .withMessage('Redirect URL must be a string')
    .matches(/^\/profile\//)
    .withMessage('Redirect URL must start with /profile/')
    .trim()
    .escape(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in POST /store-redirect: ' + JSON.stringify(errors.array()));
    return res.status(400).json({ status: 'error', message: errors.array().map((err) => err.msg).join(', ') });
  }

  const { redirectTo } = req.body;
  req.session.redirectTo = redirectTo;
  req.session.save((err) => {
    if (err) {
      logger.error(`Error saving session in /store-redirect: ${err.message}`);
      return res.status(500).json({ status: 'error', message: 'Failed to save session' });
    }
    res.status(200).json({ status: 'success' });
  });
});

function canAccessPost(post, user) {
  if (!user || !post) return false;

  // Grant access to admins
  if (user.role === 'admin') return true;

  const isOwner = user._id.toString() === post.creator.toString();
  const isSubscribed =
    user.subscriptions &&
    user.subscriptions.some(
      (sub) =>
        sub.creatorId.toString() === post.creator.toString() &&
        sub.status === 'active' &&
        sub.subscriptionExpiry > new Date()
    );
  const hasPurchased =
    user.purchasedContent &&
    user.purchasedContent.some((p) => p.contentId.toString() === post._id.toString());
  const canViewSpecialContent = isOwner || hasPurchased;

  logger.debug(`canAccessPost for post ${post._id}: isOwner=${isOwner}, isSubscribed=${isSubscribed}, hasPurchased=${hasPurchased}, special=${post.special}`);
  return isOwner || hasPurchased || (!post.special && isSubscribed);
}
app.post(
  '/api/generate-signed-urls',
  [
    body('*.postId')
      .isMongoId()
      .withMessage('Invalid post ID'),
    body('*.media.*.originalUrl')
      .notEmpty()
      .withMessage('Original URL required'),
    body('*.media.*.originalPoster')
      .optional()
      .custom((value) => {
        if (value === null || value === undefined) return true;
        if (typeof value !== 'string' || value.trim() === '') {
          throw new Error('Original poster URL must be a non-empty string if provided');
        }
        return true;
      }),
    body('*.media.*.elementId')
      .notEmpty()
      .withMessage('Element ID required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(
        `Validation errors in POST /api/generate-signed-urls: ${JSON.stringify(errors.array())}`
      );
      return res
        .status(400)
        .json({ message: errors.array().map((e) => e.msg).join(', ') });
    }

    if (!req.user) {
      return res
        .status(401)
        .json({ message: 'Authentication required' });
    }

    const userId   = req.user._id;
    const postData = req.body;

    logger.debug(
      `Received /api/generate-signed-urls request for user ${userId}: ${JSON.stringify(postData)}`
    );

    try {
      const sessions = {};

      for (const { postId, media } of postData) {
        logger.debug(`Processing post ${postId} for user ${userId}`);

        const post = await Post.findById(postId);
        if (!post) {
          logger.warn(`Post not found: ${postId}`);
          continue;
        }

        if (!canAccessPost(post, req.user)) {
          logger.warn(`Unauthorized access to post ${postId} by user ${userId}`);
          continue;
        }

        sessions[postId] = [];

        // Limit to at most 3 items
        const limitedMedia = media.slice(0, 3);

        // Fetch existing sessions to reuse
        const existing = await SignedUrlSession.find({
          userId,
          postId,
          isActive: true,
          sessionExpiresAt: { $gt: new Date() },
          createdAt: { $gt: new Date(Date.now() - ABS_MS) },
        }).select('_id filename');

        const sessionMap = new Map(existing.map((s) => [s.filename, s._id.toString()]));

        for (const { originalUrl, originalPoster, elementId } of limitedMedia) {
          try {
            // reuse or create a new SignedUrlSession
            let sessionId = sessionMap.get(originalUrl);
            if (!sessionId) {
              sessionId = (await createSignedUrlSession(userId, originalUrl, postId)).toString();
            }

            const sessObj = {
              elementId,
              sessionId,
              url: `/media/${sessionId}`,
            };

            // handle poster if present
            if (originalPoster) {
              let posterSessionId = sessionMap.get(originalPoster);
              if (!posterSessionId) {
                posterSessionId = (await createSignedUrlSession(userId, originalPoster, postId)).toString();
              }
              sessObj.posterUrl       = `/media/${posterSessionId}`;
              sessObj.posterSessionId = posterSessionId;
            }

            sessions[postId].push(sessObj);
          } catch (err) {
            logger.error(
              `Failed to create signed URL session for post ${postId}, media ${originalUrl}: ${err.message}`
            );
          }
        }

        logger.info(`Generated ${sessions[postId].length} sessions for post ${postId}`);
      }

      if (Object.keys(sessions).length === 0) {
        logger.warn(`No valid sessions generated for user ${userId}`);
      }

      return res.json({ sessions });
    } catch (err) {
      logger.error(`Error in /api/generate-signed-urls: ${err.message}`);
      return res.status(500).json({ message: 'Server error' });
    }
  }
);
// ─── Server: app.js ───
app.post(
  '/api/extend-session-activity',
  [
    body('sessionId').isMongoId().withMessage('Invalid session ID'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(
        'Validation errors in POST /api/extend-session-activity: ' +
          JSON.stringify(errors.array())
      );
      return res
        .status(400)
        .json({ message: errors.array().map((e) => e.msg).join(', ') });
    }

    if (!req.user) {
      return res
        .status(401)
        .json({ message: 'Authentication required' });
    }

    const { sessionId } = req.body;

    try {
      // Only extend this one session, not all
      const modifiedCount = await extendSessionActivity(
        req.user._id,
        sessionId
      );

      if (modifiedCount > 0) {
        logger.info(
          `Extended session ${sessionId} for user ${req.user._id}`
        );
        return res.status(200).json({ success: true });
      } else {
        logger.warn(
          `No session extended for ${sessionId} (inactive or expired)`
        );
        return res.status(404).json({ message: 'Session not found or expired' });
      }
    } catch (err) {
      logger.error(
        `Error extending session activity for session ${sessionId}: ${err.message}`
      );
      return res.status(500).json({ message: 'Server error' });
    }
  }
);

app.post('/api/cleanup-sessions', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  try {
    const deletedCount = await cleanupExpiredSessions();
    res.json({ success: true, deletedCount });
  } catch (err) {
    logger.error(`Error in /api/cleanup-sessions: ${err.message}`);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/media/:sessionId', [
  param('sessionId').isMongoId().withMessage('Invalid session ID'),
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
      isActive: true,
    });

    if (!session) {
      logger.warn(`Invalid or unauthorized media access by user ${userId} for session ${sessionId}`);
      return res.status(403).json({ error: 'Access denied' });
    }

   
    if (new Date() > session.sessionExpiresAt) {
      logger.warn(`Expired session access by user ${userId} for session ${sessionId}`);
      await SignedUrlSession.deleteOne({ _id: sessionId });
      return res.status(403).json({ error: 'Session expired' });
    }

    const twoMinutesFromNow = new Date(Date.now() + 2 * 60 * 1000);
    if (session.signedUrlExpiresAt < twoMinutesFromNow) {
      logger.info(`Regenerating signed URL for session ${sessionId} on access`);
      session = await regenerateSignedUrl(sessionId);
    }

    try {
      await extendSessionActivity(userId, sessionId);
    } catch (err) {
      logger.warn(`Failed to extend session activity for user ${userId}, session ${sessionId}: ${err.message}`);
    }

    const method = req.method.toLowerCase();
    if (method !== 'head' && method !== 'get') {
      return res.status(405).send('Method not allowed');
    }

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

    const headers = {
      'Content-Type': axiosResponse.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=300',
      'Connection': 'keep-alive',
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

    let completed = false;
    res.on('finish', () => {
      completed = true;
    });

    axiosResponse.data.pipe(res);

    axiosResponse.data.on('error', (err) => {
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
// Media upload route for chat
const { chatBucket: bucket } = require('./utilis/cloudStorage');
app.post('/chat/upload-media', upload.single('media'), async (req, res) => {
  if (!req.file) {
    logger.warn('No file uploaded in /chat/upload-media');
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  if (!req.user) {
    logger.warn('Unauthorized upload attempt in /chat/upload-media');
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  try {
    const file = req.file;
    const allowedTypes = ['image/jpeg', 'image/png', 'video/mp4'];
    if (!allowedTypes.includes(file.mimetype)) {
      logger.warn(`Invalid file type in /chat/upload-media: ${file.mimetype}`);
      return res.status(400).json({ success: false, message: 'Invalid file type. Only JPEG, PNG, and MP4 are allowed.' });
    }

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
      // Create a session for the uploaded media
      const { createSignedUrlSessionForChatMedia } = require('./utilis/cloudStorage');
      try {
        // Note: chatId is not available here, so we'll need to handle it differently
        // For now, we'll return the filename and let the client create the session when needed
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        res.json({ success: true, url: publicUrl });
      } catch (err) {
        logger.error(`Error creating session for uploaded chat media: ${err.message}`);
        res.status(500).json({ success: false, message: 'Error creating media session' });
      }
    });

    blobStream.end(file.buffer);
  } catch (err) {
    logger.error(`Upload error in /chat/upload-media: ${err.message}`);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});


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

app.use((err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') return next(err);
  res.status(403).send('Form tampered with');
});

const server = http.createServer(app);
const io = socketIo(server);

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.use((socket, next) => {
  if (socket.request.session.passport && socket.request.session.passport.user) {
    socket.userId = socket.request.session.passport.user;
    next();
  } else {
    logger.warn('Socket.io authentication error: No user in session');
    next(new Error('Authentication error'));
  }
});

const connectedUsers = new Map();
const HEARTBEAT_INTERVAL = 15000;
const HEARTBEAT_TIMEOUT = 30000;

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

app.set('socketio', io);

cron.schedule('0 */1 * * *', async () => {
  try {
    await cleanupExpiredSessions();
    logger.info('Ran hourly session cleanup');
  } catch (err) {
    logger.error(`Cron job error in cleanupExpiredSessions: ${err.message}`);
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});