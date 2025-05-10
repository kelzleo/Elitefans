const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcrypt');
const keys = require('./keys');
const User = require('../models/users');
const logger = require('../logs/logger'); // Import Winston logger
require('dotenv').config();

passport.serializeUser((user, done) => {
  done(null, user.id);
});

// passport-setup.js
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).lean();
    if (!user) {
      logger.warn(`Deserialize - No user found for ID: ${id}`);
      return done(null, false);
    }
    done(null, user);
  } catch (err) {
    logger.error(`Deserialize - Error for ID ${id}: ${err.message}`);
    done(err, null);
  }
});

passport.use(
  new GoogleStrategy(
    {
      clientID: keys.google.clientID,
      clientSecret: keys.google.clientSecret,
      callbackURL: `${process.env.BASE_URL}/google/redirect`,

      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || null;
        const { creator, ref } = req.query;

        if (!email) {
          logger.warn('Google Strategy - No email in profile');
          return done(null, false, { message: 'No email found in Google profile' });
        }

        let user = await User.findOne({ googleId: profile.id });
        if (user) {
          user.lastSeen = new Date();
          user.isOnline = true;
          if (creator) {
            user.redirectAfterVerify = `/profile/${encodeURIComponent(creator)}`;
            req.session.redirectTo = `/profile/${encodeURIComponent(creator)}`;
          }
          await user.save();
          return done(null, user);
        }

        user = await User.findOne({ email });
        if (user) {
          user.googleId = profile.id;
          user.verified = true;
          user.lastSeen = new Date();
          user.isOnline = true;
          if (creator) {
            user.redirectAfterVerify = `/profile/${encodeURIComponent(creator)}`;
            req.session.redirectTo = `/profile/${encodeURIComponent(creator)}`;
          }
          await user.save();
          return done(null, user);
        }

        const username = profile.displayName.replace(/\s+/g, '').toLowerCase();
        user = new User({
          username,
          googleId: profile.id,
          email,
          verified: true,
          isOnline: true,
          lastSeen: new Date(),
        });

        if (req.session.referralId) {
          const referrer = await User.findById(req.session.referralId);
          if (referrer && referrer.role === 'creator') {
            user.referredBy = referrer._id;
          } else {
            logger.warn('Google Strategy - Invalid referrer');
          }
        }

        if (creator) {
          user.redirectAfterVerify = `/profile/${encodeURIComponent(creator)}`;
          req.session.redirectTo = `/profile/${encodeURIComponent(creator)}`;
        }

        await user.save();
        return done(null, user);
      } catch (err) {
        logger.error(`Google Strategy - Error: ${err.message}`);
        return done(err, null);
      }
    }
  )
);

passport.use(
  new LocalStrategy(
    {
      usernameField: 'usernameOrEmail',
      passwordField: 'password',
    },
    async (usernameOrEmail, password, done) => {
      try {
        const user = await User.findOne({
          $or: [{ email: usernameOrEmail }, { username: usernameOrEmail }],
        });

        if (!user) {
          logger.warn('Local Strategy - No user found');
          return done(null, false, { message: 'Incorrect username or email.' });
        }

        if (!user.verified) {
          logger.warn('Local Strategy - User not verified');
          return done(null, false, { message: 'Please verify your email to log in.' });
        }

        if (user.googleId && !user.password) {
          logger.warn('Local Strategy - Google-only user');
          return done(null, false, { message: 'Please use Google to log in.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          logger.warn('Local Strategy - Incorrect password');
          return done(null, false, { message: 'Incorrect password.' });
        }

        return done(null, user);
      } catch (err) {
        logger.error(`Local Strategy - Error: ${err.message}`);
        return done(err);
      }
    }
  )
);

module.exports = passport;