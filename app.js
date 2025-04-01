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

// Import configuration and keys
const keys = require('./config/keys'); // Ensure correct path
require('./config/passport-setup'); // Passport configuration

// Import routes
const indexRoutes = require('./routes/index');
const profileRoutes = require('./routes/profile');
const usersRoutes = require('./routes/users');
const requestCreatorRoutes = require('./routes/requestCreator');
const adminRoutes = require('./routes/admin');
const uploadRoute = require('./routes/uploadRoute');
const homeRoutes = require('./routes/home');
const createRoutes = require('./routes/creator');
const chatRoutes = require('./routes/chat');
const chatListRoutes = require('./routes/chatList');
const chatBroadcastRoutes = require('./routes/chatBroadcast');
const notificationsRoute = require('./routes/notifications');
const postsRoute = require('./routes/posts');
const dashboardRoutes = require('./routes/dashboard');

/**
 * 1) Decode Base64 Google Cloud credentials (if present)
 *    and set GOOGLE_APPLICATION_CREDENTIALS to a temp file.
 */
if (process.env.GCLOUD_CREDS_BASE64) {
  console.log('Decoding Base64 GCP credentials...');
  const decoded = Buffer.from(process.env.GCLOUD_CREDS_BASE64, 'base64').toString('utf8');
  const credsPath = path.join('/tmp', 'google.json');
  fs.writeFileSync(credsPath, decoded, 'utf8');
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credsPath;
}

// Now import the Google Cloud Storage library
const { Storage } = require('@google-cloud/storage');

// Set BASE_URL from environment (should match your Render URL)
const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
const redirectUrl = `${baseUrl}/profile/verify-payment`;
console.log(`\u{1F30D} Redirect URL: ${redirectUrl}`);

// Initialize Google Cloud Storage
const storage = new Storage();
console.log('Google Cloud credentials loaded successfully.');

// Initialize Express app
const app = express();

// Tell Express to trust the first proxy (e.g., Render) for secure cookies
app.set('trust proxy', 1);

// MongoDB connection using environment variable for URI
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000,
  })
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Middleware setup
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session middleware setup (enable secure cookies in production)
app.use(
  session({
    secret: keys.session.cookieKey,
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Flash middleware for messages
app.use(flash());
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.currentUser = req.user;
  next();
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
app.use('/chat', chatRoutes);
app.use('/chats', chatListRoutes);
app.use('/chat/broadcast', chatBroadcastRoutes);
app.use('/notifications', notificationsRoute);
app.use('/posts', postsRoute);
app.use('/dashboard', dashboardRoutes);

// Example endpoint for Google Cloud Storage usage
app.get('/storage-example', async (req, res) => {
  try {
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

// -------------------------
// Chat (Socket.io) Setup
// -------------------------
const server = http.createServer(app);
const io = socketIo(server);

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('joinRoom', ({ chatId }) => {
    socket.join(chatId);
    console.log(`Socket ${socket.id} joined room ${chatId}`);
  });

  socket.on('sendMessage', async ({ chatId, sender, text }) => {
    const message = { sender, text, timestamp: new Date() };
    io.to(chatId).emit('newMessage', message);
    try {
      const Chat = require('./models/chat');
      const chat = await Chat.findById(chatId);
      if (chat) {
        chat.messages.push(message);
        await chat.save();
      }
    } catch (err) {
      console.error('Error saving chat message:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// -------------------------
// End Chat Setup
// -------------------------

// Start the server using the HTTP server (for Socket.io compatibility)
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
