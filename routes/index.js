const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcrypt');
const User = require('../models/users');
const crypto = require('crypto');
const sendEmail = require('../config/sendEmail');

router.get('/', (req, res) => {
  if (req.query.ref) {
    req.session.referralId = req.query.ref;
  }
  res.render('welcome', { errorMessage: '', ref: req.query.ref || req.session.referralId || '' });
});

router.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    console.log('Signup Request - URL:', req.url, 'Query:', req.query, 'Body:', req.body, 'Session:', req.session);
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.render('signup', { errorMessage: 'Email or username already exists', ref: req.query.ref || req.body.ref || req.session.referralId || '' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      verificationToken,
      isOnline: false,
      lastSeen: new Date(),
    });
    const ref = req.query.ref || req.body.ref || req.session.referralId;
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
      console.log('No ref parameter in query, body, or session');
    }
    await newUser.save();
    console.log('User saved:', { id: newUser._id, referredBy: newUser.referredBy });
    delete req.session.referralId;
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
    res.render('signup', { errorMessage: 'An error occurred while signing up. Please try again.', ref: req.query.ref || req.body.ref || req.session.referralId || '' });
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
  res.render('signup', { errorMessage: '', ref: req.query.ref || req.session.referralId || '' });
});

router.get('/logout', async (req, res, next) => {
  try {
    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, {
        isOnline: false,
        lastSeen: new Date(),
      });
    }
    req.logout(function (err) {
      if (err) {
        return next(err);
      }
      res.redirect('/');
    });
  } catch (error) {
    console.error('Error during logout:', error);
    res.redirect('/');
  }
});

router.get('/google', (req, res, next) => {
  if (req.query.ref) {
    req.session.referralId = req.query.ref;
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/redirect', passport.authenticate('google'), async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      isOnline: true,
      lastSeen: new Date(),
    });
    delete req.session.referralId;
    res.redirect('/profile');
  } catch (error) {
    console.error('Error during Google login:', error);
    res.redirect('/profile');
  }
});

router.post('/login', (req, res, next) => {
  passport.authenticate('local', async (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.render('welcome', { errorMessage: info.message || 'Invalid login credentials' });
    }
    req.logIn(user, async (err) => {
      if (err) {
        return next(err);
      }
      try {
        await User.findByIdAndUpdate(user._id, {
          isOnline: true,
          lastSeen: new Date(),
        });
        return res.redirect('/profile');
      } catch (error) {
        console.error('Error during login:', error);
        return res.redirect('/profile');
      }
    });
  })(req, res, next);
});

module.exports = router;