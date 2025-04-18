// routes/index.js
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
  const startTime = Date.now();
  const { username, email, password, creator } = req.body;
  try {
    console.log('Signup Request - URL:', req.url, 'Query:', req.query, 'Body:', req.body, 'Session:', req.session);
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.render('signup', { errorMessage: 'Email or username already exists', ref: req.query.ref || req.body.ref || req.session.referralId || '', creator: creator || req.query.creator });
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
    // Store creator profile URL in session if creator parameter exists
    if (creator) {
      req.session.redirectTo = `/profile/${creator}`;
    }
    await newUser.save();
    console.log('User saved:', { id: newUser._id, referredBy: newUser.referredBy });
    delete req.session.referralId;
    const verificationLink = `https://onlyaccess.onrender.com/verify/${verificationToken}`;
    
    const emailStartTime = Date.now();
    await sendEmail(
      email,
      'Verify Your Email',
      `<p>Thank you for signing up! Please verify your email by clicking the link below:</p>
       <a href="${verificationLink}">Verify Email</a>`
    );
    const emailEndTime = Date.now();
    console.log(`Total time for signup email sending: ${(emailEndTime - emailStartTime) / 1000} seconds`);
    
    const endTime = Date.now();
    console.log(`Total signup route time: ${(endTime - startTime) / 1000} seconds`);
    
    res.render('welcome', { errorMessage: 'Check your email to verify your account.', creator });
  } catch (error) {
    console.error('Error signing up user:', error);
    res.render('signup', { errorMessage: 'An error occurred while signing up. Please try again.', ref: req.query.ref || req.body.ref || req.session.referralId || '', creator: creator || req.query.creator });
  }
});
// In index.js, update the /verify/:token GET route
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
    // Redirect to the stored creator profile URL or login page
    const redirectTo = req.session.redirectTo || '/';
    delete req.session.redirectTo; // Clear the session variable
    delete req.session.subscriptionData; // Clear subscription data if stored
    res.redirect(redirectTo);
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

// In index.js, update the /google/redirect GET route
router.get('/google/redirect', passport.authenticate('google'), async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      isOnline: true,
      lastSeen: new Date(),
    });
    // Check for creator parameter in query and store in session
    const { creator } = req.query;
    if (creator) {
      req.session.redirectTo = `/profile/${creator}`;
    }
    // Redirect to the stored creator profile URL or profile page
    const redirectTo = req.session.redirectTo || '/profile';
    delete req.session.redirectTo; // Clear the session variable
    delete req.session.subscriptionData; // Clear subscription data if stored
    delete req.session.referralId;
    res.redirect(redirectTo);
  } catch (error) {
    console.error('Error during Google login:', error);
    res.redirect('/profile');
  }
});

// In index.js, update the /login POST route
router.post('/login', (req, res, next) => {
  const { creator } = req.body;
  // Store creator profile URL in session if creator parameter exists
  if (creator) {
    req.session.redirectTo = `/profile/${creator}`;
  }
  passport.authenticate('local', async (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.render('welcome', { errorMessage: info.message || 'Invalid login credentials', creator });
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
        // Redirect to the stored creator profile URL or profile page
        const redirectTo = req.session.redirectTo || '/profile';
        delete req.session.redirectTo; // Clear the session variable
        delete req.session.subscriptionData; // Clear subscription data if stored
        return res.redirect(redirectTo);
      } catch (error) {
        console.error('Error during login:', error);
        return res.redirect('/profile');
      }
    });
  })(req, res, next);
});
// Route to render the change password form (protected route)
router.get('/change-password', (req, res) => {
  if (!req.user) {
    return res.redirect('/'); // Redirect to login if not authenticated
  }
  res.render('change-password', { errorMessage: '', successMessage: '' });
});

// Route to handle password change
router.post('/change-password', async (req, res) => {
  if (!req.user) {
    return res.redirect('/'); // Redirect to login if not authenticated
  }

  const { currentPassword, newPassword, confirmPassword } = req.body;

  try {
    const user = await User.findById(req.user._id);

    // Check if user signed up with Google (no password to change)
    if (user.googleId && !user.password) {
      return res.render('change-password', {
        errorMessage: 'Cannot change password for Google accounts.',
        successMessage: '',
      });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.render('change-password', {
        errorMessage: 'Current password is incorrect.',
        successMessage: '',
      });
    }

    // Check if new passwords match
    if (newPassword !== confirmPassword) {
      return res.render('change-password', {
        errorMessage: 'New passwords do not match.',
        successMessage: '',
      });
    }

    // Validate new password length
    if (newPassword.length < 6) {
      return res.render('change-password', {
        errorMessage: 'New password must be at least 6 characters long.',
        successMessage: '',
      });
    }

    // Hash the new password and save
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.render('change-password', {
      errorMessage: '',
      successMessage: 'Password changed successfully!',
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.render('change-password', {
      errorMessage: 'An error occurred. Please try again.',
      successMessage: '',
    });
  }
});

// Route to render the forgot password form
router.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { errorMessage: '', successMessage: '' });
});

// Route to handle forgot password request
router.post('/forgot-password', async (req, res) => {
  const startTime = Date.now();
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.render('forgot-password', {
        errorMessage: 'No account with that email address exists.',
        successMessage: '',
      });
    }

    // Check if user signed up with Google
    if (user.googleId && !user.password) {
      return res.render('forgot-password', {
        errorMessage: 'Cannot reset password for Google accounts.',
        successMessage: '',
      });
    }

    // Generate a reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour expiry
    await user.save();

    // Send reset email
    const resetLink = `https://onlyaccess.onrender.com/reset-password/${resetToken}`;
    console.log('Attempting to send email to:', email);
    console.log('Reset Link:', resetLink);
    
    const emailStartTime = Date.now();
    try {
      const emailResponse = await sendEmail(
        email,
        'Password Reset Request',
        `<p>You requested a password reset. Click the link below to reset your password:</p>
         <a href="${resetLink}">Reset Password</a>
         <p>This link will expire in 1 hour.</p>`
      );
      const emailEndTime = Date.now();
      console.log(`Total time for forgot-password email sending: ${(emailEndTime - emailStartTime) / 1000} seconds`);
      console.log('Email sent successfully:', emailResponse);
      res.render('forgot-password', {
        errorMessage: '',
        successMessage: 'A password reset link has been sent to your email. It may take a few minutes to arrive.',
      });
    } catch (emailError) {
      console.error('Failed to send email:', emailError);
      // Roll back the token since the email failed to send
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      res.render('forgot-password', {
        errorMessage: 'Failed to send reset email. Please try again later.',
        successMessage: '',
      });
    }
    
    const endTime = Date.now();
    console.log(`Total forgot-password route time: ${(endTime - startTime) / 1000} seconds`);
  } catch (error) {
    console.error('Error in forgot password:', error);
    res.render('forgot-password', {
      errorMessage: 'An error occurred. Please try again.',
      successMessage: '',
    });
  }
});

// Route to render the reset password form
router.get('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.render('welcome', {
        errorMessage: 'Password reset link is invalid or has expired.',
      });
    }

    res.render('reset-password', { token, errorMessage: '', successMessage: '' });
  } catch (error) {
    console.error('Error rendering reset password form:', error);
    res.render('welcome', {
      errorMessage: 'An error occurred. Please try again.',
    });
  }
});

// Route to handle password reset
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword, confirmPassword } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.render('welcome', {
        errorMessage: 'Password reset link is invalid or has expired.',
      });
    }

    // Check if new passwords match
    if (newPassword !== confirmPassword) {
      return res.render('reset-password', {
        token,
        errorMessage: 'Passwords do not match.',
        successMessage: '',
      });
    }

    // Validate new password length
    if (newPassword.length < 6) {
      return res.render('reset-password', {
        token,
        errorMessage: 'Password must be at least 6 characters long.',
        successMessage: '',
      });
    }

    // Update the password
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.render('welcome', {
      errorMessage: 'Your password has been reset successfully. Please log in.',
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.render('reset-password', {
      token: req.params.token,
      errorMessage: 'An error occurred. Please try again.',
      successMessage: '',
    });
  }
});

module.exports = router;