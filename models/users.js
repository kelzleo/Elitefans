// models/users.js
const mongoose = require('mongoose');
const path = require('path');
const logger = require('../logs/logger');

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
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  googleId: { type: String, unique: true, sparse: true },
  verified: { type: Boolean, default: false },
  verificationToken: { type: String },
  redirectAfterVerify: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  role: { type: String, enum: ['user', 'creator', 'admin'], default: 'user' },
  requestToBeCreator: { type: Boolean, default: false },
  profileName: { type: String },
  bio: { type: String },
  profilePicture:  { 
    type: String, 
    default: 'https://storage.googleapis.com/my-public-profile-pictures/profilePictures/profile%20E.png' },
    coverPhoto: {
       type: String, 
       default: 'https://storage.googleapis.com/my-public-profile-pictures/coverPhotos/cover%20E.png' },
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
      contentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
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
      bundleId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionBundle' },
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
  subscriberCount: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
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
  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false },
  freeSubscriptionEnabled: { type: Boolean, default: false },
  postCategories: [{ type: String }],
});

userSchema.pre('save', async function (next) {
  const now = new Date();
  let subscriptionsChanged = false;

  this.subscriptions.forEach((sub) => {
    if (
      sub.status === 'active' &&
      sub.subscriptionExpiry &&
      sub.subscriptionExpiry <= now // Updated to <= for immediate expiration
    ) {
      sub.status = 'expired';
      subscriptionsChanged = true;
      logger.info(`Marked subscription as expired for user ${this._id}, creator ${sub.creatorId}`);
    }
  });

  if (subscriptionsChanged && this.bookmarks.length > 0) {
    try {
      await this.removeBookmarksForExpiredSubscriptions();
      logger.info(`Cleaned bookmarks for user ${this._id} due to expired subscriptions`);
    } catch (error) {
      logger.error(`Error cleaning bookmarks in pre-save for user ${this._id}: ${error.message}`);
    }
  }

  next();
});

userSchema.methods.updatePostCounts = async function () {
  try {
    const posts = await mongoose.model('Post').find({ creator: this._id });
    this.imagesCount = posts.filter(post => post.type === 'image').length;
    this.videosCount = posts.filter(post => post.type === 'video').length;
    this.totalLikes = posts.reduce((sum, post) => sum + (post.likes ? post.likes.length : 0), 0);
    await this.save();
  } catch (error) {
    logger.error(`Error updating post counts: ${error.message}`);
  }
};

userSchema.methods.updateSubscriberCount = async function () {
  try {
    const now = new Date();
    const subscriberCount = await mongoose.model('User').countDocuments({
      subscriptions: {
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
  } catch (error) {
    logger.error(`Error updating subscriber count: ${error.message}`);
    return 0;
  }
};

userSchema.methods.checkExpiredSubscriptions = async function () {
  try {
    const now = new Date();
    let changed = false;
    this.subscriptions.forEach((sub) => {
      if (
        sub.status === 'active' &&
        sub.subscriptionExpiry &&
        sub.subscriptionExpiry <= now // Updated to <= for immediate expiration
      ) {
        sub.status = 'expired';
        changed = true;
        logger.info(`Marked subscription as expired for user ${this._id}, creator ${sub.creatorId}`);
      }
    });
    if (changed) {
      await this.save();
    }
  } catch (error) {
    logger.error(`Error checking expired subscriptions for user ${this._id}: ${error.message}`);
  }
};

userSchema.methods.removeBookmarksForExpiredSubscriptions = async function () {
  try {
    const now = new Date();
    const activeCreatorIds = this.subscriptions
      .filter(
        (sub) =>
          sub.status === 'active' &&
          (!sub.subscriptionExpiry || sub.subscriptionExpiry > now)
      )
      .map((sub) => sub.creatorId.toString());

    const updatedBookmarks = await Promise.all(
      this.bookmarks.map(async (bookmarkId) => {
        try {
          const post = await mongoose.model('Post')
            .findById(bookmarkId)
            .populate('creator', '_id');
          if (!post || !post.creator) {
            logger.warn('Removing invalid bookmark');
            return false;
          }
          const isCreatorSubscribed = activeCreatorIds.includes(
            post.creator._id.toString()
          );
          const isPurchased = this.purchasedContent.some(
            (p) => p.contentId.toString() === bookmarkId.toString()
          );
          const keepBookmark = isCreatorSubscribed || !post.special || isPurchased;
          if (!keepBookmark) {
            logger.info(`Removing bookmark ${bookmarkId} due to expired subscription or special content not purchased`);
          }
          return keepBookmark ? bookmarkId : false;
        } catch (error) {
          logger.error(`Error checking bookmark ${bookmarkId}: ${error.message}`);
          return false;
        }
      })
    );

    const validBookmarks = updatedBookmarks.filter((id) => id !== false);
    if (validBookmarks.length !== this.bookmarks.length) {
      this.bookmarks = validBookmarks;
      await this.save();
      logger.info(`Removed ${this.bookmarks.length - validBookmarks.length} invalid bookmarks for user ${this._id}`);
    }
  } catch (error) {
    logger.error(`Error removing bookmarks for expired subscriptions: ${error.message}`);
  }
};

userSchema.statics.cleanupAllUsers = async function () {
  try {
    const users = await this.find({ 'subscriptions.0': { $exists: true } });
    const now = new Date();
    for (const user of users) {
      let changed = false;
      user.subscriptions.forEach((sub) => {
        if (
          sub.status === 'active' &&
          sub.subscriptionExpiry &&
          sub.subscriptionExpiry <= now // Updated to <= for immediate expiration
        ) {
          sub.status = 'expired';
          changed = true;
          logger.info(`Marked subscription as expired for user ${user._id}, creator ${sub.creatorId}`);
        }
      });
      if (changed) {
        await user.save();
      }
    }
  } catch (error) {
    logger.error(`Error cleaning up all users’ subscriptions and bookmarks: ${error.message}`);
  }
};

userSchema.index({ 'subscriptions.creatorId': 1, 'subscriptions.status': 1 });
userSchema.index({ 'subscriptions.subscriptionBundle': 1 }); // Added for performance

module.exports = mongoose.model('User', userSchema);