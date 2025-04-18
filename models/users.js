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
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  googleId: { type: String, unique: true, sparse: true },
  verified: { type: Boolean, default: false },
  verificationToken: { type: String },
  redirectAfterVerify: { type: String, default: null }, // Add this field
  createdAt: { type: Date, default: Date.now },
  role: { type: String, enum: ['user', 'creator', 'admin'], default: 'user' },
  requestToBeCreator: { type: Boolean, default: false },
  profileName: { type: String },
  bio: { type: String },
  profilePicture: { type: String, default: 'a1.png' },
  coverPhoto: { type: String, default: '/uploads/default-cover.jpg' },
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
});

// Pre-save middleware to update subscription statuses
userSchema.pre('save', async function (next) {
  const now = new Date();
  let subscriptionsChanged = false;

  // Update expired subscriptions
  this.subscriptions.forEach((sub) => {
    if (
      sub.status === 'active' &&
      sub.subscriptionExpiry &&
      sub.subscriptionExpiry < now
    ) {
      sub.status = 'expired';
      subscriptionsChanged = true;
    }
  });

  // Method to update post-related counts
userSchema.methods.updatePostCounts = async function () {
  const posts = await mongoose.model('Post').find({ creator: this._id });
  this.imagesCount = posts.filter(post => post.type === 'image').length;
  this.videosCount = posts.filter(post => post.type === 'video').length;
  this.totalLikes = posts.reduce((sum, post) => sum + (post.likes ? post.likes.length : 0), 0);
  console.log(`Updated counts for ${this.username}:`, {
    imagesCount: this.imagesCount,
    videosCount: this.videosCount,
    totalLikes: this.totalLikes
  });
  await this.save();
};

  // Clean up bookmarks if subscriptions changed
  if (subscriptionsChanged && this.bookmarks.length > 0) {
    try {
      await this.removeBookmarksForExpiredSubscriptions();
    } catch (error) {
      console.error('Error cleaning bookmarks in pre-save:', error);
    }
  }

  next();
});

// Method to calculate subscriberCount
userSchema.methods.updateSubscriberCount = async function () {
  const now = new Date();
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

// Method to check and update expired subscriptions
userSchema.methods.checkExpiredSubscriptions = async function () {
  const now = new Date();
  let changed = false;
  this.subscriptions.forEach((sub) => {
    if (
      sub.status === 'active' &&
      sub.subscriptionExpiry &&
      sub.subscriptionExpiry < now
    ) {
      sub.status = 'expired';
      changed = true;
    }
  });
  if (changed) {
    await this.save(); // This will trigger pre-save middleware
  }
};

// Method to remove bookmarks from creators with expired subscriptions
userSchema.methods.removeBookmarksForExpiredSubscriptions = async function () {
  const now = new Date();
  const activeCreatorIds = this.subscriptions
    .filter(
      (sub) =>
        sub.status === 'active' &&
        sub.subscriptionExpiry &&
        sub.subscriptionExpiry > now
    )
    .map((sub) => sub.creatorId.toString());

  const updatedBookmarks = await Promise.all(
    this.bookmarks.map(async (bookmarkId) => {
      try {
        const post = await mongoose.model('Post')
          .findById(bookmarkId)
          .populate('creator', '_id');
        if (!post || !post.creator) {
          console.log(`Removing invalid bookmark: ${bookmarkId}`);
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
          console.log(`Removing bookmark ${bookmarkId} (expired subscription, special, not purchased)`);
        }
        return keepBookmark ? bookmarkId : false;
      } catch (error) {
        console.error(`Error checking bookmark ${bookmarkId}:`, error);
        return false;
      }
    })
  );

  const validBookmarks = updatedBookmarks.filter((id) => id !== false);
  if (validBookmarks.length !== this.bookmarks.length) {
    this.bookmarks = validBookmarks;
    console.log(`Updated bookmarks: ${validBookmarks.length} remaining`);
    await this.save();
  }
};

// Method to force clean subscriptions and bookmarks
userSchema.statics.cleanupAllUsers = async function () {
  const users = await this.find({ 'subscriptions.0': { $exists: true } });
  const now = new Date();
  for (const user of users) {
    let changed = false;
    user.subscriptions.forEach((sub) => {
      if (
        sub.status === 'active' &&
        sub.subscriptionExpiry &&
        sub.subscriptionExpiry < now
      ) {
        sub.status = 'expired';
        changed = true;
      }
    });
    if (changed) {
      await user.save(); // Triggers pre-save middleware
    }
  }
  console.log('Cleaned up all users’ subscriptions and bookmarks');
};

module.exports = mongoose.model('User', userSchema);