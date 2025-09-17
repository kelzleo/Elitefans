const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const MongoStore = require('rate-limit-mongo');
const User = require('../models/users');
const crypto = require('crypto');
const sendEmail = require('../config/sendEmail');
const PendingSubscription = require('../models/pendingSubscription');
const SubscriptionBundle = require('../models/SubscriptionBundle');
const Notification = require('../models/notifications');
const logger = require('../logs/logger');
const { body, query, validationResult } = require('express-validator');
const { invalidateUserSessions } = require('../utilis/cloudStorage');

// MongoDB Store Configuration
const mongoStore = new MongoStore({
  uri: process.env.MONGO_URI,
  collectionName: 'rateLimits',
  expireTimeMs: 60 * 60 * 1000, // 1 hour
});

// Rate Limiters for Different Endpoints
const loginLimiter = rateLimit({
  store: mongoStore,
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Relaxed to 10 attempts per minute
  keyGenerator: (req) => {
    return req.body.fingerprint || req.query.fingerprint || req.ip;
  },
  message: 'Too many login attempts from this device, please try again soon',
});

const signupLimiter = rateLimit({
  store: mongoStore,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Relaxed to 5 attempts per hour
  keyGenerator: (req) => {
    return req.body.fingerprint || req.query.fingerprint || req.ip;
  },
  message: 'Too many accounts created from this device, please try again after an hour',
});

const forgotPasswordLimiter = rateLimit({
  store: mongoStore,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Relaxed to 5 attempts
  keyGenerator: (req) => {
    const fingerprint = req.body.fingerprint || req.query.fingerprint || req.ip;
    return fingerprint + (req.body.email ? req.body.email.toLowerCase() : '');
  },
  message: 'Too many password reset requests from this device, please try again after an hour',
});

const resetPasswordLimiter = rateLimit({
  store: mongoStore,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 15, // Relaxed to 15 attempts
  keyGenerator: (req) => {
    const fingerprint = req.body.fingerprint || req.query.fingerprint || req.ip;
    return fingerprint + req.params.token;
  },
  message: 'Too many attempts from this device, please try again after an hour',
});

const verifyLimiter = rateLimit({
  store: mongoStore,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 15, // Relaxed to 15 attempts
  keyGenerator: (req) => {
    const fingerprint = req.query.fingerprint || req.ip;
    return fingerprint + req.params.token;
  },
  message: 'Too many verification attempts from this device, please try again after an hour',
});

router.get('/', [
  query('creator')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 50 }).withMessage('Creator username must be 50 characters or less')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Creator username must be alphanumeric with underscores'),
  query('ref')
    .optional()
    .isMongoId().withMessage('Invalid referral ID')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in GET /: ' + JSON.stringify(errors.array()));
    return res.render('welcome', {
      errorMessage: errors.array().map(err => err.msg).join(', '),
      successMessage: req.flash('success'),
      creator: req.query.creator || req.session.creator || '',
      ref: req.query.ref || req.session.referralId || '',
      isWelcomePage: true,
      currentUser: null
    });
  }

  const { creator, ref } = req.query;

  if (req.user) {
    return res.redirect('/home');
  }

  if (creator) {
    req.session.redirectTo = `/profile/${encodeURIComponent(creator)}`;
    req.session.save(err => {
      if (err) {
        logger.error(`Error saving session in GET /: ${err.message}`);
      }
    });
  }

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
    ref: ref || req.session.referralId || '',
    isWelcomePage: true,
    currentUser: null
  });
});

router.post('/signup', signupLimiter, [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 3, max: 20 }).withMessage('Username must be 3–20 characters')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username must be alphanumeric with underscores'),
  body('email')
    .isEmail().withMessage('Invalid email address')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .custom((value, { req }) => {
      const hasUppercase = /[A-Z]/.test(value);
      const hasLowercase = /[a-z]/.test(value);
      const hasNumber = /[0-9]/.test(value);
      const hasSpecial = /[!@#$%^&*]/.test(value);
      const varietyCount = [hasUppercase, hasLowercase, hasNumber, hasSpecial].filter(Boolean).length;
      if (varietyCount < 3) {
        throw new Error('Password must include at least 3 of: uppercase, lowercase, number, special character');
      }
      const passwordLower = value.toLowerCase();
      const usernameLower = req.body.username.toLowerCase();
      const emailLower = req.body.email.toLowerCase();
      if (passwordLower.includes(usernameLower) || passwordLower.includes(emailLower)) {
        throw new Error('Password cannot contain username or email');
      }
      return true;
    }),
  body('creator')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 50 }).withMessage('Creator username must be 50 characters or less')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Creator username must be alphanumeric with underscores'),
  body('fingerprint')
    .optional()
    .isString().withMessage('Invalid fingerprint')
], async (req, res) => {
  const errors = validationResult(req);
  const { username, email, creator, fingerprint } = req.body;
  const queryCreator = req.query.creator;
  const sessionCreator = req.session.creator;
  const ref = req.query.ref || req.body.ref || req.session.referralId;

  if (!errors.isEmpty()) {
    logger.warn('Validation errors in POST /signup: ' + JSON.stringify(errors.array()));
    return res.render('signup', {
      errorMessage: errors.array().map(err => err.msg).join(', '),
      ref: ref || '',
      creator: creator || queryCreator || sessionCreator || '',
      fingerprint: fingerprint || req.query.fingerprint || ''
    });
  }

  try {
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.render('signup', {
        errorMessage: 'Email or username already exists',
        ref: ref || '',
        creator: creator || queryCreator || sessionCreator || '',
        fingerprint: fingerprint || req.query.fingerprint || ''
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

    const hashedPassword = await bcrypt.hash(req.body.password, 10);
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

    const verificationLink = `https://onlyaccess.onrender.com/verify/${verificationToken}${creatorParam ? `?creator=${encodeURIComponent(creatorParam)}` : ''}${ref ? `${creatorParam ? '&' : '?'}ref=${encodeURIComponent(ref)}` : ''}${fingerprint ? `${creatorParam || ref ? '&' : '?'}fingerprint=${encodeURIComponent(fingerprint)}` : ''}`;
    await sendEmail(
      email,
      'Verify Your Email',
      `<p>Thank you for signing up! Please verify your email by clicking the link below:</p>
       <a href="${verificationLink}">Verify Email</a>`
    );

    res.render('welcome', {
      errorMessage: 'Check your email to verify your account.',
      creator: creatorParam || '',
      ref: ref || '',
      fingerprint: fingerprint || req.query.fingerprint || ''
    });
  } catch (error) {
    logger.error(`Error signing up user: ${error.message}`);
    res.render('signup', {
      errorMessage: 'An error occurred while signing up. Please try again.',
      ref: ref || '',
      creator: creator || queryCreator || sessionCreator || '',
      fingerprint: fingerprint || req.query.fingerprint || ''
    });
  }
});

router.get('/verify/:token', verifyLimiter, [
  query('creator')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 50 }).withMessage('Creator username must be 50 characters or less')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Creator username must be alphanumeric with underscores'),
  query('ref')
    .optional()
    .isMongoId().withMessage('Invalid referral ID'),
  query('fingerprint')
    .optional()
    .isString().withMessage('Invalid fingerprint')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in GET /verify/:token: ' + JSON.stringify(errors.array()));
    return res.render('welcome', {
      errorMessage: errors.array().map(err => err.msg).join(', '),
      creator: req.query.creator || req.session.creator || '',
      ref: req.query.ref || '',
      fingerprint: req.query.fingerprint || ''
    });
  }

  try {
    const { token } = req.params;
    const { creator, ref, fingerprint } = req.query;

    const user = await User.findOne({ verificationToken: token });
    if (!user) {
      const alreadyVerifiedUser = await User.findOne({ email: { $exists: true }, verified: true });
      if (alreadyVerifiedUser) {
        return res.render('welcome', {
          errorMessage: 'Your email is already verified. Please log in.',
          creator: creator || req.session.creator || '',
          ref: ref || '',
          fingerprint: fingerprint || ''
        });
      }
      logger.warn('Invalid or expired verification token');
      return res.render('welcome', {
        errorMessage: 'Invalid or expired verification link.',
        creator: creator || req.session.creator || '',
        ref: ref || '',
        fingerprint: fingerprint || ''
      });
    }

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

    user.verified = true;
    user.verificationToken = undefined;
    user.redirectAfterVerify = null;
    await user.save();

    const eliteFans = await User.findOne({ username: 'elitefans', role: 'creator' });
    if (!eliteFans) {
      logger.error('EliteFans account not found for auto-subscription');
    } else if (!eliteFans.freeSubscriptionEnabled) {
      logger.warn('EliteFans account has free subscription disabled');
    } else {
      const isSubscribed = user.subscriptions.some(
        (sub) =>
          sub.creatorId.toString() === eliteFans._id.toString() &&
          sub.status === 'active' &&
          sub.subscriptionExpiry > new Date()
      );

      if (!isSubscribed) {
        let freeBundle = await SubscriptionBundle.findOne({
          creatorId: eliteFans._id,
          isFree: true
        });
        if (!freeBundle) {
          freeBundle = new SubscriptionBundle({
            price: 0,
            currency: 'NGN',
            description: 'Free subscription to EliteFans Official content',
            creatorId: eliteFans._id,
            isFree: true
          });
          await freeBundle.save();
          logger.info(`Created free bundle for EliteFans: ${freeBundle._id}`);
        }

        user.subscriptions.push({
          creatorId: eliteFans._id,
          subscriptionBundle: freeBundle._id,
          subscribedAt: new Date(),
          subscriptionExpiry: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000),
          status: 'active'
        });
        await user.save();
        logger.info(`User ${user._id} auto-subscribed to EliteFans`);

        await Notification.create({
          user: eliteFans._id,
          message: `${user.username} just subscribed to your free plan!`,
          type: 'new_subscription',
          creatorId: user._id,
          creatorName: user.username,
          isRead: false
        });
        logger.info(`Notification created for EliteFans: New subscription by ${user.username}`);

        await eliteFans.updateSubscriberCount();
      } else {
        logger.info(`User ${user._id} already subscribed to EliteFans`);
      }
    }

    req.login(user, async (err) => {
      if (err) {
        logger.error(`Login error after verification: ${err.message}`);
        return res.render('welcome', {
          errorMessage: 'Error logging in after verification. Please try logging in manually.',
          creator: creator || req.session.creator || '',
          ref: ref || '',
          fingerprint: fingerprint || ''
        });
      }

      try {
        await User.findByIdAndUpdate(user._id, {
          isOnline: true,
          lastSeen: new Date()
        });

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
          ref: ref || '',
          fingerprint: fingerprint || ''
        });
      }
    });
  } catch (error) {
    logger.error(`Error verifying email: ${error.message}`);
    res.render('welcome', {
      errorMessage: 'An error occurred. Please try again.',
      creator: creator || req.session.creator || '',
      ref: ref || '',
      fingerprint: fingerprint || ''
    });
  }
});

router.get('/signup', (req, res) => {
  const creator = req.query.creator || req.session.creator || '';
  const fingerprint = req.query.fingerprint || '';
  res.render('signup', {
    errorMessage: '',
    ref: req.query.ref || req.session.referralId || '',
    creator: creator,
    fingerprint: fingerprint
  });
});

router.get('/logout', async (req, res, next) => {
  try {
    if (req.user) {
      const userId = req.user._id;
      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen: new Date(),
      });
      await invalidateUserSessions(userId);
    }

    req.logout(async (err) => {
      if (err) {
        logger.error(`Error during logout: ${err.message}`);
        return next(err);
      }

      req.session.destroy((err) => {
        if (err) {
          logger.error('Error destroying session on logout', err);
        }
        res.clearCookie('connect.sid', { path: '/' });
        // Redirect with flag so client can run tawk cleanup before widget re-inits
        res.redirect('/?tawk_logout=1');
      });
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
    req.session.fingerprint = req.query.fingerprint;
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

    delete req.session.redirectTo;
    delete req.session.subscriptionData;
    delete req.session.referralId;
    delete req.session.creator;
    delete req.session.fingerprint;

    res.redirect(redirectTo);
  } catch (error) {
    logger.error(`Error during Google login: ${error.message}`);
    res.redirect('/home');
  }
});

router.post('/login', [
  body('usernameOrEmail')
    .trim()
    .notEmpty().withMessage('Username or email is required'),
  body('creator')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 50 }).withMessage('Creator username must be 50 characters or less')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Creator username must be alphanumeric with underscores')
], (req, res, next) => {
  const errors = validationResult(req);
  const { usernameOrEmail, creator } = req.body;
  const queryCreator = req.query.creator;
  const sessionCreator = req.session.creator;

  if (!errors.isEmpty()) {
    logger.warn('Validation errors in POST /login: ' + JSON.stringify(errors.array()));
    return res.render('welcome', {
      errorMessage: errors.array().map(err => err.msg).join(', '),
      creator: creator || queryCreator || sessionCreator || '',
      ref: req.body.ref || req.query.ref || ''
    });
  }

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

router.post('/change-password', [
  body('currentPassword')
    .notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
    .custom((value, { req }) => {
      const hasUppercase = /[A-Z]/.test(value);
      const hasLowercase = /[a-z]/.test(value);
      const hasNumber = /[0-9]/.test(value);
      const hasSpecial = /[!@#$%^&*]/.test(value);
      const varietyCount = [hasUppercase, hasLowercase, hasNumber, hasSpecial].filter(Boolean).length;
      if (varietyCount < 3) {
        throw new Error('Password must include at least 3 of: uppercase, lowercase, number, special character');
      }
      if (value === req.body.currentPassword) {
        throw new Error('New password cannot be the same as current password');
      }
      return true;
    }),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Passwords do not match');
      }
      return true;
    }),
  body('fingerprint')
    .optional()
    .isString().withMessage('Invalid fingerprint')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in POST /change-password: ' + JSON.stringify(errors.array()));
    return res.render('change-password', {
      errorMessage: errors.array().map(err => err.msg).join(', '),
      successMessage: ''
    });
  }

  if (!req.user) {
    return res.redirect('/');
  }

  const { currentPassword, newPassword } = req.body;

  try {
    const user = await User.findById(req.user._id);

    if (user.googleId && !user.password) {
      return res.render('change-password', {
        errorMessage: 'Cannot change password for Google accounts.',
        successMessage: ''
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.render('change-password', {
        errorMessage: 'Current password is incorrect.',
        successMessage: ''
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.render('change-password', {
      errorMessage: '',
      successMessage: 'Password changed successfully!'
    });
  } catch (error) {
    logger.error(`Error changing password: ${error.message}`);
    res.render('change-password', {
      errorMessage: 'An error occurred. Please try again.',
      successMessage: ''
    });
  }
});

router.get('/forgot-password', (req, res) => {
  res.render('forgot-password', {
    errorMessage: '',
    successMessage: '',
    creator: req.query.creator || '',
    ref: req.query.ref || '',
    fingerprint: req.query.fingerprint || ''
  });
});

router.post('/forgot-password', forgotPasswordLimiter, [
  body('email')
    .isEmail().withMessage('Invalid email address')
    .normalizeEmail(),
  body('fingerprint')
    .optional()
    .isString().withMessage('Invalid fingerprint')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in POST /forgot-password: ' + JSON.stringify(errors.array()));
    return res.render('forgot-password', {
      errorMessage: errors.array().map(err => err.msg).join(', '),
      successMessage: '',
      creator: req.body.creator || req.query.creator || '',
      ref: req.body.ref || req.query.ref || '',
      fingerprint: req.body.fingerprint || req.query.fingerprint || ''
    });
  }

  try {
    const { email, fingerprint } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      logger.warn('No account found for forgot-password request');
      return res.render('forgot-password', {
        errorMessage: 'No account with that email address exists.',
        successMessage: '',
        creator: req.body.creator || req.query.creator || '',
        ref: req.body.ref || req.query.ref || '',
        fingerprint: fingerprint || req.query.fingerprint || ''
      });
    }

    if (user.googleId && !user.password) {
      return res.render('forgot-password', {
        errorMessage: 'Cannot reset password for Google accounts.',
        successMessage: '',
        creator: req.body.creator || req.query.creator || '',
        ref: req.body.ref || req.query.ref || '',
        fingerprint: fingerprint || req.query.fingerprint || ''
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const resetLink = `https://onlyaccess.onrender.com/reset-password/${resetToken}${fingerprint ? `?fingerprint=${encodeURIComponent(fingerprint)}` : ''}`;
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
        creator: req.body.creator || req.query.creator || '',
        ref: req.body.ref || req.query.ref || '',
        fingerprint: fingerprint || req.query.fingerprint || ''
      });
    } catch (emailError) {
      logger.error(`Failed to send reset email: ${emailError.message}`);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      res.render('forgot-password', {
        errorMessage: 'Failed to send reset email. Please try again later.',
        successMessage: '',
        creator: req.body.creator || req.query.creator || '',
        ref: req.body.ref || req.query.ref || '',
        fingerprint: fingerprint || req.query.fingerprint || ''
      });
    }
  } catch (error) {
    logger.error(`Error in forgot password: ${error.message}`);
    res.render('forgot-password', {
      errorMessage: 'An error occurred. Please try again.',
      successMessage: '',
      creator: req.body.creator || req.query.creator || '',
      ref: req.body.ref || req.query.ref || '',
      fingerprint: req.body.fingerprint || req.query.fingerprint || ''
    });
  }
});

router.get('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const fingerprint = req.query.fingerprint || '';
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      logger.warn('Invalid or expired password reset token');
      return res.render('welcome', {
        errorMessage: 'Password reset link is invalid or has expired.',
        creator: req.query.creator || '',
        ref: req.query.ref || '',
        fingerprint: fingerprint
      });
    }

    res.render('reset-password', {
      token,
      errorMessage: '',
      successMessage: '',
      fingerprint: fingerprint
    });
  } catch (error) {
    logger.error(`Error rendering reset password form: ${error.message}`);
    res.render('welcome', {
      errorMessage: 'An error occurred. Please try again.',
      creator: req.query.creator || '',
      ref: req.query.ref || '',
      fingerprint: req.query.fingerprint || ''
    });
  }
});

router.post('/reset-password/:token', resetPasswordLimiter, [
  body('newPassword')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .custom((value) => {
      const hasUppercase = /[A-Z]/.test(value);
      const hasLowercase = /[a-z]/.test(value);
      const hasNumber = /[0-9]/.test(value);
      const hasSpecial = /[!@#$%^&*]/.test(value);
      const varietyCount = [hasUppercase, hasLowercase, hasNumber, hasSpecial].filter(Boolean).length;
      if (varietyCount < 3) {
        throw new Error('Password must include at least 3 of: uppercase, lowercase, number, special character');
      }
      return true;
    }),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Passwords do not match');
      }
      return true;
    }),
  body('fingerprint')
    .optional()
    .isString().withMessage('Invalid fingerprint')
], async (req, res) => {
  const errors = validationResult(req);
  const { token } = req.params;
  const { fingerprint } = req.body;

  if (!errors.isEmpty()) {
    logger.warn('Validation errors in POST /reset-password/:token: ' + JSON.stringify(errors.array()));
    return res.render('reset-password', {
      token,
      errorMessage: errors.array().map(err => err.msg).join(', '),
      successMessage: '',
      fingerprint: fingerprint || req.query.fingerprint || ''
    });
  }

  try {
    const { newPassword } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      logger.warn('Invalid or expired password reset token');
      return res.render('welcome', {
        errorMessage: 'Password reset link is invalid or has expired.',
        creator: req.query.creator || '',
        ref: req.query.ref || '',
        fingerprint: fingerprint || req.query.fingerprint || ''
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.render('welcome', {
      errorMessage: 'Your password has been reset successfully. Please log in.',
      creator: req.query.creator || '',
      ref: req.query.ref || '',
      fingerprint: fingerprint || req.query.fingerprint || ''
    });
  } catch (error) {
    logger.error(`Error resetting password: ${error.message}`);
    res.render('reset-password', {
      token: req.params.token,
      errorMessage: 'An error occurred. Please try again.',
      successMessage: '',
      fingerprint: fingerprint || req.query.fingerprint || ''
    });
  }
});

module.exports = router;