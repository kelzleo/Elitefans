const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt'); // Import bcrypt for password comparison
const keys = require('./keys');
const User = require('../models/users'); // Ensure correct path to the User model

// Serialize the user
passport.serializeUser((user, done) => {
    done(null, user.id);
});

// Deserialize the user
passport.deserializeUser((id, done) => {
    User.findById(id)
        .then((user) => {
            done(null, user); // Pass the entire user object
        })
        .catch((err) => {
            console.error('Error deserializing user:', err);
            done(err, null); // Handle errors during deserialization
        });
});

// Google Strategy for authentication
passport.use(
    new GoogleStrategy(
        {
            callbackURL: '/google/redirect',
            clientID: keys.google.clientID,
            clientSecret: keys.google.clientSecret,
            scope: ['profile', 'email'],
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails?.[0]?.value || null;

                if (!email) {
                    console.error('No email found in Google profile');
                    return done(null, false, { message: 'No email found' });
                }

                // Check if the user already exists by Google ID
                let currentUser = await User.findOne({ googleId: profile.id });
                if (currentUser) {
                    return done(null, currentUser);
                }

                // Check if the user exists by email
                currentUser = await User.findOne({ email });
                if (currentUser) {
                    currentUser.googleId = profile.id;
                    currentUser.verified = true; // Automatically verify Google users
                    await currentUser.save();
                    return done(null, currentUser);
                }

                // Create a new user if none exists
                const username = profile.displayName.replace(/\s+/g, '').toLowerCase();
                const newUser = new User({
                    username,
                    googleId: profile.id,
                    email,
                    verified: true, // Automatically verify Google users
                });

                await newUser.save();
                return done(null, newUser);
            } catch (err) {
                console.error('Error during Google authentication:', err);
                return done(err, null);
            }
        }
    )
);


// Local Strategy for email/password authentication
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
