const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcrypt');
const keys = require('./keys');
const User = require('../models/users');
require('dotenv').config();

passport.serializeUser((user, done) => {
  console.log('Serializing user:', user._id, user.username);
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    if (!user) {
      console.error('Deserialize - No user found for ID:', id);
      return done(null, false);
    }
    console.log('Deserialized user:', user._id, user.username);
    done(null, user);
  } catch (err) {
    console.error('Deserialize - Error:', err);
    done(err, null);
  }
});

passport.use(
  new GoogleStrategy(
    {
      clientID: keys.google.clientID,
      clientSecret: keys.google.clientSecret,
      callbackURL: `${process.env.BASE_URL}/google/callback`,
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        console.log('Google Strategy - Profile:', profile.id, 'Email:', profile.emails?.[0]?.value);
        const email = profile.emails?.[0]?.value || null;
        const { creator, ref } = req.query;

        if (!email) {
          console.error('Google Strategy - No email in profile');
          return done(null, false, { message: 'No email found in Google profile' });
        }

        let user = await User.findOne({ googleId: profile.id });
        if (user) {
          console.log('Google Strategy - Existing user:', user._id, user.username);
          user.lastSeen = new Date();
          user.isOnline = true;
          if (creator) {
            user.redirectAfterVerify = `/profile/${encodeURIComponent(creator)}`;
            console.log('Google Strategy - Set redirectAfterVerify:', user.redirectAfterVerify);
          }
          await user.save();
          return done(null, user);
        }

        user = await User.findOne({ email });
        if (user) {
          console.log('Google Strategy - Linking Google ID to existing user:', user._id);
          user.googleId = profile.id;
          user.verified = true;
          user.lastSeen = new Date();
          user.isOnline = true;
          if (creator) {
            user.redirectAfterVerify = `/profile/${encodeURIComponent(creator)}`;
            console.log('Google Strategy - Set redirectAfterVerify:', user.redirectAfterVerify);
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
          console.log('Google Strategy - Referral ID:', req.session.referralId);
          const referrer = await User.findById(req.session.referralId);
          if (referrer && referrer.role === 'creator') {
            user.referredBy = referrer._id;
            console.log('Google Strategy - Set referredBy:', referrer._id);
          } else {
            console.log('Google Strategy - Invalid referrer');
          }
        }

        if (creator) {
          user.redirectAfterVerify = `/profile/${encodeURIComponent(creator)}`;
          console.log('Google Strategy - Set redirectAfterVerify for new user:', user.redirectAfterVerify);
        }

        await user.save();
        console.log('Google Strategy - New user saved:', user._id, user.username);
        return done(null, user);
      } catch (err) {
        console.error('Google Strategy - Error:', err);
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
        console.log('Local Strategy - Attempting login:', usernameOrEmail);
        const user = await User.findOne({
          $or: [{ email: usernameOrEmail }, { username: usernameOrEmail }],
        });

        if (!user) {
          console.log('Local Strategy - No user found:', usernameOrEmail);
          return done(null, false, { message: 'Incorrect username or email.' });
        }

        if (!user.verified) {
          console.log('Local Strategy - User not verified:', user._id, user.username);
          return done(null, false, { message: 'Please verify your email to log in.' });
        }

        if (user.googleId && !user.password) {
          console.log('Local Strategy - Google-only user:', user._id, user.username);
          return done(null, false, { message: 'Please use Google to log in.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          console.log('Local Strategy - Incorrect password:', user._id, user.username);
          return done(null, false, { message: 'Incorrect password.' });
        }

        console.log('Local Strategy - Login successful:', user._id, user.username);
        return done(null, user);
      } catch (err) {
        console.error('Local Strategy - Error:', err);
        return done(err);
      }
    }
  )
);

module.exports = passport;