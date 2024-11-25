const express = require('express');
const mongoose = require('mongoose');
const profileRoutes = require('./routes/profile');
const expressLayouts = require('express-ejs-layouts');
const keys = require('./config/keys');  // Correct path to keys.js in the config folder
const passport = require('passport');
const session = require('express-session');
const passportSetup = require('./config/passport-setup');  // Correct path to passport-setup.js in the config folder
const flash = require('connect-flash');

const indexRoutes = require('./routes/index');
const usersRoutes = require('./routes/users');
const User = require('./models/users'); // Import your User model

const app = express();

// MongoDB connection
mongoose.connect('mongodb://localhost/onlyfan-blog', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

// Middleware setup
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.use(express.static('public'));

app.use(express.urlencoded({ extended: true }));  // For parsing form data (application/x-www-form-urlencoded)
app.use(express.json());  // For parsing application/json (if needed)

// Session middleware setup
app.use(session({
    secret: keys.session.cookieKey,  // Use your session key here
    resave: false,  // Don't resave session if not modified
    saveUninitialized: true,  // Save an uninitialized session
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }  // Modify if needed for HTTPS
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());  // Enables session management

// Flash middleware - This enables flashing messages
app.use(flash());  // Add this line to enable connect-flash

// Global variables for flash messages
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');  // Set error_msg to be available in the views
    res.locals.error = req.flash('error');
    next();
});

// Routes
app.use('/', indexRoutes);
app.use('/users', usersRoutes);
app.use('/profile', profileRoutes);

// Start server
app.listen(4000, () => {
    console.log('Listening on port 4000');
});
