// routes/index.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcrypt');
const User = require('../models/users');
const crypto = require('crypto');
const sendEmail = require('../config/sendEmail');
const PendingSubscription = require('../models/pendingSubscription');

router.get('/', async (req, res) => {
  console.log('Welcome page - Query:', req.query, 'Session:', req.session, 'SessionID:', req.sessionID);
  const { creator, ref } = req.query;

  // Store creator in session.redirectTo if provided
  if (creator) {
    req.session.redirectTo = `/profile/${encodeURIComponent(creator)}`;
    console.log('Stored creator redirect in session:', req.session.redirectTo, 'SessionID:', req.sessionID);
    req.session.save(err => {
      if (err) {
        console.error('Error saving session in GET /:', err);
      } else {
        console.log('Session saved in GET /:', req.session);
      }
    });
  } else {
    console.log('No creator query parameter provided');
  }

  // Store referral ID if provided
  if (ref) {
    const referrer = await User.findOne({ _id: ref });
    if (referrer && referrer.role === 'creator') {
      req.session.referralId = ref;
      console.log('Stored referralId in session:', ref);
    } else {
      console.log('Invalid referral ID:', ref);
    }
  }

  res.render('welcome', {
    errorMessage: req.flash('error'),
    successMessage: req.flash('success'),
    creator: creator || req.session.creator || '',
    ref: ref || req.session.referralId || ''
  });
});
router.post('/signup', async (req, res) => {
  const startTime = Date.now();
  const { username, email, password, creator } = req.body;
  const queryCreator = req.query.creator;
  const sessionCreator = req.session.creator;
  const ref = req.query.ref || req.body.ref || req.session.referralId;
  console.log('Signup Request - Body:', req.body, 'Query:', req.query, 'Session:', req.session, 'SessionID:', req.sessionID);

  try {
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      console.log('Existing user found:', { email, username });
      return res.render('signup', {
        errorMessage: 'Email or username already exists',
        ref: ref || '',
        creator: creator || queryCreator || sessionCreator || ''
      });
    }

    let redirectUrl = null;
    const creatorParam = creator || queryCreator || sessionCreator;
    if (creatorParam) {
      const creatorUser = await User.findOne({ username: creatorParam });
      if (creatorUser) {
        redirectUrl = `/profile/${encodeURIComponent(creatorParam)}`;
        console.log('Valid creator found:', creatorParam, 'Setting redirectUrl:', redirectUrl);
      } else {
        console.log('Invalid creator:', creatorParam);
      }
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
      redirectAfterVerify: redirectUrl,
      referredBy: null
    });

    if (ref) {
      console.log('Ref parameter detected:', ref);
      const referrer = await User.findById(ref);
      if (referrer && referrer.role === 'creator') {
        newUser.referredBy = referrer._id;
        console.log('Setting referredBy to:', referrer._id);
      } else {
        console.log('Invalid referrer:', ref);
      }
    }

    if (redirectUrl) {
      req.session.redirectTo = redirectUrl;
      req.session.creator = creatorParam;
      await new Promise((resolve, reject) => {
        req.session.save(err => {
          if (err) {
            console.error('Session save error in /signup:', err);
            reject(err);
          } else {
            console.log('Session saved successfully in /signup:', req.session);
            resolve();
          }
        });
      });
    }

    await newUser.save();
    console.log('User saved:', { id: newUser._id, referredBy: newUser.referredBy, redirectAfterVerify: newUser.redirectAfterVerify });
    delete req.session.referralId;

    const verificationLink = `https://onlyaccess.onrender.com/verify/${verificationToken}${creatorParam ? `?creator=${encodeURIComponent(creatorParam)}` : ''}${ref ? `${creatorParam ? '&' : '?'}ref=${encodeURIComponent(ref)}` : ''}`;
    console.log('Verification link generated:', verificationLink);

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

    res.render('welcome', {
      errorMessage: 'Check your email to verify your account.',
      creator: creatorParam || '',
      ref: ref || ''
    });
  } catch (error) {
    console.error('Error signing up user:', error);
    res.render('signup', {
      errorMessage: 'An error occurred while signing up. Please try again.',
      ref: ref || '',
      creator: creator || queryCreator || sessionCreator || ''
    });
  }
});
router.get('/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { creator, ref } = req.query;
    console.log('Verification Request - Token:', token, 'Creator:', creator, 'Ref:', ref, 'Session:', req.session, 'SessionID:', req.sessionID);

    const user = await User.findOne({ verificationToken: token });
    if (!user) {
      console.log('No user found for token:', token);
      const alreadyVerifiedUser = await User.findOne({ email: { $exists: true }, verified: true });
      if (alreadyVerifiedUser) {
        console.log('User already verified for email:', alreadyVerifiedUser.email);
        return res.render('welcome', {
          errorMessage: 'Your email is already verified. Please log in.',
          creator: creator || req.session.creator || '',
          ref: ref || ''
        });
      }
      return res.render('welcome', {
        errorMessage: ' ecuInvalid or expired verification link.',
        creator: creator || req.session.creator || '',
        ref: ref || ''
      });
    }

    // Determine redirect URL
    let redirectTo = '/home';
    if (creator) {
      const creatorUser = await User.findOne({ username: creator });
      if (creatorUser) {
        redirectTo = `/profile/${encodeURIComponent(creator)}`;
        console.log('Redirecting based on query creator:', creator);
      }
    } else if (user.redirectAfterVerify) {
      redirectTo = user.redirectAfterVerify;
      console.log('Redirecting based on user.redirectAfterVerify:', redirectTo);
    } else if (req.session.redirectTo) {
      redirectTo = req.session.redirectTo;
      console.log('Redirecting based on session.redirectTo:', redirectTo);
    } else {
      const pendingSub = await PendingSubscription.findOne({ sessionId: req.sessionID });
      if (pendingSub) {
        const creatorUser = await User.findById(pendingSub.creatorId);
        if (creatorUser) {
          redirectTo = `/profile/${encodeURIComponent(pendingSub.creatorUsername)}`;
          console.log('Redirecting based on PendingSubscription:', redirectTo);
        }
      }
    }

    // Update user
    user.verified = true;
    user.verificationToken = undefined;
    user.redirectAfterVerify = null;
    await user.save();
    console.log('User verified:', user._id, 'Redirecting to:', redirectTo);

    // Log in the user
    req.login(user, async (err) => {
      if (err) {
        console.error('Login error after verification:', err);
        return res.render('welcome', {
          errorMessage: 'Error logging in after verification. Please try logging in manually.',
          creator: creator || req.session.creator || '',
          ref: ref || ''
        });
      }

      try {
        await User.findByIdAndUpdate(user._id, {
          isOnline: true,
          lastSeen: new Date(),
        });

        // Clear session data
        delete req.session.redirectTo;
        delete req.session.creator;
        delete req.session.subscriptionData;
        await new Promise((resolve, reject) => {
          req.session.save(err => {
            if (err) {
              console.error('Session save error in /verify/:token:', err);
              reject(err);
            } else {
              console.log('Session cleared in /verify/:token:', req.session);
              resolve();
            }
          });
        });

        console.log('User logged in after verification, redirecting to:', redirectTo);
        return res.redirect(redirectTo);
      } catch (error) {
        console.error('Error during post-verification login:', error);
        return res.render('welcome', {
          errorMessage: 'Error processing login after verification. Please try logging in manually.',
          creator: creator || req.session.creator || '',
          ref: ref || ''
        });
      }
    });
  } catch (error) {
    console.error('Error verifying email:', error);
    res.render('welcome', {
      errorMessage: 'An error occurred. Please try again.',
      creator: creator || req.session.creator || '',
      ref: ref || ''
    });
  }
});
router.get('/signup', (req, res) => {
  const creator = req.query.creator || req.session.creator || '';
  res.render('signup', { 
    errorMessage: '', 
    ref: req.query.ref || req.session.referralId || '',
    creator: creator
  });
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
  // Store creator in session if provided
  if (req.query.creator) {
    req.session.creator = req.query.creator;
    req.session.redirectTo = `/profile/${req.query.creator}`;
    req.session.save(err => {
      if (err) console.error('Google auth session save error:', err);
    });
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});



// routes/index.js
router.get('/google/redirect', passport.authenticate('google'), async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      isOnline: true,
      lastSeen: new Date(),
    });

    const creator = req.query.creator || req.session.creator;
    let redirectTo = '/home'; // Default to /home
    if (req.session.redirectTo) {
      redirectTo = req.session.redirectTo;
    } else if (creator) {
      const creatorUser = await User.findOne({ username: creator });
      if (creatorUser) {
        redirectTo = `/profile/${encodeURIComponent(creator)}`;
        req.session.redirectTo = redirectTo;
        req.session.creator = creator;
        await new Promise((resolve, reject) => {
          req.session.save(err => {
            if (err) {
              console.error('Session save error:', err);
              reject(err);
            } else {
              console.log('Session saved:', req.session);
              resolve();
            }
          });
        });
      }
    }

    console.log('Google redirect - redirecting to:', redirectTo);

    // Clear session data
    delete req.session.redirectTo;
    delete req.session.subscriptionData;
    delete req.session.referralId;
    delete req.session.creator;

    res.redirect(redirectTo);
  } catch (error) {
    console.error('Error during Google login:', error);
    res.redirect('/home'); // Default to /home on error
  }
});

router.post('/login', (req, res, next) => {
  const { usernameOrEmail, password, creator } = req.body;
  const queryCreator = req.query.creator;
  const sessionCreator = req.session.creator;
  console.log('Login Request - Body:', req.body, 'Query:', req.query, 'Session:', req.session, 'SessionID:', req.sessionID, 'Cookies:', req.headers.cookie, 'Creator from body:', creator, 'Creator from query:', queryCreator, 'Creator from session:', sessionCreator);

  // Validate creator parameter early for debugging
  const creatorParam = creator || queryCreator || sessionCreator;
  if (creatorParam) {
    console.log('Checking creatorParam:', creatorParam);
    User.findOne({ username: creatorParam })
      .then(creatorUser => {
        if (creatorUser) {
          console.log('Valid creator found:', creatorParam);
        } else {
          console.log('Invalid creator:', creatorParam);
        }
      })
      .catch(err => console.error('Error validating creator:', err));
  } else {
    console.log('No creatorParam provided');
  }

  passport.authenticate('local', async (err, user, info) => {
    if (err) {
      console.error('Passport authentication error:', err);
      return next(err);
    }

    if (!user) {
      console.log('Login failed:', info.message || 'Invalid login credentials');
      return res.render('welcome', {
        errorMessage: info.message || 'Invalid username/email or password',
        creator: creatorParam || '',
        ref: req.body.ref || req.query.ref || ''
      });
    }

    req.logIn(user, async (err) => {
      if (err) {
        console.error('req.logIn error:', err);
        return next(err);
      }

      try {
        console.log('User authenticated:', user._id, 'Username:', user.username);
        await User.findByIdAndUpdate(user._id, {
          isOnline: true,
          lastSeen: new Date(),
        });

        // Determine redirect URL
        let redirectTo = '/home';
        let creatorParam = creator || queryCreator || sessionCreator;

        // Log all redirect conditions
        console.log('Redirect conditions - pendingSub:', !!await PendingSubscription.findOne({ sessionId: req.sessionID }), 'session.redirectTo:', req.session.redirectTo, 'creatorParam:', creatorParam, 'req.query.creator:', req.query.creator, 'user.redirectAfterVerify:', user.redirectAfterVerify);

        // Check PendingSubscription
        console.log('Checking PendingSubscription for session:', req.sessionID);
        const pendingSub = await PendingSubscription.findOne({ sessionId: req.sessionID });
        if (pendingSub) {
          console.log('Found pending subscription:', pendingSub);
          redirectTo = `/profile/${encodeURIComponent(pendingSub.creatorUsername)}`;
          creatorParam = pendingSub.creatorUsername;
          await PendingSubscription.deleteOne({ sessionId: req.sessionID });
          console.log('Cleared pending subscription for session:', req.sessionID);
        } else {
          console.log('No pending subscription found for session:', req.sessionID);
        }

        // Check session.redirectTo
        if (!pendingSub && req.session.redirectTo) {
          console.log('Using session.redirectTo:', req.session.redirectTo);
          redirectTo = req.session.redirectTo;
        } else if (!pendingSub) {
          console.log('No session.redirectTo found');
        }

        // Check creatorParam
        if (!pendingSub && !req.session.redirectTo && creatorParam) {
          console.log('Using creatorParam:', creatorParam);
          const creatorUser = await User.findOne({ username: creatorParam });
          if (creatorUser) {
            redirectTo = `/profile/${encodeURIComponent(creatorParam)}`;
          } else {
            console.log('Invalid creator:', creatorParam);
          }
        } else if (!pendingSub && !req.session.redirectTo) {
          console.log('No creatorParam used');
        }

        // Check req.query.creator
        if (!pendingSub && !req.session.redirectTo && !creatorParam && req.query.creator) {
          console.log('Using req.query.creator:', req.query.creator);
          const creatorUser = await User.findOne({ username: req.query.creator });
          if (creatorUser) {
            redirectTo = `/profile/${encodeURIComponent(req.query.creator)}`;
            creatorParam = req.query.creator;
          } else {
            console.log('Invalid req.query.creator:', req.query.creator);
          }
        } else if (!pendingSub && !req.session.redirectTo && !creatorParam) {
          console.log('No req.query.creator used');
        }

        // Check user.redirectAfterVerify
        if (!pendingSub && !req.session.redirectTo && !creatorParam && !req.query.creator && user.redirectAfterVerify) {
          console.log('Using user.redirectAfterVerify:', user.redirectAfterVerify);
          redirectTo = user.redirectAfterVerify;
          user.redirectAfterVerify = null;
          await user.save();
        } else if (!pendingSub && !req.session.redirectTo && !creatorParam && !req.query.creator) {
          console.log('No user.redirectAfterVerify used');
        }

        // Clear session data
        console.log('Clearing session data');
        delete req.session.redirectTo;
        delete req.session.subscriptionData;
        delete req.session.creator;
        await new Promise((resolve, reject) => {
          req.session.save(err => {
            if (err) {
              console.error('Session clear save error in /login:', err);
              reject(err);
            } else {
              console.log('Session cleared in /login:', req.session);
              resolve();
            }
          });
        });

        console.log('Login successful - Redirecting to:', redirectTo, 'User:', user._id);
        return res.redirect(redirectTo);
      } catch (error) {
        console.error('Error during login processing:', error);
        return res.render('welcome', {
          errorMessage: 'Error processing login. Please try again.',
          creator: creatorParam || '',
          ref: req.body.ref || req.query.ref || ''
        });
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