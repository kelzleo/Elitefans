const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcrypt');
const User = require('../models/users');
const crypto = require('crypto');
const sendEmail = require('../config/sendEmail');
const PendingSubscription = require('../models/pendingSubscription');
const logger = require('../logs/logger'); // Import Winston logger

router.get('/', async (req, res) => {
  const { creator, ref } = req.query;

  // Store creator in session.redirectTo if provided
  if (creator) {
    req.session.redirectTo = `/profile/${encodeURIComponent(creator)}`;
    req.session.save(err => {
      if (err) {
        logger.error(`Error saving session in GET /: ${err.message}`);
      }
    });
  }

  // Store referral ID if provided
  if (ref) {
    const referrer = await User.findOne({ _id: ref });
    if (referrer && referrer.role === 'creator') {
      req.session.referralId = ref;
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
  const { username, email, password, creator } = req.body;
  const queryCreator = req.query.creator;
  const sessionCreator = req.session.creator;
  const ref = req.query.ref || req.body.ref || req.session.referralId;

  try {
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
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
      const referrer = await User.findById(ref);
      if (referrer && referrer.role === 'creator') {
        newUser.referredBy = referrer._id;
      } else {
        logger.warn('Invalid or non-creator referral ID provided');
      }
    }

    if (redirectUrl) {
      req.session.redirectTo = redirectUrl;
      req.session.creator = creatorParam;
      await new Promise((resolve, reject) => {
        req.session.save(err => {
          if (err) {
            logger.error(`Session save error in /signup: ${err.message}`);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    await newUser.save();
    delete req.session.referralId;

    const verificationLink = `https://onlyaccess.onrender.com/verify/${verificationToken}${creatorParam ? `?creator=${encodeURIComponent(creatorParam)}` : ''}${ref ? `${creatorParam ? '&' : '?'}ref=${encodeURIComponent(ref)}` : ''}`;
    await sendEmail(
      email,
      'Verify Your Email',
      `<p>Thank you for signing up! Please verify your email by clicking the link below:</p>
       <a href="${verificationLink}">Verify Email</a>`
    );

    res.render('welcome', {
      errorMessage: 'Check your email to verify your account.',
      creator: creatorParam || '',
      ref: ref || ''
    });
  } catch (error) {
    logger.error(`Error signing up user: ${error.message}`);
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

    const user = await User.findOne({ verificationToken: token });
    if (!user) {
      const alreadyVerifiedUser = await User.findOne({ email: { $exists: true }, verified: true });
      if (alreadyVerifiedUser) {
        return res.render('welcome', {
          errorMessage: 'Your email is already verified. Please log in.',
          creator: creator || req.session.creator || '',
          ref: ref || ''
        });
      }
      logger.warn('Invalid or expired verification token');
      return res.render('welcome', {
        errorMessage: 'Invalid or expired verification link.',
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
      }
    } else if (user.redirectAfterVerify) {
      redirectTo = user.redirectAfterVerify;
    } else if (req.session.redirectTo) {
      redirectTo = req.session.redirectTo;
    } else {
      const pendingSub = await PendingSubscription.findOne({ sessionId: req.sessionID });
      if (pendingSub) {
        const creatorUser = await User.findById(pendingSub.creatorId);
        if (creatorUser) {
          redirectTo = `/profile/${encodeURIComponent(pendingSub.creatorUsername)}`;
        }
      }
    }

    // Update user
    user.verified = true;
    user.verificationToken = undefined;
    user.redirectAfterVerify = null;
    await user.save();

    // Log in the user
    req.login(user, async (err) => {
      if (err) {
        logger.error(`Login error after verification: ${err.message}`);
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
              logger.error(`Session save error in /verify/:token: ${err.message}`);
              reject(err);
            } else {
              resolve();
            }
          });
        });

        return res.redirect(redirectTo);
      } catch (error) {
        logger.error(`Error during post-verification login: ${error.message}`);
        return res.render('welcome', {
          errorMessage: 'Error processing login after verification. Please try logging in manually.',
          creator: creator || req.session.creator || '',
          ref: ref || ''
        });
      }
    });
  } catch (error) {
    logger.error(`Error verifying email: ${error.message}`);
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
        logger.error(`Error during logout: ${err.message}`);
        return next(err);
      }
      res.redirect('/');
    });
  } catch (error) {
    logger.error(`Error during logout: ${error.message}`);
    res.redirect('/');
  }
});

router.get('/google', (req, res, next) => {
  if (req.query.ref) {
    req.session.referralId = req.query.ref;
  }
  if (req.query.creator) {
    req.session.creator = req.query.creator;
    req.session.redirectTo = `/profile/${req.query.creator}`;
    req.session.save(err => {
      if (err) {
        logger.error(`Google auth session save error: ${err.message}`);
      }
    });
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/redirect', passport.authenticate('google'), async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      isOnline: true,
      lastSeen: new Date(),
    });

    const creator = req.query.creator || req.session.creator;
    let redirectTo = '/home';
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
              logger.error(`Session save error in /google/redirect: ${err.message}`);
              reject(err);
            } else {
              resolve();
            }
          });
        });
      }
    }

    // Clear session data
    delete req.session.redirectTo;
    delete req.session.subscriptionData;
    delete req.session.referralId;
    delete req.session.creator;

    res.redirect(redirectTo);
  } catch (error) {
    logger.error(`Error during Google login: ${error.message}`);
    res.redirect('/home');
  }
});

router.post('/login', (req, res, next) => {
  const { usernameOrEmail, creator } = req.body;
  const queryCreator = req.query.creator;
  const sessionCreator = req.session.creator;

  passport.authenticate('local', async (err, user, info) => {
    if (err) {
      logger.error(`Passport authentication error: ${err.message}`);
      return next(err);
    }

    if (!user) {
      return res.render('welcome', {
        errorMessage: info.message || 'Invalid username/email or password',
        creator: creator || queryCreator || sessionCreator || '',
        ref: req.body.ref || req.query.ref || ''
      });
    }

    req.logIn(user, async (err) => {
      if (err) {
        logger.error(`req.logIn error: ${err.message}`);
        return next(err);
      }

      try {
        await User.findByIdAndUpdate(user._id, {
          isOnline: true,
          lastSeen: new Date(),
        });

        // Determine redirect URL
        let redirectTo = '/home';
        let creatorParam = creator || queryCreator || sessionCreator;

        const pendingSub = await PendingSubscription.findOne({ sessionId: req.sessionID });
        if (pendingSub) {
          redirectTo = `/profile/${encodeURIComponent(pendingSub.creatorUsername)}`;
          creatorParam = pendingSub.creatorUsername;
          await PendingSubscription.deleteOne({ sessionId: req.sessionID });
        } else if (req.session.redirectTo) {
          redirectTo = req.session.redirectTo;
        } else if (creatorParam) {
          const creatorUser = await User.findOne({ username: creatorParam });
          if (creatorUser) {
            redirectTo = `/profile/${encodeURIComponent(creatorParam)}`;
          }
        } else if (req.query.creator) {
          const creatorUser = await User.findOne({ username: req.query.creator });
          if (creatorUser) {
            redirectTo = `/profile/${encodeURIComponent(req.query.creator)}`;
            creatorParam = req.query.creator;
          }
        } else if (user.redirectAfterVerify) {
          redirectTo = user.redirectAfterVerify;
          user.redirectAfterVerify = null;
          await user.save();
        }

        // Clear session data
        delete req.session.redirectTo;
        delete req.session.subscriptionData;
        delete req.session.creator;
        await new Promise((resolve, reject) => {
          req.session.save(err => {
            if (err) {
              logger.error(`Session clear save error in /login: ${err.message}`);
              reject(err);
            } else {
              resolve();
            }
          });
        });

        return res.redirect(redirectTo);
      } catch (error) {
        logger.error(`Error during login processing: ${error.message}`);
        return res.render('welcome', {
          errorMessage: 'Error processing login. Please try again.',
          creator: creatorParam || '',
          ref: req.body.ref || req.query.ref || ''
        });
      }
    });
  })(req, res, next);
});

router.get('/change-password', (req, res) => {
  if (!req.user) {
    return res.redirect('/');
  }
  res.render('change-password', { errorMessage: '', successMessage: '' });
});

router.post('/change-password', async (req, res) => {
  if (!req.user) {
    return res.redirect('/');
  }

  const { currentPassword, newPassword, confirmPassword } = req.body;

  try {
    const user = await User.findById(req.user._id);

    if (user.googleId && !user.password) {
      return res.render('change-password', {
        errorMessage: 'Cannot change password for Google accounts.',
        successMessage: '',
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.render('change-password', {
        errorMessage: 'Current password is incorrect.',
        successMessage: '',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.render('change-password', {
        errorMessage: 'New passwords do not match.',
        successMessage: '',
      });
    }

    if (newPassword.length < 6) {
      return res.render('change-password', {
        errorMessage: 'New password must be at least 6 characters long.',
        successMessage: '',
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.render('change-password', {
      errorMessage: '',
      successMessage: 'Password changed successfully!',
    });
  } catch (error) {
    logger.error(`Error changing password: ${error.message}`);
    res.render('change-password', {
      errorMessage: 'An error occurred. Please try again.',
      successMessage: '',
    });
  }
});

router.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { errorMessage: '', successMessage: '' });
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      logger.warn('No account found for forgot-password request');
      return res.render('forgot-password', {
        errorMessage: 'No account with that email address exists.',
        successMessage: '',
      });
    }

    if (user.googleId && !user.password) {
      return res.render('forgot-password', {
        errorMessage: 'Cannot reset password for Google accounts.',
        successMessage: '',
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const resetLink = `https://onlyaccess.onrender.com/reset-password/${resetToken}`;
    try {
      await sendEmail(
        email,
        'Password Reset Request',
        `<p>You requested a password reset. Click the link below to reset your password:</p>
         <a href="${resetLink}">Reset Password</a>
         <p>This link will expire in 1 hour.</p>`
      );
      res.render('forgot-password', {
        errorMessage: '',
        successMessage: 'A password reset link has been sent to your email. It may take a few minutes to arrive.',
      });
    } catch (emailError) {
      logger.error(`Failed to send reset email: ${emailError.message}`);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      res.render('forgot-password', {
        errorMessage: 'Failed to send reset email. Please try again later.',
        successMessage: '',
      });
    }
  } catch (error) {
    logger.error(`Error in forgot password: ${error.message}`);
    res.render('forgot-password', {
      errorMessage: 'An error occurred. Please try again.',
      successMessage: '',
    });
  }
});

router.get('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      logger.warn('Invalid or expired password reset token');
      return res.render('welcome', {
        errorMessage: 'Password reset link is invalid or has expired.',
      });
    }

    res.render('reset-password', { token, errorMessage: '', successMessage: '' });
  } catch (error) {
    logger.error(`Error rendering reset password form: ${error.message}`);
    res.render('welcome', {
      errorMessage: 'An error occurred. Please try again.',
    });
  }
});

router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword, confirmPassword } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      logger.warn('Invalid or expired password reset token');
      return res.render('welcome', {
        errorMessage: 'Password reset link is invalid or has expired.',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.render('reset-password', {
        token,
        errorMessage: 'Passwords do not match.',
        successMessage: '',
      });
    }

    if (newPassword.length < 6) {
      return res.render('reset-password', {
        token,
        errorMessage: 'Password must be at least 6 characters long.',
        successMessage: '',
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.render('welcome', {
      errorMessage: 'Your password has been reset successfully. Please log in.',
    });
  } catch (error) {
    logger.error(`Error resetting password: ${error.message}`);
    res.render('reset-password', {
      token: req.params.token,
      errorMessage: 'An error occurred. Please try again.',
      successMessage: '',
    });
  }
});

module.exports = router;