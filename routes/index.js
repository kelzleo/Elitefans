// index.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcrypt');
const User = require('../models/users');
const crypto = require('crypto');
const sendEmail = require('../config/sendEmail');

router.get('/', (req, res) => {
    res.render('welcome', { errorMessage: '' });
});

router.post('/signup', async (req, res) => {
    const { username, email, password } = req.body;

    try {
        console.log('Signup Request - URL:', req.url, 'Query:', req.query, 'Body:', req.body);
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.render('signup', { errorMessage: 'Email or username already exists', ref: req.query.ref || req.body.ref || '' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationToken = crypto.randomBytes(32).toString('hex');

        const newUser = new User({
            username,
            email,
            password: hashedPassword,
            verificationToken,
        });

        // Check for referral parameter from query or body
        const ref = req.query.ref || req.body.ref;
        if (ref) {
            console.log('Ref parameter detected:', ref);
            const referrer = await User.findById(ref);
            console.log('Referrer:', referrer ? { id: referrer._id, role: referrer.role } : 'Not found');
            if (referrer && referrer.role === 'creator') {
                newUser.referredBy = referrer._id;
                console.log('Setting referredBy to:', referrer._id);
            } else {
                console.log('Referrer invalid or not a creator');
            }
        } else {
            console.log('No ref parameter in query or body');
        }

        await newUser.save();
        console.log('User saved:', { id: newUser._id, referredBy: newUser.referredBy });

        // Verify in database
        const savedUser = await User.findById(newUser._id);
        console.log('Database check - Saved user referredBy:', savedUser.referredBy);

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
        res.render('signup', { errorMessage: 'An error occurred while signing up. Please try again.', ref: req.query.ref || req.body.ref || '' });
    }
});

router.get('/verify/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const user = await User.findOne({ verificationToken: token });

        if (!user) {
            return res.render('welcome', { errorMessage: 'Invalid or expired verification link.' });
        }

        user.verified = true;
        user.verificationToken = undefined;
        await user.save();

        res.render('verified', { successMessage: 'Your email has been successfully verified!' });
    } catch (error) {
        console.error('Error verifying email:', error);
        res.render('welcome', { errorMessage: 'An error occurred. Please try again.' });
    }
});

router.get('/signup', (req, res) => {
    res.render('signup', { errorMessage: '', ref: req.query.ref || '' });
});

router.get('/logout', (req, res, next) => {
    req.logout(function(err) {
        if (err) {
            return next(err);
        }
        res.redirect('/');
    });
});

router.get('/google', passport.authenticate('google', {
    scope: ['profile', 'email']
}));

router.get('/google/redirect', passport.authenticate('google'), (req, res) => {
    res.redirect('/profile');
});

router.post('/login', (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) {
            return next(err);
        }
        if (!user) {
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