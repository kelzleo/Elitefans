const mongoose = require('mongoose');
const path = require('path');

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
    role: {
        type: String,
        enum: ['user', 'creator', 'admin'], // Define allowed roles
        default: 'user', // Default role
    },
    requestToBeCreator: {
        type: Boolean,
        default: false, // Default is no request
    },
    profileName: {
        type: String,
    },
    bio: {
        type: String,
    },
    profilePicture: {
        type: String,
        default: 'a1.png'
    },
    uploadedContent: [
        {
            filename: { type: String, required: true }, // Google Cloud Storage URL
            type: { type: String, enum: ['image', 'video'], required: true },
            writeUp: { type: String },
        },
    ],

    subscriptions: [
        {
            creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Reference to the creator's user ID
            subscriptionBundle: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'SubscriptionBundle', // Refers to the subscription bundle model
                required: true,
            },
            subscribedAt: { type: Date, default: Date.now },
            subscriptionExpiry: { type: Date }, // Subscription expiration date
            status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active' }, // Subscription status
        },
    ],
    pendingTransactions: [
        {
          tx_ref: { type: String, required: true },
          creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
          bundleId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionBundle', required: true },
          amount: { type: Number, required: true },
          status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
          createdAt: { type: Date, default: Date.now },
        }
      ],
    subscriberCount: {
        type: Number,
        default: 0, // Tracks the number of users subscribed to this creator
    },
});


// Pre-save middleware to handle subscriber count updates if needed
userSchema.pre('save', function (next) {
    if (this.isModified('subscriptions')) {
        this.subscriberCount = this.subscriptions.length;
    }
    next();
  

});

module.exports = mongoose.model('User', userSchema);
