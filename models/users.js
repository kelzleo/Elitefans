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
    default: '/uploads/default-cover.jpg'
  },
  uploadedContent: [
    {
      filename: { type: String, required: true },
      type: { type: String, enum: ['image', 'video'], required: true },
      writeUp: { type: String },
      special: { type: Boolean, default: false },
      unlockPrice: { type: Number }
    },
  ],
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
      message: { type: String }, 
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
  totalEarnings: {
    type: Number,
    default: 0
  },
  banks: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
      bankName: { type: String, required: true },
      accountNumber: { type: String, required: true },
    }
  ],
  bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  creatorSince: { type: Date, default: null },
});

// Pre-save middleware to update subscriberCount based on active, non-expired subscriptions

userSchema.pre('save', function (next) {
  const now = new Date();
  if (this.isModified('subscriptions')) {
    // Only update the user's own subscription statuses
    this.subscriptions.forEach(sub => {
      if (sub.status === 'active' && sub.subscriptionExpiry && sub.subscriptionExpiry < now) {
        sub.status = 'expired';
      }
    });
  }
  next();
});

// Method to calculate subscriberCount based on users subscribed to this creator
userSchema.methods.updateSubscriberCount = async function () {
  const now = new Date();
  // Count users who have an active subscription to this creator
  const subscriberCount = await mongoose.model('User').countDocuments({
    'subscriptions': {
      $elemMatch: {
        creatorId: this._id,
        status: 'active',
        subscriptionExpiry: { $gt: now }
      }
    }
  });
  this.subscriberCount = subscriberCount;
  await this.save();
  return subscriberCount;
};

// Optional: Method to check and update expired subscriptions for this user
userSchema.methods.checkExpiredSubscriptions = async function () {
  const now = new Date();
  let changed = false;
  this.subscriptions.forEach(sub => {
    if (sub.status === 'active' && sub.subscriptionExpiry && sub.subscriptionExpiry < now) {
      sub.status = 'expired';
      changed = true;
    }
  });
  if (changed) await this.save();
};
module.exports = mongoose.model('User', userSchema);