// models/users.js
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
    default: false,
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
    enum: ['user', 'creator', 'admin'],
    default: 'user',
  },
  requestToBeCreator: {
    type: Boolean,
    default: false,
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
  coverPhoto: {
    type: String,
    default: '/uploads/default-cover.jpg' // You can set a default image path
  },
  uploadedContent: [
    {
      filename: { type: String, required: true },
      type: { type: String, enum: ['image', 'video'], required: true },
      writeUp: { type: String },
      // NEW FIELDS for special content
      special: { type: Boolean, default: false },
      unlockPrice: { type: Number }
    },
  ],
  // Track special content that a subscriber has unlocked
  purchasedContent: [
    {
      contentId: { type: mongoose.Schema.Types.ObjectId },
      purchasedAt: { type: Date, default: Date.now },
      amount: { type: Number }
    }
  ],
  subscriptions: [
    {
      creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      subscriptionBundle: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SubscriptionBundle',
        required: true,
      },
      subscribedAt: { type: Date, default: Date.now },
      subscriptionExpiry: { type: Date },
      status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active' },
    },
  ],
  pendingTransactions: [
    {
      tx_ref: { type: String, required: true },
      creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      bundleId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionBundle'},
      postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
      amount: { type: Number, required: true },
      status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
      createdAt: { type: Date, default: Date.now },
      type: { type: String, enum: ['special', 'subscription', 'tip'], required: true }
    }
  ],

  imagesCount: { type: Number, default: 0 },
  videosCount: { type: Number, default: 0 },
  totalLikes: { type: Number, default: 0 },

 
  subscriberCount: {
    type: Number,
    default: 0,
  },

  
 
  // Track how much the creator has earned from subs + special content
  totalEarnings: {
    type: Number,
    default: 0
  },
  banks: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
      bankName: { type: String, required: true },
      accountNumber: { type: String, required: true },
      // optionally store the bank code if you want to skip mapping:
      // bankCode: { type: String, default: '' }
    }
  ],
});

// Pre-save middleware to handle subscriber count updates if needed
userSchema.pre('save', function (next) {
  // Whenever subscriptions array is modified, recalc only active ones
  if (this.isModified('subscriptions')) {
    this.subscriberCount = this.subscriptions.filter(
      (sub) => sub.status === 'active'
    ).length;
  }
  next();
});


module.exports = mongoose.model('User', userSchema);
