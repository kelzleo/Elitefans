const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcrypt');
const User = require('../models/users'); // Import User model
const crypto = require('crypto');
const sendEmail = require('../config/sendEmail')

// Homepage route
router.get('/', (req, res) => {
    res.render('welcome', { errorMessage: '' }); // Pass an empty errorMessage to prevent errors
});

// Signup route (POST)
router.post('/signup', async (req, res) => {
    const { username, email, password } = req.body;

    try {
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.render('signup', { errorMessage: 'Email or username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate a verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');

        const newUser = new User({
            username,
            email,
            password: hashedPassword,
            verificationToken,
        });

        await newUser.save();

        // Send verification email
        const verificationLink = `https://onlyaccess.onrender.com/verify/${verificationToken}`;
        await sendEmail(
            email,
            'Verify Your Email',
            `<p>Thank you for signing up! Please verify your email by clicking the link below:</p>
             <a href="${verificationLink}">Verify Email</a>`
        );

        res.render('welcome', { errorMessage: 'Check your email to verify your account.' });
    } catch (error) {
        console.error('Error signing up user:', error);
        res.render('signup', { errorMessage: 'An error occurred while signing up. Please try again.' });
    }
});

router.get('/verify/:token', async (req, res) => {
    try {
        const { token } = req.params;

        const user = await User.findOne({ verificationToken: token });

        if (!user) {
            return res.render('welcome', { errorMessage: 'Invalid or expired verification link.' });
        }

        // Mark the user as verified
        user.verified = true;
        user.verificationToken = undefined; // Clear the token
        await user.save();

        // Render the verification success page
        res.render('verified', { successMessage: 'Your email has been successfully verified!' });
    } catch (error) {
        console.error('Error verifying email:', error);
        res.render('welcome', { errorMessage: 'An error occurred. Please try again.' });
    }
});



// Signup route (GET)
router.get('/signup', (req, res) => {
    res.render('signup', { errorMessage: '' }); // Always pass errorMessage even if empty
});

// Logout route
router.get('/logout', (req, res, next) => {
    req.logout(function(err) {
        if (err) {
            return next(err);
        }
        res.redirect('/'); // Redirect to homepage after logout
    });
});

// Google login route
router.get('/google', passport.authenticate('google', {
    scope: ['profile', 'email']
}));

// Google callback route
router.get('/google/redirect', passport.authenticate('google'), (req, res) => {
    res.redirect('/profile'); // Redirect to profile page after successful Google login
});

// Local login route (POST)
router.post('/login', (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) {
            return next(err);
        }
        if (!user) {
            // Render the welcome page with the error message
            return res.render('welcome', { errorMessage: info.message || 'Invalid login credentials' });
        }
        req.logIn(user, (err) => {
            if (err) {
                return next(err);
            }
            return res.redirect('/profile');
        });
    })(req, res, next);
});

module.exports = router;
