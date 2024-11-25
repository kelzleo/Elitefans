const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: function () { return !this.googleId; },
        unique: true,
        sparse: true,
    },
    email: {
        type: String,
        required: function () { return !this.googleId; },
        unique: true,
        sparse: true,
        lowercase: true,
    },
    password: {
        type: String,
        validate: {
            validator: function (value) {
                if (this.googleId) return true;
                return value && value.length >= 6;
            },
            message: 'Password must be at least 6 characters long.'
        }
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true,
    },
    verified: {
        type: Boolean,
        default: false, // Default is not verified
    },
    verificationToken: {
        type: String,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('User', userSchema);
