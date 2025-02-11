require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const profileRoutes = require('./routes/profile');
const expressLayouts = require('express-ejs-layouts');
const keys = require('./config/keys'); // Correct path to keys.js in the config folder
const passport = require('passport');
const session = require('express-session');
const passportSetup = require('./config/passport-setup'); // Correct path to passport-setup.js in the config folder
const flash = require('connect-flash');
const uploadRoute = require('./routes/uploadRoute');
const homeRoutes = require('./routes/home');
const createRoutes = require('./routes/creator');


// Import Google Cloud SDK
const { Storage } = require('@google-cloud/storage');

const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
const redirectUrl = `${baseUrl}/profile/verify-payment`;

console.log(`🌍 Redirect URL: ${redirectUrl}`);

// Dynamically set GOOGLE_APPLICATION_CREDENTIALS from keys.js
process.env.GOOGLE_APPLICATION_CREDENTIALS = keys.googleCloud.keyFilePath;
console.log('GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);

// Initialize Google Cloud Storage
const storage = new Storage();
console.log('Google Cloud credentials loaded successfully.')

const indexRoutes = require('./routes/index');
const usersRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const adminRoutes = require('./routes/admin');

const User = require('./models/users'); // Import your User model

const app = express();

// MongoDB connection
mongoose.connect('mongodb+srv://kelzleo:batman246@cluster0.8thrx.mongodb.net/?retryWrites=true&w=majority', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000,
});

// Middleware setup
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.use(express.static('public'));

app.use(express.urlencoded({ extended: true })); // For parsing form data (application/x-www-form-urlencoded)
app.use(express.json()); // For parsing application/json

// Session middleware setup
app.use(session({
    secret: keys.session.cookieKey, // Use your session key here
    resave: false, // Don't resave session if not modified
    saveUninitialized: true, // Save an uninitialized session
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }, // Modify for HTTPS if needed
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session()); // Enables session management

// Flash middleware - Enable flash messages
app.use(flash());

// Global variables for flash messages
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg'); // Set error_msg to be available in the views
    res.locals.error = req.flash('error');
    next();
});

// Routes
app.use('/', indexRoutes);
app.use('/users', usersRoutes);
app.use('/profile', profileRoutes);
app.use('/settings', settingsRoutes);
app.use('/admin', adminRoutes);
app.use('/api', uploadRoute);
app.use('/home', homeRoutes);
app.use('/create', createRoutes);


// Example: Use Google Cloud Storage in an endpoint
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


// Start server
app.listen(4000, () => {
    console.log('Listening on port 4000');
});
