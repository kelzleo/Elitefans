// routes/profile.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/users');
const Post = require('../models/Post');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { bucket, profileBucket, generateSignedUrl, uploadMediaWithPreview } = require('../utilis/cloudStorage'); // Added uploadMediaWithPreview
const SubscriptionBundle = require('../models/SubscriptionBundle');
const flutter = require('../utilis/flutter');
const Transaction = require('../models/Transaction');
const Notification = require('../models/notifications');
const PendingSubscription = require('../models/pendingSubscription'); 
const logger = require('../logs/logger'); // Import Winston logger
const Report = require('../models/Reports');

// Set up multer to store files in memory
const multerStorage = multer.memoryStorage();
const upload = multer({ storage: multerStorage });
const uploadFields = upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'coverPhoto', maxCount: 1 },
]);
const uploadContentFields = upload.fields([
  { name: 'contentImages', maxCount: 10 },
  { name: 'contentVideos', maxCount: 10 },
]);
// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    return res.redirect('/');
  }
  next();
};


// Helper function to parse @username tags and convert to HTML links
const renderTaggedWriteUp = (writeUp, taggedUsers) => {
  if (!writeUp) return writeUp || '';

  // Create a map of usernames from taggedUsers for quick lookup
  const userMap = taggedUsers.reduce((map, user) => {
    if (user && user.username) {
      map[user.username.toLowerCase()] = user.username;
    }
    return map;
  }, {});

  // Replace @username with links for valid users, plain text for invalid
  return writeUp.replace(/@(\w+)/g, (match, username) => {
    const lowerUsername = username.toLowerCase();
    if (userMap[lowerUsername]) {
      const actualUsername = userMap[lowerUsername]; // Preserve case
      return `<a href="/profile/${encodeURIComponent(actualUsername)}" class="tagged-user">@${actualUsername}</a>`;
    }
    return match; // Return original @username as plain text
  });
};
/**
 * Helper to process post URLs:
 * For special posts, only generate the signed URL if:
 * - The current user is the owner, OR
 * - The current user has purchased/unlocked the content, OR
 * - adminView is true (admin sees all content)
 * Otherwise, set a locked placeholder.
 * Preserves createdAt for frontend relative time formatting.
 */
const processPostUrls = async (posts, currentUser, ownerUser, adminView = false) => {
  await Post.populate(posts, { path: 'taggedUsers', select: 'username' });

  for (const post of posts) {
    const isOwner = currentUser && currentUser._id.toString() === ownerUser._id.toString();
    const isSubscribed = currentUser && currentUser.subscriptions &&
      currentUser.subscriptions.some(sub =>
        sub.creatorId.toString() === ownerUser._id.toString() &&
        sub.status === 'active' &&
        sub.subscriptionExpiry > new Date()
      );
    const hasPurchased = currentUser && currentUser.purchasedContent &&
      currentUser.purchasedContent.some(p => p.contentId.toString() === post._id.toString());
    const canViewSpecialContent = adminView || isOwner || hasPurchased;
    const canViewPreview = isSubscribed && !hasPurchased && !isOwner && !adminView;

    // Handle old-style posts (single media)
    if (post.contentUrl && !post.contentUrl.startsWith('http')) {
      try {
        if (!post.special || canViewSpecialContent) {
          post.contentUrl = await generateSignedUrl(post.contentUrl);
        } else if (canViewPreview && post.previewUrl) {
          post.contentUrl = await generateSignedUrl(post.previewUrl);
          post.isLocked = true; // Flag for frontend
        } else {
          post.contentUrl = null; // Non-subscribers see nothing
          post.isLocked = true;
          post.isNonSubscriber = !isSubscribed;
        }
      } catch (err) {
        logger.error(`Failed to generate signed URL for post: ${err.message}`);
        post.contentUrl = '/Uploads/placeholder.png';
      }
    }
    // Generate signed URL for post.posterUrl (for single video posts)
    if (post.type === 'video' && post.posterUrl && !post.posterUrl.startsWith('http')) {
      try {
        post.posterUrl = await generateSignedUrl(post.posterUrl);
      } catch (err) {
        logger.error(`Failed to generate signed URL for post poster: ${err.message}`);
        post.posterUrl = null; // Set to null instead of fallback
      }
    }

    // Handle new-style posts (multiple media)
    if (post.mediaItems && post.mediaItems.length > 0) {
      for (const mediaItem of post.mediaItems) {
        if (!mediaItem.url.startsWith('http')) {
          try {
            if (!post.special || canViewSpecialContent) {
              mediaItem.url = await generateSignedUrl(mediaItem.url);
            } else if (canViewPreview && mediaItem.previewUrl) {
              mediaItem.url = await generateSignedUrl(mediaItem.previewUrl);
              post.isLocked = true;
            } else {
              mediaItem.url = null; // Non-subscribers see nothing
              post.isLocked = true;
              post.isNonSubscriber = !isSubscribed;
            }
          } catch (err) {
            logger.error(`Failed to generate signed URL for media item: ${err.message}`);
            mediaItem.url = '/Uploads/placeholder.png';
          }
        }
        // Generate signed URL for mediaItem.posterUrl (for videos)
        if (mediaItem.type === 'video' && mediaItem.posterUrl && !mediaItem.posterUrl.startsWith('http')) {
          try {
            mediaItem.posterUrl = await generateSignedUrl(mediaItem.posterUrl);
          } catch (err) {
            logger.error(`Failed to generate signed URL for media item poster: ${err.message}`);
            mediaItem.posterUrl = null; // Set to null instead of fallback
          }
        }
      }
    }

    // Render writeUp with tagged user links
    if (post.writeUp && post.taggedUsers) {
      post.renderedWriteUp = await renderTaggedWriteUp(post.writeUp, post.taggedUsers);
    } else {
      post.renderedWriteUp = post.writeUp;
    }
  }

  logger.debug('Processed posts with createdAt timestamps:', {
    postIds: posts.map(p => p._id.toString()),
    createdAt: posts.map(p => p.createdAt ? p.createdAt.toISOString() : null),
  });
};
router.get('/edit', authCheck, (req, res) => {
  res.render('edit-profile', { user: req.user, currentUser: req.user });
});

// POST route to handle profile edits and upload profile picture to Google Cloud Storage
router.post('/edit', authCheck, uploadFields, async (req, res) => {
 
  try {
    const updates = {
      profileName: req.body.profileName,
      bio: req.body.bio,
    };

    // Handle username update
    const newUsername = req.body.username?.trim();
    if (!newUsername) {
      logger.warn('Username is required in profile edit');
      req.flash('error_msg', 'Username is required.');
      return res.redirect('/profile/edit');
    }

    // Check if the username has changed
    const currentUser = await User.findById(req.user._id);
    if (newUsername !== (currentUser.username || '')) {
      // Validate username format
      const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
      if (!usernameRegex.test(newUsername)) {
        logger.warn('Invalid username format in profile edit');
        req.flash('error_msg', 'Username must be 3-20 characters long, alphanumeric, and can include underscores.');
        return res.redirect('/profile/edit');
      }

      // Check for username uniqueness
      const existingUser = await User.findOne({ username: newUsername });
      if (existingUser && existingUser._id.toString() !== req.user._id.toString()) {
        logger.warn('Username already taken in profile edit');
        req.flash('error_msg', 'This username is already taken.');
        return res.redirect('/profile/edit');
      }

      updates.username = newUsername;
    }

    // Handle profile picture upload
    if (req.files.profilePicture && req.files.profilePicture[0]) {
      const profileFile = req.files.profilePicture[0];
      const profileBlobName = `profilePictures/${Date.now()}_${profileFile.originalname}`;
      const profileBlob = profileBucket.file(profileBlobName);

      const profileBlobStream = profileBlob.createWriteStream({
        resumable: false,
        contentType: profileFile.mimetype,
      });

      await new Promise((resolve, reject) => {
        profileBlobStream.on('finish', resolve);
        profileBlobStream.on('error', (err) => {
          logger.error(`Error uploading profile picture: ${err.message}`);
          reject(err);
        });
        profileBlobStream.end(profileFile.buffer);
      });

      updates.profilePicture = `https://storage.googleapis.com/${profileBucket.name}/${profileBlobName}`;
    }

    // Handle cover photo upload
    if (req.files.coverPhoto && req.files.coverPhoto[0]) {
      const coverFile = req.files.coverPhoto[0];
      const coverBlobName = `coverPhotos/${Date.now()}_${coverFile.originalname}`;
      const coverBlob = profileBucket.file(coverBlobName);

      const coverBlobStream = coverBlob.createWriteStream({
        resumable: false,
        contentType: coverFile.mimetype,
      });

      await new Promise((resolve, reject) => {
        coverBlobStream.on('finish', resolve);
        coverBlobStream.on('error', (err) => {
          logger.error(`Error uploading cover photo: ${err.message}`);
          reject(err);
        });
        coverBlobStream.end(coverFile.buffer);
      });

      updates.coverPhoto = `https://storage.googleapis.com/${profileBucket.name}/${coverBlobName}`;
    }

    await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    req.flash('success_msg', 'Profile updated successfully!');
    res.redirect('/profile');
  } catch (err) {
    logger.error(`Error updating profile: ${err.message}`);
    if (err.code === 11000 && err.keyPattern && err.keyPattern.username) {
      req.flash('error_msg', 'This username is already taken.');
    } else {
      req.flash('error_msg', 'Error updating profile.');
    }
    res.redirect('/profile/edit');
  }
});

// View own profile
router.get('/', authCheck, async (req, res) => {
  logger.info(`Request URL: ${req.originalUrl}, Route: /, User: ${req.user._id}, Referer: ${req.get('Referer') || 'none'}`);
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      logger.error(`User not found for ID: ${req.user._id}`);
      if (req.is('json')) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
      }
      return res.status(404).send('User not found');
    }
    logger.info(`Found user: ${user._id}, username: ${user.username}`);

    await user.checkExpiredSubscriptions();
    await user.updateSubscriberCount();

    const sortBy = req.query.sortBy || 'createdAt';
    const order = req.query.order || 'desc';
    const subtab = req.query.subtab || 'all';

    logger.debug(`req.query: ${JSON.stringify(req.query)}`);

    const validSortFields = ['createdAt', 'totalTips', 'likes'];
    const validOrders = ['asc', 'desc'];

    const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortOrder = validOrders.includes(order) ? order : 'desc';

    let sortCriteria = {};
    if (sortField === 'likes') {
      sortCriteria = { likesCount: sortOrder === 'desc' ? -1 : 1 };
    } else {
      sortCriteria[sortField] = sortOrder === 'desc' ? -1 : 1;
    }

    let posts = [];
    let postsQuery = Post.find({ creator: req.user._id })
      .populate('comments.user', 'username')
      .populate('taggedUsers', 'username');

    if (subtab !== 'all') {
      postsQuery = postsQuery.where('category').equals(subtab);
    }

    if (sortField === 'likes') {
      const postsAgg = await Post.aggregate([
        {
          $match: {
            creator: new mongoose.Types.ObjectId(req.user._id),
            ...(subtab !== 'all' ? { category: subtab } : {}),
          },
        },
        {
          $addFields: {
            likesCount: { $size: { $ifNull: ['$likes', []] } },
          },
        },
        { $sort: sortCriteria },
        {
          $project: {
            _id: 1,
          },
        },
      ]);
      const postIds = postsAgg.map((p) => p._id);
      posts = await Post.find({ _id: { $in: postIds } })
        .populate('comments.user', 'username')
        .populate('taggedUsers', 'username')
        .setOptions({ sort: { _id: 1 } })
        .exec();
      posts = postIds
        .map((id) => posts.find((p) => p._id.toString() === id.toString()))
        .filter((p) => p);
    } else {
      postsQuery = postsQuery.sort(sortCriteria);
      posts = await postsQuery;
    }

    for (const post of posts) {
      post.comments = post.comments.filter((comment) => {
        if (comment.user === null) {
          logger.warn(`Removing invalid comment on post ${post._id}`);
          return false;
        }
        return true;
      });
    }

    try {
      await processPostUrls(posts, req.user, user);
    } catch (err) {
      logger.error(`Error in processPostUrls: ${err.message}, Stack: ${err.stack}`);
      throw err;
    }

    logger.info(`Fetched ${posts.length} posts for user ${user.username}`, {
      postTypes: posts.map((p) => p.type),
      categories: posts.map((p) => p.category || 'null'),
      createdAt: posts.map((p) => p.createdAt ? p.createdAt.toISOString() : null),
      sortBy: sortField,
      order: sortOrder,
      subtab,
    });

    const bundles =
      user.role === 'creator'
        ? await SubscriptionBundle.find({ creatorId: req.user._id }).sort({
            isFree: -1,
            durationWeight: 1,
          })
        : [];

    const stats = await Post.aggregate([
      { $match: { creator: new mongoose.Types.ObjectId(req.user._id) } },
      {
        $group: {
          _id: null,
          imagesCount: { $sum: { $cond: [{ $eq: ['$type', 'image'] }, 1, 0] } },
          videosCount: { $sum: { $cond: [{ $eq: ['$type', 'video'] }, 1, 0] } },
          totalLikes: { $sum: { $size: { $ifNull: ['$likes', []] } } },
        },
      },
    ]);

    const imagesCount = stats[0]?.imagesCount || 0;
    const videosCount = stats[0]?.videosCount || 0;
    const totalLikes = stats[0]?.totalLikes || 0;
    const subscriberCount = user.subscriberCount;

    logger.debug(`Rendering own profile with subtab: ${subtab || 'all'}`);
    res.set('Cache-Control', 'no-store');
    res.render('profile', {
      user: {
        ...user.toObject(),
        imagesCount,
        videosCount,
        totalLikes,
        subscriberCount,
        postCategories: user.postCategories || [],
      },
      currentUser: req.user,
      isSubscribed: true,
      posts,
      bundles,
      adminView: req.user.role === 'admin',
      env: process.env.NODE_ENV || 'development',
      flashMessages: req.flash(),
      activeTab: 'posts',
      activeSubtab: subtab || 'all',
    });
  } catch (err) {
    logger.error(`Error loading own profile: ${err.message}, Stack: ${err.stack}, User: ${req.user._id}, req.query: ${JSON.stringify(req.query)}`);
    if (process.env.NODE_ENV === 'development') {
      return res.status(500).send(`Error: ${err.message}\nStack: ${err.stack}`);
    }
    if (req.is('json')) {
      return res.status(500).json({ status: 'error', message: 'Error loading profile' });
    }
    return res.status(500).send('Error loading profile');
  }
});
// Unlock special content route (using the Post model)
router.post('/unlock-special-content', authCheck, async (req, res) => {
 
  try {
    const { contentId, creatorId } = req.body;
    if (!contentId || !creatorId) {
      logger.warn('Missing contentId or creatorId in unlock-special-content');
      return res.status(400).json({
        status: 'error',
        message: 'Creator ID and Content ID are required',
      });
    }

    const specialPost = await Post.findOne({
      _id: contentId,
      creator: creatorId,
      special: true,
    });
    if (!specialPost) {
      logger.warn('Special content not found in unlock-special-content');
      return res.status(404).json({
        status: 'error',
        message: 'Special content not found',
      });
    }

    const currentUser = await User.findById(req.user._id);
    const alreadyUnlocked = currentUser.purchasedContent.some(
      (p) => p.contentId.toString() === contentId
    );
    if (alreadyUnlocked) {
      logger.warn('Content already unlocked in unlock-special-content');
      return res.status(400).json({
        status: 'error',
        message: 'Content already unlocked',
      });
    }

    const paymentResponse = await flutter.initializeSpecialPayment(
      req.user._id,
      creatorId,
      contentId,
      specialPost.unlockPrice
    );

    if (
      paymentResponse.status === 'success' &&
      paymentResponse.meta &&
      paymentResponse.meta.authorization
    ) {
      await User.findByIdAndUpdate(req.user._id, {
        $push: {
          pendingTransactions: {
            tx_ref: paymentResponse.meta.authorization.transfer_reference,
            creatorId,
            bundleId: contentId,
            amount: specialPost.unlockPrice,
            status: 'pending',
            createdAt: new Date(),
            type: 'special',
          },
        },
      });

      return res.json({
        status: 'success',
        message: 'Payment initialized successfully for special content',
        data: {
          paymentLink: paymentResponse.meta.authorization.payment_link || null,
        },
      });
    } else {
      logger.error(`Payment initialization failed: ${paymentResponse.message || 'Unknown error'}`);
      return res.status(400).json({
        status: 'error',
        message: paymentResponse.message || 'Payment initialization failed',
      });
    }
  } catch (err) {
    logger.error(`Error unlocking special content: ${err.message}`);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// Verify subscription payment and update subscriptions
router.get('/verify-payment', async (req, res) => {
 
  try {
    const { transaction_id, status, tx_ref } = req.query;
    if (status === 'cancelled') return res.redirect('/profile?payment=cancelled');
    if (!transaction_id || !tx_ref) {
      logger.warn('Missing transaction_id or tx_ref in verify-payment');
      return res.redirect('/profile?payment=error');
    }
    const paymentResponse = await flutter.verifyPayment(transaction_id);
    if (
      paymentResponse.status === 'success' &&
      paymentResponse.data &&
      paymentResponse.data.status === 'successful'
    ) {
      const user = await User.findOne({ 'pendingTransactions.tx_ref': tx_ref });
      if (!user) {
        logger.error('No pending transaction found for tx_ref in verify-payment');
        return res.redirect('/profile?payment=error');
      }
      const pendingTx = user.pendingTransactions.find(
        (tx) => tx.tx_ref === tx_ref && tx.type === 'subscription'
      );
      if (!pendingTx) {
        logger.error('Pending subscription transaction not found in verify-payment');
        return res.redirect('/profile?payment=error');
      }
      if (pendingTx.amount !== paymentResponse.data.amount) {
        logger.error('Amount mismatch in verify-payment');
        return res.redirect('/profile?payment=error');
      }
      const bundle = await SubscriptionBundle.findById(pendingTx.bundleId);
      if (!bundle) {
        logger.error('Subscription bundle not found in verify-payment');
        return res.redirect('/profile?payment=error');
      }

      let subscriptionExpiry = new Date();
      if (bundle.duration === '1 day') {
        subscriptionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      } else if (bundle.duration === '1 month') {
        subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      } else if (bundle.duration === '3 months') {
        subscriptionExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      } else if (bundle.duration === '6 months') {
        subscriptionExpiry = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
      } else if (bundle.duration === '1 year') {
        subscriptionExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      }

      await User.findByIdAndUpdate(user._id, {
        $push: {
          subscriptions: {
            creatorId: pendingTx.creatorId,
            subscriptionBundle: pendingTx.bundleId,
            subscribedAt: new Date(),
            subscriptionExpiry,
            status: 'active',
          },
        },
        $pull: { pendingTransactions: { tx_ref: tx_ref } },
      });

      const subscriberUser = user;
      await Notification.create({
        user: pendingTx.creatorId,
        message: `${subscriberUser.username} just subscribed!`,
        type: 'new_subscription',
      });

      const creator = await User.findById(pendingTx.creatorId);
      const transactionDate = new Date();
      const isWithinReferralPeriod =
        creator.referredBy &&
        creator.creatorSince &&
        (transactionDate - creator.creatorSince) < (3 * 30 * 24 * 60 * 60 * 1000); // 3 months

      let creatorShare, platformShare, referrerShare = 0;
      if (isWithinReferralPeriod) {
        creatorShare = pendingTx.amount * 0.75;
        platformShare = pendingTx.amount * 0.20;
        referrerShare = pendingTx.amount * 0.05;
      } else {
        creatorShare = pendingTx.amount * 0.75;
        platformShare = pendingTx.amount * 0.25;
      }

      await Transaction.create({
        user: user._id,
        creator: pendingTx.creatorId,
        subscriptionBundle: pendingTx.bundleId,
        type: 'subscription',
        amount: pendingTx.amount,
        creatorShare,
        platformShare,
        referrerShare,
        referrerId: isWithinReferralPeriod ? creator.referredBy : null,
        description: 'Subscription purchase',
      });

      creator.totalEarnings += creatorShare;
      await creator.updateSubscriberCount();
      await creator.save();

      if (referrerShare > 0) {
        const referrer = await User.findById(creator.referredBy);
        if (referrer) {
          referrer.totalEarnings += referrerShare;
          await referrer.save();
        }
      }

      return res.redirect('/profile?payment=success');
    } else {
      logger.error('Payment verification failed in verify-payment');
      return res.redirect('/profile?payment=failed');
    }
  } catch (error) {
    logger.error(`Error in verify-payment: ${error.message}`);
    return res.redirect('/profile?payment=error');
  }
});

// Verify special payment and update purchasedContent
router.get('/verify-special-payment', async (req, res) => {
  
  try {
    const { transaction_id, status, tx_ref } = req.query;
    if (status === 'cancelled') {
      return res.redirect('/profile?specialPayment=cancelled');
    }
    if (!transaction_id || !tx_ref) {
      logger.warn('Missing transaction_id or tx_ref in verify-special-payment');
      return res.redirect('/profile?specialPayment=error');
    }

    const paymentResponse = await flutter.verifyPayment(transaction_id);
    if (
      paymentResponse.status === 'success' &&
      paymentResponse.data &&
      paymentResponse.data.status === 'successful'
    ) {
      const user = await User.findOne({ 'pendingTransactions.tx_ref': tx_ref });
      if (!user) {
        logger.error('No pending transaction found for tx_ref in verify-special-payment');
        return res.redirect('/profile?specialPayment=error');
      }
      const pendingTx = user.pendingTransactions.find(
        (tx) => tx.tx_ref === tx_ref && tx.type === 'special'
      );
      if (!pendingTx) {
        logger.error('Pending special transaction not found in verify-special-payment');
        return res.redirect('/profile?specialPayment=error');
      }
      if (pendingTx.amount !== paymentResponse.data.amount) {
        logger.error('Amount mismatch in verify-special-payment');
        return res.redirect('/profile?specialPayment=error');
      }

      await User.findByIdAndUpdate(user._id, {
        $push: {
          purchasedContent: {
            contentId: pendingTx.bundleId,
            purchasedAt: new Date(),
            amount: pendingTx.amount,
            transactionId: transaction_id,
          },
        },
        $pull: { pendingTransactions: { tx_ref: tx_ref } },
      });

      const creator = await User.findById(pendingTx.creatorId);
      const transactionDate = new Date();
      const isWithinReferralPeriod =
        creator.referredBy &&
        creator.creatorSince &&
        (transactionDate - creator.creatorSince) < (3 * 30 * 24 * 60 * 60 * 1000);

      let creatorShare, platformShare, referrerShare = 0;
      if (isWithinReferralPeriod) {
        creatorShare = pendingTx.amount * 0.75;
        platformShare = pendingTx.amount * 0.20;
        referrerShare = pendingTx.amount * 0.05;
      } else {
        creatorShare = pendingTx.amount * 0.75;
        platformShare = pendingTx.amount * 0.25;
      }

      await Transaction.create({
        user: user._id,
        creator: pendingTx.creatorId,
        post: pendingTx.bundleId,
        type: 'special',
        amount: pendingTx.amount,
        creatorShare,
        platformShare,
        referrerShare,
        referrerId: isWithinReferralPeriod ? creator.referredBy : null,
        description: 'Unlocked special content',
      });

      creator.totalEarnings += creatorShare;
      await creator.save();

      if (referrerShare > 0) {
        const referrer = await User.findById(creator.referredBy);
        if (referrer) {
          referrer.totalEarnings += referrerShare;
          await referrer.save();
        }
      }

      return res.redirect(`/profile/view/${pendingTx.creatorId}?specialPayment=success`);
    } else {
      logger.error('Payment verification failed in verify-special-payment');
      return res.redirect('/profile?specialPayment=failed');
    }
  } catch (error) {
    logger.error(`Error in verify-special-payment: ${error.message}`);
    return res.redirect('/profile?specialPayment=error');
  }
});

// for tip amounts
router.post('/posts/:postId/tip', authCheck, async (req, res) => {

  try {
    const { tipAmount } = req.body;
    // Convert tipAmount to a number
    const numericTip = Number(tipAmount);

    const post = await Post.findById(req.params.postId);
    if (!post) {
      logger.warn('Post not found in posts/:postId/tip');
      return res.status(404).json({ message: 'Post not found' });
    }

    const creatorId = post.creator; // the creator of the post

    // Initialize tip payment using the new function
    const paymentResponse = await flutter.initializeTipPayment(
      req.user._id,
      creatorId,
      req.params.postId,
      numericTip
    );

    if (
      paymentResponse.status === 'success' &&
      paymentResponse.meta &&
      paymentResponse.meta.authorization
    ) {
      // Add a pending transaction for this tip, storing the numeric value
      await User.findByIdAndUpdate(req.user._id, {
        $push: {
          pendingTransactions: {
            tx_ref: paymentResponse.meta.authorization.transfer_reference,
            creatorId,
            postId: req.params.postId,
            amount: numericTip,
            status: 'pending',
            createdAt: new Date(),
            type: 'tip'
          }
        }
      });

      return res.json({
        status: 'success',
        message: 'Tip payment initialized successfully',
        data: {
          paymentLink: paymentResponse.meta.authorization.payment_link
        }
      });
    } else {
      logger.error(`Tip payment initialization failed: ${paymentResponse.message || 'Unknown error'}`);
      return res.status(400).json({
        status: 'error',
        message: paymentResponse.message || 'Payment initialization failed'
      });
    }
  } catch (err) {
    logger.error(`Error initializing tip payment: ${err.message}`);
    return res.status(500).json({
      status: 'error',
      message: 'Error processing tip payment'
    });
  }
});

// Verify tip payment route
router.get('/verify-tip-payment', async (req, res) => {

  try {
    const { transaction_id, status, tx_ref } = req.query;
    if (status === 'cancelled') {
      return res.redirect('/profile?tipPayment=cancelled');
    }
    if (!transaction_id || !tx_ref) {
      logger.warn('Missing transaction_id or tx_ref in verify-tip-payment');
      return res.redirect('/profile?tipPayment=error');
    }

    const paymentResponse = await flutter.verifyPayment(transaction_id);
    if (
      paymentResponse.status === 'success' &&
      paymentResponse.data &&
      paymentResponse.data.status === 'successful'
    ) {
      const user = await User.findOne({ 'pendingTransactions.tx_ref': tx_ref });
      if (!user) {
        logger.error('No user found with tx_ref in verify-tip-payment');
        return res.redirect('/profile?tipPayment=error');
      }
      const pendingTx = user.pendingTransactions.find(
        (tx) => tx.tx_ref === tx_ref && tx.type === 'tip'
      );
      if (!pendingTx) {
        logger.error('No pending tip transaction found for tx_ref in verify-tip-payment');
        return res.redirect('/profile?tipPayment=error');
      }
      if (Number(pendingTx.amount) !== Number(paymentResponse.data.amount)) {
        logger.error('Tip amount mismatch in verify-tip-payment');
        return res.redirect('/profile?tipPayment=error');
      }

      const creator = await User.findById(pendingTx.creatorId);
      const transactionDate = new Date();
      const isWithinReferralPeriod =
        creator.referredBy &&
        creator.creatorSince &&
        (transactionDate - creator.creatorSince) < (3 * 30 * 24 * 60 * 60 * 1000);

      let creatorShare, platformShare, referrerShare = 0;
      if (isWithinReferralPeriod) {
        creatorShare = pendingTx.amount * 0.75;
        platformShare = pendingTx.amount * 0.20;
        referrerShare = pendingTx.amount * 0.05;
      } else {
        creatorShare = pendingTx.amount * 0.75;
        platformShare = pendingTx.amount * 0.25;
      }

      const tipper = await User.findById(user._id).select('username');
      await Transaction.create({
        user: user._id,
        creator: pendingTx.creatorId,
        post: pendingTx.postId,
        type: 'tip',
        amount: Number(pendingTx.amount),
        creatorShare,
        platformShare,
        referrerShare,
        referrerId: isWithinReferralPeriod ? creator.referredBy : null,
        description: pendingTx.message
          ? `Tip payment with message: "${pendingTx.message}"`
          : 'Tip payment',
      });

      creator.totalEarnings += creatorShare;
      await creator.save();

      if (referrerShare > 0) {
        const referrer = await User.findById(creator.referredBy);
        if (referrer) {
          referrer.totalEarnings += referrerShare;
          await referrer.save();
        }
      }

      await Notification.create({
        user: pendingTx.creatorId,
        message: pendingTx.message
          ? `${tipper.username} tipped you ₦${pendingTx.amount} with message: "${pendingTx.message}"`
          : `${tipper.username} tipped you ₦${pendingTx.amount}`,
        type: 'tip',
        postId: pendingTx.postId || null,
        creatorId: user._id,
        creatorName: tipper.username,
      });

      if (pendingTx.postId) {
        await Post.findByIdAndUpdate(pendingTx.postId, {
          $inc: { totalTips: Number(pendingTx.amount) },
        });
      }

      if (pendingTx.message) {
        const Chat = require('../models/chat');
        const participants = [user._id.toString(), pendingTx.creatorId.toString()].sort();
        let chat = await Chat.findOne({ participants });
        if (!chat) {
          chat = new Chat({ participants, messages: [] });
        }
        chat.messages.push({
          sender: user._id,
          text: pendingTx.message,
          timestamp: new Date(),
          isTip: true,
          tipAmount: Number(pendingTx.amount),
          read: false,
        });
        chat.updatedAt = new Date();
        await chat.save();

        const io = req.app.get('socketio');
        if (io) {
          io.to(chat._id.toString()).emit('newMessage', chat.messages[chat.messages.length - 1]);
        }
      }

      await User.findByIdAndUpdate(user._id, {
        $pull: { pendingTransactions: { tx_ref } },
      });

      return res.redirect('/profile?tipPayment=success');
    } else {
      logger.error('Payment verification failed in verify-tip-payment');
      return res.redirect('/profile?tipPayment=failed');
    }
  } catch (error) {
    logger.error(`Error verifying tip payment: ${error.message}`);
    return res.redirect('/profile?tipPayment=error');
  }
});

router.post('/tip-creator/:creatorId', authCheck, async (req, res) => {
  
  try {
    const { tipAmount, tipMessage } = req.body;
    const numericTip = Number(tipAmount);
    if (!numericTip || numericTip <= 0) {
      logger.warn('Invalid tip amount in tip-creator/:creatorId');
      return res.status(400).json({ message: 'Invalid tip amount' });
    }
    const creatorId = req.params.creatorId;

    // Initialize the tip payment
    const paymentResponse = await flutter.initializeTipPayment(
      req.user._id,
      creatorId,
      null, // no postId for profile-level tip
      numericTip,
      tipMessage || ''
    );

    if (
      paymentResponse.status === 'success' &&
      paymentResponse.meta &&
      paymentResponse.meta.authorization
    ) {
      // Add pending transaction for the tip
      await User.findByIdAndUpdate(req.user._id, {
        $push: {
          pendingTransactions: {
            tx_ref: paymentResponse.meta.authorization.transfer_reference,
            creatorId,
            postId: null,
            amount: numericTip,
            message: tipMessage || null,
            status: 'pending',
            createdAt: new Date(),
            type: 'tip'
          }
        }
      });

      return res.json({
        status: 'success',
        message: 'Tip payment initialized successfully',
        data: { paymentLink: paymentResponse.meta.authorization.payment_link }
      });
    } else {
      logger.error(`Tip payment initialization failed: ${paymentResponse.message || 'Unknown error'}`);
      return res.status(400).json({
        status: 'error',
        message: paymentResponse.message || 'Payment initialization failed'
      });
    }
  } catch (err) {
    logger.error(`Error initializing profile-level tip payment: ${err.message}`);
    return res.status(500).json({
      status: 'error',
      message: 'Error processing tip payment'
    });
  }
});

router.post('/posts/:postId/like', authCheck, async (req, res) => {

  try {
    const post = await Post.findById(req.params.postId);
    if (!post) {
      logger.warn('Post not found in posts/:postId/like');
      return res.status(404).json({ message: 'Post not found' });
    }

    const userId = req.user._id.toString();
    const alreadyLiked = post.likes.some(
      (likeId) => likeId.toString() === userId
    );

    let likeChange = 0;
    if (alreadyLiked) {
      post.likes = post.likes.filter((likeId) => likeId.toString() !== userId);
      likeChange = -1;
    } else {
      post.likes.push(userId);
      likeChange = 1;
    }
    await post.save();

    // Update the creator's totalLikes
    const creator = await User.findById(post.creator);
    if (!creator) {
      logger.error('Creator not found for post in posts/:postId/like');
      return res.status(404).json({ message: 'Creator not found' });
    }
    await User.findByIdAndUpdate(post.creator, { $inc: { totalLikes: likeChange } });

    res.json({
      message: alreadyLiked ? 'Post unliked successfully' : 'Post liked successfully',
      likes: post.likes.length,
      userLiked: !alreadyLiked,
    });
  } catch (err) {
    logger.error(`Error toggling like: ${err.message}`);
    res.status(500).json({ message: 'An error occurred while toggling the like' });
  }
});

// Comment on a post
router.post('/posts/:postId/comment', authCheck, async (req, res) => {
  
  try {
    const { text } = req.body;
    if (!text) {
      logger.warn('Comment text required in posts/:postId/comment');
      return res.status(400).json({ message: 'Comment text required' });
    }
    const post = await Post.findById(req.params.postId);
    if (!post) {
      logger.warn('Post not found in posts/:postId/comment');
      return res.status(404).json({ message: 'Post not found' });
    }

    const newComment = { user: req.user._id, text };
    post.comments.push(newComment);
    await post.save();

    // Fetch the commenter's username
    const commenter = await User.findById(req.user._id).select('username');
    if (!commenter) {
      logger.error('Commenter not found in posts/:postId/comment');
      return res.status(500).json({ message: 'Commenter not found' });
    }

    return res.json({
      message: 'Comment added successfully',
      comment: {
        user: { username: commenter.username },
        text: newComment.text,
      },
      commentCount: post.comments.length,
    });
  } catch (err) {
    logger.error(`Error commenting on post: ${err.message}`);
    res
      .status(500)
      .json({ message: 'An error occurred while submitting your comment' });
  }
});
// Bookmark/Unbookmark a post
router.post('/posts/:postId/bookmark', authCheck, async (req, res) => {

  try {
    const postId = req.params.postId;
    const userId = req.user._id;

    const post = await Post.findById(postId);
    if (!post) {
      logger.warn('Post not found in posts/:postId/bookmark');
      return res.status(404).json({ message: 'Post not found' });
    }

    const user = await User.findById(userId);
    const isBookmarked = user.bookmarks.some(id => id.toString() === postId.toString());

    if (isBookmarked) {
      // Remove bookmark
      user.bookmarks = user.bookmarks.filter(id => id.toString() !== postId.toString());
    } else {
      // Add bookmark
      user.bookmarks.push(postId);
    }

    await user.save();

    res.status(200).json({
      message: isBookmarked ? 'Post unbookmarked successfully' : 'Post bookmarked successfully',
      isBookmarked: !isBookmarked
    });
  } catch (error) {
    logger.error(`Bookmark error: ${error.message}`);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/posts/:postId/bookmark-status', authCheck, async (req, res) => {
  const logger = require('../logs/logger'); // Import Winston logger
  try {
    const user = await User.findById(req.user._id);
    const isBookmarked = user.bookmarks.some(id => id.toString() === req.params.postId.toString());
    res.json({ isBookmarked });
  } catch (error) {
    logger.error(`Error checking bookmark status: ${error.message}`);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post(
  '/uploadContent',
  authCheck,
  uploadContentFields,
  async (req, res) => {
    if (req.user.role !== 'creator') {
      logger.warn('Unauthorized content upload attempt by non-creator');
      return res.status(403).send('You do not have permission to upload content.');
    }
    try {
      const writeUp = req.body.writeUp || '';
      const isSpecial = req.body.special === 'true';
      const unlockPrice = req.body.unlockPrice ? Number(req.body.unlockPrice) : undefined;
      const category = req.body.category || null;

      // Validate input
      const hasImages = req.files.contentImages && req.files.contentImages.length > 0;
      const hasVideos = req.files.contentVideos && req.files.contentVideos.length > 0;
      if (!writeUp && !hasImages && !hasVideos) {
        logger.warn('Attempted to upload empty post (no text or media)');
        req.flash('error_msg', 'Please provide text or upload at least one image or video.');
        return res.status(400).redirect('/profile');
      }
      if (isSpecial && (!unlockPrice || unlockPrice < 100)) {
        logger.warn(`Invalid unlock price for special content: ${unlockPrice}`);
        req.flash('error_msg', 'Please provide a valid unlock price (minimum 100 NGN) for special content.');
        return res.status(400).redirect('/profile');
      }

      // Check total media files
      const totalMediaFiles =
        (hasImages ? req.files.contentImages.length : 0) +
        (hasVideos ? req.files.contentVideos.length : 0);
      if (totalMediaFiles > 10) {
        logger.warn(`Upload exceeds maximum limit: ${totalMediaFiles} files`);
        req.flash('error_msg', 'You can upload a maximum of 10 media files per post.');
        return res.status(400).redirect('/profile');
      }

      // Validate category
      const user = await User.findById(req.user._id);
      if (category && !user.postCategories.includes(category)) {
        logger.warn(`Invalid category: ${category}`);
        req.flash('error_msg', 'Invalid category selected.');
        return res.status(400).redirect('/profile');
      }

      // Parse @username tags from writeUp
      const tagRegex = /@(\w+)/g;
      const matches = writeUp.match(tagRegex) || [];
      const usernames = matches.map(tag => tag.slice(1));
      const uniqueUsernames = [...new Set(usernames)];

      const users = await User.find({ username: { $in: uniqueUsernames } }).select('_id username');
      const taggedUsers = users.map(user => user._id);
      const taggedUsersWithDetails = users;

      // Prepare post data
      let postType = 'text';
      const mediaItems = [];
      let contentUrl = null;
      let previewUrl = null;
      let posterUrl = null; // NEW: For single video posts

      if (hasImages) {
        for (const file of req.files.contentImages) {
          const uploadResult = await uploadMediaWithPreview(
            file.buffer,
            'image',
            path.basename(file.originalname),
            isSpecial
          );
          mediaItems.push({
            url: uploadResult.originalUrl,
            type: 'image',
            contentType: file.mimetype,
            previewUrl: uploadResult.previewUrl,
          });
        }
        postType = 'image';
        contentUrl = mediaItems[0].url;
        previewUrl = mediaItems[0].previewUrl;
      }

      if (hasVideos) {
        for (const file of req.files.contentVideos) {
          const uploadResult = await uploadMediaWithPreview(
            file.buffer,
            'video',
            path.basename(file.originalname),
            isSpecial
          );
          mediaItems.push({
            url: uploadResult.originalUrl,
            type: 'video',
            contentType: file.mimetype,
            previewUrl: uploadResult.previewUrl,
            posterUrl: uploadResult.posterUrl // NEW: Save posterUrl for videos
          });
        }
        postType = hasImages ? 'mixed' : 'video';
        if (!contentUrl) {
          contentUrl = mediaItems[0].url;
          previewUrl = mediaItems[0].previewUrl;
          posterUrl = mediaItems[0].posterUrl; // NEW: Set posterUrl for single video
        }
      }

      // Render writeUp with tagged users
      const renderedWriteUp = renderTaggedWriteUp(writeUp, taggedUsersWithDetails);

      // Create post
      const post = new Post({
        creator: req.user._id,
        mediaItems,
        type: postType,
        writeUp,
        special: isSpecial,
        unlockPrice: isSpecial ? unlockPrice : undefined,
        contentUrl,
        previewUrl,
        posterUrl, // NEW: Save posterUrl for single video posts
        taggedUsers,
        renderedWriteUp,
        category,
      });

      await post.save();
      logger.info(`Saved post: ${post._id}, type: ${post.type}, media count: ${mediaItems.length}, taggedUsers: ${taggedUsers.length}, category: ${category}`);

      // Update user counts
      const imageCount = mediaItems.filter(item => item.type === 'image').length;
      const videoCount = mediaItems.filter(item => item.type === 'video').length;

      if (imageCount > 0 || videoCount > 0) {
        await User.findByIdAndUpdate(req.user._id, {
          $inc: {
            imagesCount: imageCount,
            videosCount: videoCount,
          },
        });
      }

      // Notify subscribers
      const creatorId = req.user._id;
      const creator = await User.findById(creatorId);
      const subscribers = await User.find({
        'subscriptions.creatorId': creatorId,
        'subscriptions.status': 'active',
      });

      for (const subscriber of subscribers) {
        const message = `New post from ${creator.username}!`;
        await Notification.create({
          user: subscriber._id,
          message,
          type: 'new_post',
          postId: post._id,
          creatorId: creator._id,
          creatorName: creator.username,
        });
      }

      // Notify tagged users
      for (const taggedUserId of taggedUsers) {
        await Notification.create({
          user: taggedUserId,
          message: `You were tagged in a post by ${creator.username}!`,
          type: 'tag',
          postId: post._id,
          creatorId: creator._id,
          creatorName: creator.username,
        });
      }

      req.flash('success_msg', 'Content uploaded successfully');
      res.redirect('/profile');
    } catch (err) {
      logger.error(`Error uploading content: ${err.message}, Stack: ${err.stack}`);
      req.flash('error_msg', 'Error uploading content');
      res.status(500).redirect('/profile');
    }
  }
);
// Route to manage post categories (add, edit, delete)
router.post('/manage-categories', authCheck, async (req, res) => {
  if (req.user.role !== 'creator') {
    logger.warn('Unauthorized category management attempt by non-creator');
    return res.status(403).json({ status: 'error', message: 'Only creators can manage categories.' });
  }

  try {
    const { action, category, newCategory } = req.body;
    const user = await User.findById(req.user._id);

    if (action === 'add') {
      if (!category || typeof category !== 'string' || category.trim() === '') {
        return res.status(400).json({ status: 'error', message: 'Category name is required.' });
      }
      const trimmedCategory = category.trim();
      if (user.postCategories.includes(trimmedCategory)) {
        return res.status(400).json({ status: 'error', message: 'Category already exists.' });
      }
      if (user.postCategories.length >= 10) { // Limit to 10 categories
        return res.status(400).json({ status: 'error', message: 'Maximum of 10 categories allowed.' });
      }
      user.postCategories.push(trimmedCategory);
      await user.save();
      return res.json({ status: 'success', message: 'Category added successfully.' });
    }

    if (action === 'edit') {
      if (!category || !newCategory || typeof newCategory !== 'string' || newCategory.trim() === '') {
        return res.status(400).json({ status: 'error', message: 'Current and new category names are required.' });
      }
      const trimmedNewCategory = newCategory.trim();
      const index = user.postCategories.indexOf(category);
      if (index === -1) {
        return res.status(404).json({ status: 'error', message: 'Category not found.' });
      }
      if (user.postCategories.includes(trimmedNewCategory)) {
        return res.status(400).json({ status: 'error', message: 'New category name already exists.' });
      }
      user.postCategories[index] = trimmedNewCategory;
      await Post.updateMany(
        { creator: user._id, category },
        { $set: { category: trimmedNewCategory } }
      );
      await user.save();
      return res.json({ status: 'success', message: 'Category updated successfully.' });
    }

    if (action === 'delete') {
      if (!category) {
        return res.status(400).json({ status: 'error', message: 'Category name is required.' });
      }
      const index = user.postCategories.indexOf(category);
      if (index === -1) {
        return res.status(404).json({ status: 'error', message: 'Category not found.' });
      }
      user.postCategories.splice(index, 1);
      await Post.updateMany(
        { creator: user._id, category },
        { $set: { category: null } }
      );
      await user.save();
      return res.json({ status: 'success', message: 'Category deleted successfully.' });
    }

    return res.status(400).json({ status: 'error', message: 'Invalid action.' });
  } catch (err) {
    logger.error(`Error managing categories: ${err.message}`);
    return res.status(500).json({ status: 'error', message: 'Error managing categories.' });
  }
});
// Report a post
router.post('/report-post', authCheck, async (req, res) => {
  try {
    const { postId, reason, details } = req.body;
    const userId = req.user._id;

    // Validate post exists
    const post = await Post.findById(postId);
    if (!post) {
      logger.warn(`Post not found for report: ${postId}`);
      return res.status(404).json({ status: 'error', message: 'Post not found.' });
    }

    // Create report
    const report = new Report({
      user: userId,
      post: postId,
      reason,
      details
    });

    await report.save();
    logger.info(`Post reported: ${postId} by user ${userId}`);
    res.json({ status: 'success', message: 'Report submitted successfully.' });
  } catch (err) {
    logger.error(`Error reporting post: ${err.message}`);
    res.status(500).json({ status: 'error', message: 'Error submitting report.' });
  }
});
// Delete post route
router.post('/delete-post/:postId', authCheck, async (req, res) => {
  
  try {
    const post = await Post.findOne({ _id: req.params.postId, creator: req.user._id });
    if (!post) {
      logger.warn('Post not found or unauthorized in delete-post/:postId');
      req.flash('error_msg', 'Post not found or you are not authorized to delete it');
      return res.status(404).redirect('/profile');
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      logger.error('User not found in delete-post/:postId');
      req.flash('error_msg', 'User not found');
      return res.status(404).redirect('/profile');
    }

    // Update counts
    const updates = {};
    if (post.type === 'image') updates.imagesCount = -1;
    else if (post.type === 'video') updates.videosCount = -1;
    if (post.likes.length > 0) updates.totalLikes = -post.likes.length;

    if (Object.keys(updates).length > 0) {
      await User.findByIdAndUpdate(req.user._id, { $inc: updates });
    }

    await Post.deleteOne({ _id: post._id });

    req.flash('success_msg', 'Post deleted successfully');
    res.redirect('/profile');
  } catch (err) {
    logger.error(`Error deleting post: ${err.message}`);
    req.flash('error_msg', 'Error deleting post');
    res.status(500).redirect('/profile');
  }
});

// Admin delete post with reason
router.post('/admin-delete-post/:postId', authCheck, async (req, res) => {
  
  try {
    if (req.user.role !== 'admin') {
      logger.warn('Unauthorized admin delete attempt by non-admin');
      req.flash('error_msg', 'Only admins can delete posts');
      return res.status(403).redirect('/profile');
    }

    const { reason } = req.body;
    if (!reason || reason.trim() === '') {
      logger.warn('Reason for deletion missing in admin-delete-post/:postId');
      req.flash('error_msg', 'Reason for deletion is required');
      return res.status(400).redirect('/profile');
    }

    const post = await Post.findById(req.params.postId).populate('creator', 'username _id');
    if (!post || !post.creator) {
      logger.warn('Post or creator not found in admin-delete-post/:postId');
      req.flash('error_msg', 'Post or creator not found');
      return res.status(404).redirect('/profile');
    }

    const creator = post.creator;

    // Update counts
    const updates = {};
    if (post.type === 'image') updates.imagesCount = -1;
    else if (post.type === 'video') updates.videosCount = -1;
    if (post.likes.length > 0) updates.totalLikes = -post.likes.length;

    if (Object.keys(updates).length > 0) {
      await User.findByIdAndUpdate(creator._id, { $inc: updates });
    }

    // Create deletion log
    const PostDeletionLog = require('../models/PostDeletionLog');
    await PostDeletionLog.create({
      postId: post._id,
      creatorId: creator._id,
      creatorName: creator.username,
      adminId: req.user._id,
      adminName: req.user.username,
      reason,
    });

    // Delete the post
    await Post.deleteOne({ _id: post._id });

    // Notify the creator
    await Notification.create({
      user: creator._id,
      message: `Your post was deleted by an admin. Reason: ${reason}`,
      type: 'post_deletion',
      postId: post._id,
      creatorId: req.user._id,
      creatorName: req.user.username,
    });

    req.flash('success_msg', 'Post deleted successfully');
    res.redirect(`/profile/view/${creator._id}?adminView=true`);
  } catch (err) {
    logger.error(`Error deleting post by admin: ${err.message}`);
    req.flash('error_msg', 'Error deleting post');
    res.status(500).redirect('/profile');
  }
});

// Create a new subscription bundle
router.post('/create-bundle', authCheck, upload.none(), async (req, res) => {
  try {
    logger.info(`Create bundle request: Method=${req.method}, URL=${req.originalUrl}, Headers=${JSON.stringify(req.headers)}, Body=${JSON.stringify(req.body)}`);

    if (req.user.role !== 'creator') {
      logger.warn('Unauthorized bundle creation attempt by non-creator');
      if (req.is('json')) {
        return res.status(403).json({ status: 'error', message: 'Only creators can create bundles.' });
      }
      return res.status(403).send('Only creators can create bundles.');
    }

    const hasFreeBundle = await SubscriptionBundle.findOne({
      creatorId: req.user._id,
      isFree: true,
    });
    if (hasFreeBundle) {
      logger.warn('Cannot create paid bundle while free bundle is active');
      if (req.is('json')) {
        return res.status(400).json({
          status: 'error',
          message: 'Cannot create paid bundles while free subscription is enabled.',
        });
      }
      req.flash('error_msg', 'Cannot create paid bundles while free subscription is enabled.');
      return res.redirect('/profile');
    }

    const existingCount = await SubscriptionBundle.countDocuments({
      creatorId: req.user._id,
    });
    if (existingCount >= 4) {
      logger.warn('Maximum bundle limit reached in create-bundle');
      if (req.is('json')) {
        return res.status(400).json({ status: 'error', message: 'You have reached the maximum of 4 bundles.' });
      }
      return res.status(400).send('You have reached the maximum of 4 bundles.');
    }

    const { price, duration: rawDuration, description, discountPercentage } = req.body;
    const duration = rawDuration ? rawDuration.toLowerCase() : null;

    if (!duration) {
      logger.warn('Duration is missing in create-bundle');
      if (req.is('json')) {
        return res.status(400).json({ status: 'error', message: 'Duration is required.' });
      }
      req.flash('error_msg', 'Duration is required.');
      return res.status(400).redirect('/profile');
    }

    const validDurations = ['1 day', '1 month', '3 months', '6 months', '1 year'];
    if (!validDurations.includes(duration)) {
      logger.warn(`Invalid duration in create-bundle: ${duration}`);
      if (req.is('json')) {
        return res.status(400).json({
          status: 'error',
          message: `Invalid duration selected. Must be one of: ${validDurations.join(', ')}`,
        });
      }
      req.flash('error_msg', `Invalid duration selected. Must be one of: ${validDurations.join(', ')}`);
      return res.status(400).redirect('/profile');
    }

    if (!description || typeof description !== 'string' || description.trim() === '') {
      logger.warn('Invalid description in create-bundle');
      if (req.is('json')) {
        return res.status(400).json({ status: 'error', message: 'Description is required.' });
      }
      req.flash('error_msg', 'Description is required.');
      return res.status(400).redirect('/profile');
    }

    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      logger.warn('Invalid price in create-bundle');
      if (req.is('json')) {
        return res.status(400).json({ status: 'error', message: 'Price must be a positive number.' });
      }
      req.flash('error_msg', 'Price must be a positive number.');
      return res.status(400).redirect('/profile');
    }

    const parsedDiscount = discountPercentage ? parseFloat(discountPercentage) : 0;
    if (parsedDiscount < 0 || parsedDiscount > 100) {
      logger.warn('Invalid discount percentage in create-bundle');
      if (req.is('json')) {
        return res.status(400).json({
          status: 'error',
          message: 'Discount percentage must be between 0 and 100.',
        });
      }
      req.flash('error_msg', 'Discount percentage must be between 0 and 100.');
      return res.status(400).redirect('/profile');
    }

    const durationOrder = {
      '1 day': 1,
      '1 month': 2,
      '3 months': 3,
      '6 months': 4,
      '1 year': 5,
    };

    let finalPrice = parsedPrice;
    let originalPrice = null;
    if (parsedDiscount > 0) {
      originalPrice = parsedPrice;
      finalPrice = Math.round(parsedPrice * (1 - parsedDiscount / 100));
    }

    const bundle = new SubscriptionBundle({
      price: finalPrice,
      duration,
      durationWeight: durationOrder[duration],
      description: description.trim(),
      creatorId: req.user._id,
      discountPercentage: parsedDiscount,
      originalPrice,
    });

    await bundle.save();
    logger.info(`Bundle created successfully: ${bundle._id}`);

    // Set flash message for traditional form submissions
    req.flash('success_msg', 'Bundle created successfully');

    // For AJAX requests, return JSON; for others, redirect
    if (req.is('json')) {
      return res.json({
        status: 'success',
        message: 'Bundle created successfully',
        redirect: '/profile',
      });
    }

    // Save session and redirect for traditional submissions
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Session save timed out'));
      }, 5000); // 5-second timeout
      req.session.save((err) => {
        clearTimeout(timeout);
        if (err) {
          logger.error(`Session save error: ${err.message}, Stack: ${err.stack}`);
          reject(err);
        } else {
          logger.info(`Session saved successfully for bundle creation`);
          resolve();
        }
      });
    });

    return res.redirect('/profile');
  } catch (err) {
    logger.error(`Error creating bundle: ${err.message}, Stack: ${err.stack}`);
    if (req.is('json')) {
      return res.status(500).json({
        status: 'error',
        message: `Error creating bundle: ${err.message}`,
      });
    }
    req.flash('error_msg', `Error creating bundle: ${err.message}`);
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Session save timed out in catch block'));
        }, 5000);
        req.session.save((err) => {
          clearTimeout(timeout);
          if (err) {
            logger.error(`Session save error in catch block: ${err.message}, Stack: ${err.stack}`);
            reject(err);
          } else {
            resolve();
          }
        });
      });
      return res.redirect('/profile');
    } catch (sessionErr) {
      logger.error(`Failed to save session in catch block: ${sessionErr.message}, Stack: ${sessionErr.stack}`);
      return res.status(500).send('Error creating bundle: Session save failed');
    }
  }
});
router.post('/edit-bundle/:bundleId', authCheck, upload.none(), async (req, res) => {
  try {
    const { bundleId } = req.params;
    const { price, discountPercentage, description } = req.body;
    const parsedPrice = parseFloat(price);
    const parsedDiscount = discountPercentage ? parseFloat(discountPercentage) : 0;

    console.log('Received edit-bundle request:', {
      bundleId,
      price,
      description,
      discountPercentage,
      parsedPrice,
      parsedDiscount,
    });

    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      console.warn('Invalid price:', price);
      return res.status(400).json({
        status: 'error',
        message: 'Price must be a positive number.',
      });
    }

    if (parsedDiscount < 0 || parsedDiscount > 100) {
      console.warn('Invalid discount percentage:', discountPercentage);
      return res.status(400).json({
        status: 'error',
        message: 'Discount percentage must be between 0 and 100.',
      });
    }

    if (!description || typeof description !== 'string' || description.trim() === '') {
      console.warn('Invalid description:', description);
      return res.status(400).json({
        status: 'error',
        message: 'Description is required.',
      });
    }

    const bundle = await SubscriptionBundle.findOne({
      _id: bundleId,
      creatorId: req.user._id,
    });

    if (!bundle) {
      console.warn('Bundle not found or unauthorized:', { bundleId, creatorId: req.user._id });
      return res.status(404).json({
        status: 'error',
        message: 'Bundle not found or you are not authorized to edit it.',
      });
    }

    console.log('Current bundle state:', {
      _id: bundle._id,
      isFree: bundle.isFree,
      duration: bundle.duration,
      durationWeight: bundle.durationWeight,
      price: bundle.price,
      discountPercentage: bundle.discountPercentage,
      originalPrice: bundle.originalPrice,
    });

    // Update bundle fields
    bundle.description = description.trim();
    bundle.discountPercentage = parsedDiscount;

    if (parsedDiscount > 0) {
      // Apply discount: update price to discounted amount
      bundle.originalPrice = parsedPrice; // Store original price
      bundle.price = Math.round(parsedPrice * (1 - parsedDiscount / 100)); // Set discounted price
    } else {
      // Remove discount: restore original price or use input price
      bundle.price = bundle.originalPrice || parsedPrice; // Use originalPrice if available
      bundle.originalPrice = null; // Clear originalPrice
      bundle.discountPercentage = 0; // Ensure no discount
    }

    const durationOrder = {
      '1 day': 1,
      '1 month': 2,
      '3 months': 3,
      '6 months': 4,
      '1 year': 5,
    };

    if (!bundle.isFree) {
      if (bundle.duration && durationOrder[bundle.duration]) {
        bundle.durationWeight = durationOrder[bundle.duration];
        console.log('Set durationWeight:', bundle.durationWeight);
      } else {
        console.warn('Invalid or missing duration for bundle:', {
          bundleId,
          duration: bundle.duration,
        });
        return res.status(400).json({
          status: 'error',
          message: 'Bundle duration is invalid or missing. Please contact support.',
        });
      }
    } else {
      bundle.duration = undefined;
      bundle.durationWeight = undefined;
      console.log('Cleared duration and durationWeight for free bundle');
    }

    await bundle.save();
    console.log('Bundle updated successfully:', {
      bundleId,
      price: bundle.price,
      discountPercentage: bundle.discountPercentage,
      originalPrice: bundle.originalPrice,
    });

    return res.json({
      status: 'success',
      message: 'Bundle updated successfully.',
    });
  } catch (err) {
    console.error('Error updating bundle:', {
      bundleId: req.params.bundleId,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      status: 'error',
      message: 'Failed to update bundle. Please try again.',
    });
  }
});


router.post('/delete-bundle/:bundleId', authCheck, async (req, res) => {
  try {
    const bundle = await SubscriptionBundle.findById(req.params.bundleId);
    if (!bundle) {
      logger.warn('Bundle not found in delete-bundle/:bundleId');
      return res.status(404).send('Bundle not found');
    }

    if (bundle.creatorId.toString() !== req.user._id.toString()) {
      logger.warn('Unauthorized bundle deletion attempt in delete-bundle/:bundleId');
      return res.status(403).send('You do not have permission to delete this bundle');
    }

    await SubscriptionBundle.findByIdAndDelete(bundle._id);

    req.flash('success_msg', 'Bundle deleted successfully');
    res.redirect('/profile');
  } catch (err) {
    logger.error(`Error deleting bundle: ${err.message}`);
    req.flash('error_msg', 'Error deleting bundle');
    res.status(500).redirect('/profile');
  }
});

// POST /profile/subscribe-free (subscribe to a free bundle)
// POST /profile/subscribe-free
router.post('/subscribe-free', authCheck, async (req, res) => {
  try {
    const { creatorId, creatorUsername } = req.body;

    if (!creatorId || !creatorUsername) {
      logger.warn('Missing creatorId or creatorUsername in subscribe-free');
      return res.status(400).json({
        status: 'error',
        message: 'Creator ID and Creator Username are required',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(creatorId)) {
      logger.error(`Invalid creatorId: ${creatorId} in subscribe-free`);
      return res.status(400).json({
        status: 'error',
        message: 'Invalid ID format',
      });
    }

    const creator = await User.findById(creatorId);
    if (!creator || creator.username !== creatorUsername || creator.role !== 'creator') {
      logger.warn('Creator not found, username mismatch, or not a creator in subscribe-free');
      return res.status(404).json({
        status: 'error',
        message: 'Creator not found or not a valid creator',
      });
    }

    if (!creator.freeSubscriptionEnabled) {
      logger.warn('Free subscription not enabled for creator in subscribe-free');
      return res.status(400).json({
        status: 'error',
        message: 'Free subscription is not available for this creator',
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      logger.error('User not found in subscribe-free');
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    const now = new Date();
    const isSubscribed = user.subscriptions.some(
      (sub) =>
        sub.creatorId.toString() === creatorId &&
        sub.status === 'active' &&
        (!sub.subscriptionExpiry || sub.subscriptionExpiry > now)
    );
    if (isSubscribed) {
      logger.warn(`User ${user._id} already subscribed to creator ${creatorId} in subscribe-free`);
      return res.status(400).json({
        status: 'error',
        message: 'You are already subscribed to this creator',
      });
    }

    if (!user.subscriptions) user.subscriptions = [];
    if (!creator.subscriptions) {
      creator.subscriptions = [];
      await creator.save();
    }

    let freeBundle = await SubscriptionBundle.findOne({
      creatorId: creator._id,
      isFree: true,
    });
    if (!freeBundle) {
      freeBundle = new SubscriptionBundle({
        price: 0,
        currency: 'NGN',
        description: 'Free subscription to access creator content',
        creatorId: creator._id,
        isFree: true,
      });
      await freeBundle.save();
      logger.info(`Created free bundle for creator: ${creatorId}`);
    }

    const subscriptionData = {
      creatorId,
      subscriptionBundle: freeBundle._id,
      subscribedAt: new Date(),
      subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      status: 'active',
    };
    user.subscriptions.push(subscriptionData);
    await user.save();

    await Notification.create({
      user: creatorId,
      message: `${user.username} just subscribed to your free plan!`,
      type: 'new_subscription',
    });

    await creator.updateSubscriberCount();

    return res.json({
      status: 'success',
      message: 'Subscribed successfully for free',
      redirect: `/profile/${creatorUsername}`,
    });
  } catch (err) {
    logger.error(`Error processing free subscription for creator ${req.body.creatorId}: ${err.message}`);
    return res.status(500).json({
      status: 'error',
      message: 'Error processing free subscription',
    });
  }
});

// POST /profile/subscribe
router.post('/subscribe', async (req, res) => {
  try {
    const { creatorId, bundleId, creatorUsername } = req.body;

    if (!creatorId || !bundleId || !creatorUsername) {
      logger.warn('Missing creatorId, bundleId, or creatorUsername in subscribe');
      return res.status(400).json({
        status: 'error',
        message: 'Creator ID, Bundle ID, and Creator Username are required',
      });
    }

    const creator = await User.findById(creatorId);
    if (!creator || creator.username !== creatorUsername || creator.role !== 'creator') {
      logger.warn('Creator not found, username mismatch, or not a creator in subscribe');
      return res.status(404).json({
        status: 'error',
        message: 'Creator not found or not a valid creator',
      });
    }

    const bundle = await SubscriptionBundle.findById(bundleId);
    if (!bundle) {
      logger.warn('Bundle not found in subscribe');
      return res.status(404).json({
        status: 'error',
        message: 'Subscription bundle not found',
      });
    }
    if (!bundle.creatorId.equals(creator._id)) {
      logger.warn(`Bundle ${bundleId} does not belong to creator ${creatorId} in subscribe`);
      return res.status(400).json({
        status: 'error',
        message: 'Invalid bundle for this creator',
      });
    }

    if (!req.user) {
      const redirectUrl = `/profile/${encodeURIComponent(creator.username)}`;
      req.session.redirectTo = redirectUrl;
      req.session.creator = creator.username;
      req.session.subscriptionData = { creatorId, bundleId };

      const pendingSub = await PendingSubscription.findOneAndUpdate(
        { sessionId: req.sessionID },
        {
          sessionId: req.sessionID,
          creatorUsername: creator.username,
          creatorId,
          bundleId,
          createdAt: new Date(),
          isFree: bundle.isFree,
        },
        { upsert: true, new: true }
      );

      await new Promise((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            logger.error(`Session save error in subscribe: ${err.message}`);
            reject(err);
          } else {
            resolve();
          }
        });
      });

      const welcomeUrl = `/?creator=${encodeURIComponent(creator.username)}`;
      return res.redirect(welcomeUrl);
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      logger.error('User not found in subscribe');
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    let changed = false;
    const now = new Date();
    user.subscriptions.forEach((sub) => {
      if (sub.status === 'active' && sub.subscriptionExpiry && sub.subscriptionExpiry <= now) {
        sub.status = 'expired';
        changed = true;
      }
    });
    if (changed) await user.save();

    const isSubscribed = user.subscriptions.some(
      (sub) =>
        sub.creatorId.toString() === creatorId &&
        sub.status === 'active' &&
        (!sub.subscriptionExpiry || sub.subscriptionExpiry > now)
    );
    if (isSubscribed) {
      logger.warn('User already subscribed to creator in subscribe');
      return res.status(400).json({
        status: 'error',
        message: 'You are already subscribed to this creator',
      });
    }

    if (bundle.isFree) {
      if (!user.subscriptions) user.subscriptions = [];
      const subscription = {
        creatorId: creator._id,
        subscriptionBundle: bundle._id,
        subscribedAt: new Date(),
        subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        status: 'active',
      };
      user.subscriptions.push(subscription);
      await user.save();
      await Notification.create({
        user: creatorId,
        message: `${user.username} just subscribed to your free plan!`,
        type: 'new_subscription',
      });
      await creator.updateSubscriberCount();
      logger.info(`User ${user._id} subscribed to free bundle ${bundleId} for creator ${creatorId}`);
      return res.json({
        status: 'success',
        message: 'Subscribed successfully for free',
        redirect: `/profile/${creator.username}`,
      });
    }

    const paymentResponse = await flutter.initializePayment(
      req.user._id,
      creatorId,
      bundleId,
      bundle.price
    );

    if (paymentResponse.status === 'success' && paymentResponse.meta?.authorization) {
      const authorization = paymentResponse.meta.authorization;
      await User.findByIdAndUpdate(req.user._id, {
        $push: {
          pendingTransactions: {
            tx_ref: authorization.transfer_reference || `SUB_${Date.now()}_${creatorId}_${bundleId}`,
            creatorId,
            bundleId,
            amount: bundle.price,
            status: 'pending',
            createdAt: new Date(),
            type: 'subscription',
          },
        },
      });

      return res.json({
        status: 'success',
        message: 'Payment initialized successfully',
        data: {
          transferDetails: {
            accountNumber: authorization.transfer_account || null,
            bankName: authorization.transfer_bank || null,
            amount: authorization.transfer_amount || bundle.price,
            reference: authorization.transfer_reference,
            accountExpiration: authorization.account_expiration || null,
            transferNote: authorization.transfer_note || null,
          },
          subscription: {
            creator: { id: creator._id, username: creator.username },
            bundle: { name: bundle.name, price: bundle.price, duration: bundle.duration },
          },
          paymentLink: authorization.payment_link || null,
        },
      });
    } else {
      logger.error(
        `Payment initialization failed in subscribe: ${paymentResponse.message || 'Unknown error'}`
      );
      return res.status(400).json({
        status: 'error',
        message: paymentResponse.message || 'Payment initialization failed',
      });
    }
  } catch (err) {
    logger.error(`Subscription error: ${err.message}`);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while processing your subscription',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});
// Toggle free subscription mode
router.post('/toggle-free-subscription', authCheck, async (req, res) => {
  try {
    if (req.user.role !== 'creator') {
      logger.warn('Unauthorized free subscription toggle attempt by non-creator');
      const errorMsg = 'Only creators can toggle free subscriptions.';
      if (req.headers['content-type'] === 'application/json') {
        return res.status(403).json({ status: 'error', message: errorMsg });
      }
      req.flash('error_msg', errorMsg);
      return res.status(403).redirect('/profile');
    }

    const user = await User.findById(req.user._id);
    const existingFreeBundle = await SubscriptionBundle.findOne({
      creatorId: req.user._id,
      isFree: true,
    });

    let message;
    if (existingFreeBundle) {
      // Disable free subscription
      logger.info(`Disabling free bundle ${existingFreeBundle._id} for creator ${req.user._id}`);
      await SubscriptionBundle.deleteOne({ _id: existingFreeBundle._id });

      // Find all users with active free subscriptions to this creator
      const subscribers = await User.find({
        'subscriptions.creatorId': req.user._id,
        'subscriptions.subscriptionBundle': existingFreeBundle._id,
        'subscriptions.status': 'active',
      });

      // Update subscriptions and clean up bookmarks
      const now = new Date();
      const updatePromises = subscribers.map(async (subscriber) => {
        let subscriptionsChanged = false;
        subscriber.subscriptions.forEach((sub) => {
          if (
            sub.creatorId.toString() === req.user._id.toString() &&
            sub.subscriptionBundle.toString() === existingFreeBundle._id.toString() &&
            sub.status === 'active'
          ) {
            sub.status = 'expired';
            sub.subscriptionExpiry = now; // Set expiry to now to ensure immediate expiration
            subscriptionsChanged = true;
          }
        });
        if (subscriptionsChanged) {
          await subscriber.save(); // Triggers pre('save') hook
          await subscriber.removeBookmarksForExpiredSubscriptions(); // Clean bookmarks
        }
      });

      await Promise.all(updatePromises);
      user.freeSubscriptionEnabled = false;
      await user.save();
      await user.updateSubscriberCount();
      logger.info(`Expired free subscriptions for ${subscribers.length} users`);

      message = 'Free subscription mode disabled. You can now create paid bundles.';
    } else {
      // Enable free subscription: delete all existing paid bundles
      logger.info(`Enabling free subscription for creator ${req.user._id}`);
      await SubscriptionBundle.deleteMany({
        creatorId: req.user._id,
        isFree: false,
      });
      const freeBundle = new SubscriptionBundle({
        price: 0,
        description: 'Free access to all content',
        creatorId: req.user._id,
        isFree: true,
      });
      await freeBundle.save();
      user.freeSubscriptionEnabled = true;
      await user.save();
      logger.info(`Created free bundle ${freeBundle._id}`);
      message = 'Free subscription mode enabled. All paid bundles have been removed.';
    }

    if (req.headers['content-type'] === 'application/json') {
      return res.json({
        status: 'success',
        message,
        freeSubscriptionEnabled: user.freeSubscriptionEnabled,
      });
    }

    req.flash('success_msg', message);
    res.redirect('/profile');
  } catch (err) {
    logger.error(`Error toggling free subscription: ${err.message}`);
    const errorMsg = 'Error toggling free subscription';
    if (req.headers['content-type'] === 'application/json') {
      return res.status(500).json({ status: 'error', message: errorMsg });
    }
    req.flash('error_msg', errorMsg);
    res.status(500).redirect('/profile');
  }
});
// Webhook route to handle payment notifications
router.post('/webhook', async (req, res) => {
 
  try {
    const event = req.body;

    if (event.event === 'charge.success') {
      // Find user, creator, and bundle from event metadata
      const user = await User.findById(event.metadata.user_id);
      const creator = await User.findById(event.metadata.creator_id);
      const bundle = await SubscriptionBundle.findById(event.metadata.bundle_id);

      if (!user || !creator || !bundle) {
        logger.error('User, creator, or bundle not found in webhook');
        return res.status(404).send('User, creator, or bundle not found.');
      }

      // Parse bundle.duration into milliseconds
      let subscriptionExpiry = new Date();
      if (bundle.duration === '1 day') {
        subscriptionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      } else if (bundle.duration === '1 month') {
        subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      } else if (bundle.duration === '3 months') {
        subscriptionExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      } else if (bundle.duration === '6 months') {
        subscriptionExpiry = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
      } else if (bundle.duration === '1 year') {
        subscriptionExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      }

      // Create a new subscription object
      const subscription = {
        creatorId: creator._id,
        subscriptionBundle: bundle._id,
        subscribedAt: new Date(),
        subscriptionExpiry,
        status: 'active',
      };

      // Push the subscription to the user
      user.subscriptions.push(subscription);
      await user.save();

      res.send('Webhook received and processed!');
    } else {
      res.send('Webhook received but not processed!');
    }
  } catch (err) {
    logger.error(`Error processing webhook: ${err.message}`);
    res.status(500).send('Error processing webhook');
  }
});
// GET creator suggestions based on query
router.get('/creator-suggestions', async (req, res) => {
  try {
    const query = req.query.q || '';
    if (!query) {
      return res.json([]);
    }

    // Search for creators by username or profileName, case-insensitive
    const creators = await User.find({
      role: 'creator',
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { profileName: { $regex: query, $options: 'i' } },
      ],
    })
      .select('username profileName profilePicture _id')
      .limit(5); // Limit to 5 suggestions

    res.json(
      creators.map((creator) => ({
        id: creator._id,
        username: creator.username,
        profileName: creator.profileName,
        profilePicture: creator.profilePicture,
      }))
    );
  } catch (error) {
    logger.error(`Error fetching creator suggestions: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});
// View another user's profile by username
router.get('/:username', async (req, res) => {
  logger.info(`Request URL: ${req.originalUrl}, Route: /:username, Referer: ${req.get('Referer') || 'none'}`);
  try {
    const username = req.params.username;
    logger.info(`Attempting to view profile for username: ${username}`);
    const ownerUser = await User.findOne({ username: { $regex: `^${username}$`, $options: 'i' } });
    if (!ownerUser) {
      logger.warn(`User not found for username: ${username}`);
      if (req.is('json')) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
      }
      return res.status(404).send('User not found');
    }
    logger.info(`Found user: ${ownerUser._id}, username: ${ownerUser.username}`);

    await ownerUser.checkExpiredSubscriptions();
    await ownerUser.updateSubscriberCount();

    const isOwnProfile = req.user ? req.user._id.toString() === ownerUser._id.toString() : false;
    const adminView = req.user && req.query.adminView === 'true' && req.user.role === 'admin';

    // Define and validate subtab
    const validSubtabs = ['all', 'images', 'videos', ...(ownerUser.postCategories || [])];
    const subtab = validSubtabs.includes(req.query.subtab) ? req.query.subtab : 'all';
    logger.debug(`Defined subtab: ${subtab}, req.query: ${JSON.stringify(req.query)}`);

    let isSubscribed = false;
    if (req.user && !isOwnProfile && ownerUser.role === 'creator') {
      const now = new Date();
      isSubscribed = req.user.subscriptions.some(
        (sub) =>
          sub.creatorId.toString() === ownerUser._id.toString() &&
          sub.status === 'active' &&
          sub.subscriptionExpiry > now
      );
    }

    const bundles =
      ownerUser.role === 'creator'
        ? await SubscriptionBundle.find({ creatorId: ownerUser._id }).sort({
            isFree: -1,
            durationWeight: 1,
          })
        : [];

    let posts = [];
    if (req.user && (isOwnProfile || isSubscribed || adminView)) {
      const sortBy = req.query.sortBy || 'createdAt';
      const order = req.query.order || 'desc';

      logger.debug(`req.query: ${JSON.stringify(req.query)}`);

      const validSortFields = ['createdAt', 'totalTips', 'likes'];
      const validOrders = ['asc', 'desc'];

      const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
      const sortOrder = validOrders.includes(order) ? order : 'desc';

      let sortCriteria = {};
      if (sortField === 'likes') {
        sortCriteria = { likesCount: sortOrder === 'desc' ? -1 : 1 };
      } else {
        sortCriteria[sortField] = sortOrder === 'desc' ? -1 : 1;
      }

      let postsQuery = Post.find({ creator: ownerUser._id })
        .populate('comments.user', 'username')
        .populate('taggedUsers', 'username');

      if (subtab !== 'all') {
        if (subtab === 'images') {
          postsQuery = postsQuery.where('type').equals('image');
        } else if (subtab === 'videos') {
          postsQuery = postsQuery.where('type').equals('video');
        } else {
          postsQuery = postsQuery.where('category').equals(subtab);
        }
      }

      if (sortField === 'likes') {
        const postsAgg = await Post.aggregate([
          {
            $match: {
              creator: new mongoose.Types.ObjectId(ownerUser._id),
              ...(subtab !== 'all'
                ? subtab === 'images'
                  ? { type: 'image' }
                  : subtab === 'videos'
                  ? { type: 'video' }
                  : { category: subtab }
                : {}),
            },
          },
          {
            $addFields: {
              likesCount: { $size: { $ifNull: ['$likes', []] } },
            },
          },
          { $sort: sortCriteria },
          {
            $project: {
              _id: 1,
            },
          },
        ]);
        const postIds = postsAgg.map((p) => p._id);
        posts = await Post.find({ _id: { $in: postIds } })
          .populate('comments.user', 'username')
          .populate('taggedUsers', 'username')
          .setOptions({ sort: { _id: 1 } })
          .exec();
        posts = postIds
          .map((id) => posts.find((p) => p._id.toString() === id.toString()))
          .filter((p) => p);
      } else {
        postsQuery = postsQuery.sort(sortCriteria);
        posts = await postsQuery;
      }

      try {
        await processPostUrls(posts, req.user, ownerUser, adminView);
      } catch (err) {
        logger.error(`Error in processPostUrls: ${err.message}, Stack: ${err.stack}`);
        throw err;
      }

      logger.info(`Fetched ${posts.length} posts for user ${ownerUser.username}`, {
        postTypes: posts.map((p) => p.type),
        categories: posts.map((p) => p.category || 'null'),
        createdAt: posts.map((p) => p.createdAt ? p.createdAt.toISOString() : null),
        sortBy: sortField,
        order: sortOrder,
        subtab,
      });
    }

    const user = {
      _id: ownerUser._id,
      username: ownerUser.username,
      profileName: ownerUser.profileName,
      profilePicture: ownerUser.profilePicture,
      coverPhoto: ownerUser.coverPhoto,
      bio: ownerUser.bio,
      role: ownerUser.role,
      isOnline: ownerUser.isOnline,
      lastSeen: ownerUser.lastSeen,
      imagesCount: ownerUser.imagesCount || 0,
      videosCount: ownerUser.videosCount || 0,
      totalLikes: ownerUser.totalLikes || 0,
      subscriberCount: ownerUser.subscriberCount || 0,
      postCategories: ownerUser.postCategories || [],
    };

    logger.debug(`Rendering profile with subtab: ${subtab}`);
    res.set('Cache-Control', 'no-store');
    res.render('profile', {
      user,
      currentUser: req.user || null,
      posts,
      isSubscribed,
      bundles,
      adminView,
      env: process.env.NODE_ENV || 'development',
      flashMessages: req.flash(),
      activeTab: 'posts',
      activeSubtab: subtab,
    });
  } catch (err) {
    logger.error(`Error loading profile by username: ${err.message}, Stack: ${err.stack}, Username: ${req.params.username}, req.query: ${JSON.stringify(req.query)}`);
    if (process.env.NODE_ENV === 'development') {
      return res.status(500).send(`Error: ${err.message}\nStack: ${err.stack}`);
    }
    if (req.is('json')) {
      return res.status(500).json({ status: 'error', message: 'Error loading profile' });
    }
    return res.status(500).send('Error loading profile');
  }
});
// View a single post
router.get('/:username/post/:postId', async (req, res) => {
  try {
    const { username, postId } = req.params;
    const ownerUser = await User.findOne({ username });
    if (!ownerUser) {
      logger.warn(`User not found for username: ${username} in /:username/post/:postId`);
      req.flash('error_msg', 'User not found');
      return res.status(404).redirect('/profile');
    }

    const post = await Post.findById(postId)
      .populate('creator', 'username profilePicture _id')
      .populate('comments.user', 'username')
      .populate('taggedUsers', 'username'); // Populate taggedUsers
    if (!post || post.creator._id.toString() !== ownerUser._id.toString()) {
      logger.warn(`Post not found or does not belong to user: ${username}, postId: ${postId}`);
      req.flash('error_msg', 'Post not found');
      return res.status(404).redirect('/profile');
    }

    await ownerUser.checkExpiredSubscriptions();
    await ownerUser.updateSubscriberCount();

    const isOwnProfile = req.user ? req.user._id.toString() === ownerUser._id.toString() : false;
    const adminView = req.user && req.query.adminView === 'true' && req.user.role === 'admin';
    let isSubscribed = false;
    if (req.user && !isOwnProfile && ownerUser.role === 'creator') {
      const now = new Date();
      isSubscribed = req.user.subscriptions.some(
        (sub) =>
          sub.creatorId.toString() === ownerUser._id.toString() &&
          sub.status === 'active' &&
          sub.subscriptionExpiry > now
      );
    }

    // Restrict access to non-subscribers (except owners or admins)
    if (!isOwnProfile && !isSubscribed && !adminView) {
      logger.warn(`Access denied to post: ${postId} for non-subscriber`);
      req.flash('error_msg', 'You must be subscribed to view this post');
      return res.redirect(`/profile/${username}`);
    }

    // Process post URLs and render tagged writeUp
    const posts = [post];
    await processPostUrls(posts, req.user || null, ownerUser, adminView);

    // Filter out invalid comments
    post.comments = post.comments.filter((comment) => {
      if (comment.user === null) {
        logger.warn(`Removing invalid comment on post ${post._id}`);
        return false;
      }
      return true;
    });

    // Log post details for debugging
    logger.info(`Fetched single post for user ${ownerUser.username}`, {
      postId: post._id,
      postType: post.type,
      writeUp: post.renderedWriteUp, // Log rendered writeUp
      createdAt: post.createdAt ? post.createdAt.toISOString() : null
    });

    res.set('Cache-Control', 'no-store');
    res.render('single-post', {
      user: {
        username: ownerUser.username
      },
      currentUser: req.user || null,
      post,
      isSubscribed,
      adminView,
      env: process.env.NODE_ENV || 'development',
      flashMessages: req.flash()
    });
  } catch (err) {
    logger.error(`Error loading single post: ${err.message}, Stack: ${err.stack}`);
    req.flash('error_msg', 'Error loading post');
    res.status(500).redirect('/profile');
  }
});
// View another user's profile by ID
router.get('/view/:id', authCheck, async (req, res) => {
  logger.info(`Request URL: ${req.originalUrl}, Route: /view/:id, Referer: ${req.get('Referer') || 'none'}`);
  try {
    const ownerUser = await User.findById(req.params.id);
    if (!ownerUser) {
      logger.warn(`User not found for ID: ${req.params.id}`);
      if (req.is('json')) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
      }
      return res.status(404).send('User not found');
    }
    logger.info(`Found user: ${ownerUser._id}, username: ${ownerUser.username}`);

    await ownerUser.updateSubscriberCount();

    const currentUser = await User.findById(req.user._id);
    if (!currentUser) {
      logger.error(`Current user not found for ID: ${req.user._id}`);
      if (req.is('json')) {
        return res.status(404).json({ status: 'error', message: 'Current user not found' });
      }
      return res.status(404).send('Current user not found');
    }

    await currentUser.checkExpiredSubscriptions();
    const now = new Date();
    const isSubscribed = currentUser.subscriptions.some(
      (sub) =>
        sub.creatorId.toString() === ownerUser._id.toString() &&
        sub.status === 'active' &&
        sub.subscriptionExpiry > now
    );
    const adminView = req.query.adminView && req.user.role === 'admin';

    // Define and validate subtab
    const validSubtabs = ['all', 'images', 'videos', ...(ownerUser.postCategories || [])];
    const subtab = validSubtabs.includes(req.query.subtab) ? req.query.subtab : 'all';
    logger.debug(`Defined subtab: ${subtab}, req.query: ${JSON.stringify(req.query)}`);

    const bundles = await SubscriptionBundle.find({ creatorId: req.params.id }).sort({
      isFree: -1,
      durationWeight: 1,
    });

    let posts = [];
    if (isSubscribed || adminView) {
      const sortBy = req.query.sortBy || 'createdAt';
      const order = req.query.order || 'desc';

      logger.debug(`req.query: ${JSON.stringify(req.query)}`);

      const validSortFields = ['createdAt', 'totalTips', 'likes'];
      const validOrders = ['asc', 'desc'];

      const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
      const sortOrder = validOrders.includes(order) ? order : 'desc';

      let sortCriteria = {};
      if (sortField === 'likes') {
        sortCriteria = { likesCount: sortOrder === 'desc' ? -1 : 1 };
      } else {
        sortCriteria[sortField] = sortOrder === 'desc' ? -1 : 1;
      }

      let postsQuery = Post.find({ creator: ownerUser._id })
        .populate('comments.user', 'username')
        .populate('taggedUsers', 'username');

      if (subtab !== 'all') {
        if (subtab === 'images') {
          postsQuery = postsQuery.where('type').equals('image');
        } else if (subtab === 'videos') {
          postsQuery = postsQuery.where('type').equals('video');
        } else {
          postsQuery = postsQuery.where('category').equals(subtab);
        }
      }

      if (sortField === 'likes') {
        const postsAgg = await Post.aggregate([
          {
            $match: {
              creator: new mongoose.Types.ObjectId(ownerUser._id),
              ...(subtab !== 'all'
                ? subtab === 'images'
                  ? { type: 'image' }
                  : subtab === 'videos'
                  ? { type: 'video' }
                  : { category: subtab }
                : {}),
            },
          },
          {
            $addFields: {
              likesCount: { $size: { $ifNull: ['$likes', []] } },
            },
          },
          { $sort: sortCriteria },
          {
            $project: {
              _id: 1,
            },
          },
        ]);
        const postIds = postsAgg.map((p) => p._id);
        posts = await Post.find({ _id: { $in: postIds } })
          .populate('comments.user', 'username')
          .populate('taggedUsers', 'username')
          .setOptions({ sort: { _id: 1 } })
          .exec();
        posts = postIds
          .map((id) => posts.find((p) => p._id.toString() === id.toString()))
          .filter((p) => p);
      } else {
        postsQuery = postsQuery.sort(sortCriteria);
        posts = await postsQuery;
      }

      for (const post of posts) {
        post.comments = post.comments.filter((comment) => {
          if (comment.user === null) {
            logger.warn(`Removing invalid comment on post ${post._id}`);
            return false;
          }
          return true;
        });
      }

      try {
        await processPostUrls(posts, currentUser, ownerUser, adminView);
      } catch (err) {
        logger.error(`Error in processPostUrls: ${err.message}, Stack: ${err.stack}`);
        throw err;
      }

      logger.info(`Fetched ${posts.length} posts for user ${ownerUser.username}`, {
        postTypes: posts.map((p) => p.type),
        categories: posts.map((p) => p.category || 'null'),
        createdAt: posts.map((p) => p.createdAt ? p.createdAt.toISOString() : null),
        sortBy: sortField,
        order: sortOrder,
        subtab,
      });
    }

    const stats = await Post.aggregate([
      { $match: { creator: new mongoose.Types.ObjectId(req.params.id) } },
      {
        $group: {
          _id: null,
          imagesCount: { $sum: { $cond: [{ $eq: ['$type', 'image'] }, 1, 0] } },
          videosCount: { $sum: { $cond: [{ $eq: ['$type', 'video'] }, 1, 0] } },
          totalLikes: { $sum: { $size: { $ifNull: ['$likes', []] } } },
        },
      },
    ]);

    const imagesCount = stats[0]?.imagesCount || 0;
    const videosCount = stats[0]?.videosCount || 0;
    const totalLikes = stats[0]?.totalLikes || 0;
    const subscriberCount = ownerUser.subscriberCount;

    logger.debug(`Rendering profile with subtab: ${subtab}`);
    res.set('Cache-Control', 'no-store');
    res.render('profile', {
      user: {
        ...ownerUser.toObject(),
        imagesCount,
        videosCount,
        totalLikes,
        subscriberCount,
        postCategories: ownerUser.postCategories || [],
      },
      currentUser,
      isSubscribed: isSubscribed || adminView,
      posts,
      bundles,
      adminView,
      env: process.env.NODE_ENV || 'development',
      flashMessages: req.flash(),
      activeTab: 'posts',
      activeSubtab: subtab,
    });
  } catch (err) {
    logger.error(`Error loading profile by ID: ${err.message}, Stack: ${err.stack}, ID: ${req.params.id}, req.query: ${JSON.stringify(req.query)}`);
    if (process.env.NODE_ENV === 'development') {
      return res.status(500).send(`Error: ${err.message}\nStack: ${err.stack}`);
    }
    if (req.is('json')) {
      return res.status(500).json({ status: 'error', message: 'Error loading profile' });
    }
    return res.status(500).send('Error loading profile');
  }
});
module.exports = router;