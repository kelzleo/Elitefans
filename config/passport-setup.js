const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const keys = require('./keys');
const User = require('../models/users');

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  User.findById(id)
    .then((user) => {
      done(null, user);
    })
    .catch((err) => {
      console.error('Error deserializing user:', err);
      done(err, null);
    });
});

passport.use(
  new GoogleStrategy(
    {
      callbackURL: '/google/redirect',
      clientID: keys.google.clientID,
      clientSecret: keys.google.clientSecret,
      scope: ['profile', 'email'],
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || null;

        if (!email) {
          console.error('No email found in Google profile');
          return done(null, false, { message: 'No email found' });
        }

        let currentUser = await User.findOne({ googleId: profile.id });
        if (currentUser) {
          return done(null, currentUser);
        }

        currentUser = await User.findOne({ email });
        if (currentUser) {
          currentUser.googleId = profile.id;
          currentUser.verified = true;
          await currentUser.save();
          return done(null, currentUser);
        }

        const username = profile.displayName.replace(/\s+/g, '').toLowerCase();
        const newUser = new User({
          username,
          googleId: profile.id,
          email,
          verified: true,
          isOnline: true,
          lastSeen: new Date(),
        });

        if (req.session.referralId) {
          console.log('Referral ID from session:', req.session.referralId);
          const referrer = await User.findById(req.session.referralId);
          if (referrer && referrer.role === 'creator') {
            newUser.referredBy = referrer._id;
            console.log('Setting referredBy to:', referrer._id);
          } else {
            console.log('Referrer invalid or not a creator');
          }
        } else {
          console.log('No referral ID in session');
        }

        await newUser.save();
        console.log('New Google user saved:', { id: newUser._id, referredBy: newUser.referredBy });
        return done(null, newUser);
      } catch (err) {
        console.error('Error during Google authentication:', err);
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
          return done(null, false, { message: 'Incorrect username or email.' });
        }

        if (!user.verified) {
          return done(null, false, { message: 'Please verify your email to log in.' });
        }

        if (user.googleId) {
          return done(null, user);
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return done(null, false, { message: 'Incorrect password.' });
        }

        return done(null, user);
      } catch (err) {
        console.error('Error during local authentication:', err);
        return done(err);
      }
    }
  )
);

module.exports = passport;