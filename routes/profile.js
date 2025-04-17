// routes/profile.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/users');
const Post = require('../models/Post');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { bucket, profileBucket, generateSignedUrl } = require('../utilis/cloudStorage');
const SubscriptionBundle = require('../models/SubscriptionBundle');
const flutter = require('../utilis/flutter');
const Transaction = require('../models/Transaction');
const Notification = require('../models/notifications');

// Set up multer to store files in memory
const multerStorage = multer.memoryStorage();
const upload = multer({ storage: multerStorage });
const uploadFields = upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'coverPhoto', maxCount: 1 }
]);

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    return res.redirect('/');
  }
  next();
};

/**
 * Helper to process post URLs:
 * For special posts, only generate the signed URL if:
 * - The current user is the owner, OR
 * - The current user has purchased/unlocked the content, OR
 * - adminView is true (admin sees all content)
 * Otherwise, set a locked placeholder.
 */
const processPostUrls = async (posts, currentUser, ownerUser, adminView = false) => {
  for (const post of posts) {
    if (post.special) {
      const isOwner =
        currentUser && currentUser._id.toString() === ownerUser._id.toString();
      const hasPurchased =
        currentUser &&
        currentUser.purchasedContent &&
        currentUser.purchasedContent.some(
          (p) => p.contentId.toString() === post._id.toString()
        );
      console.log(
        `Processing special post ${post._id}: isOwner=${isOwner}, hasPurchased=${hasPurchased}, adminView=${adminView}`
      );
      if (adminView || isOwner || hasPurchased) {
        if (!post.contentUrl.startsWith('http')) {
          post.contentUrl = await generateSignedUrl(post.contentUrl);
          console.log(`Generated signed URL for special post ${post._id}`);
        }
      } else {
        post.contentUrl = '/uploads/locked-placeholder.png';
        console.log(
          `Locked special post ${post._id} for user ${currentUser._id}`
        );
      }
    } else {
      if (!post.contentUrl.startsWith('http')) {
        post.contentUrl = await generateSignedUrl(post.contentUrl);
        console.log(`Generated signed URL for regular post ${post._id}`);
      }
    }
  }
};

router.get('/edit', authCheck, (req, res) => {
  res.render('edit-profile', { user: req.user, currentUser: req.user });
});

// POST route to handle profile edits and upload profile picture to Google Cloud Storage
router.post('/edit', authCheck, uploadFields, async (req, res) => {
  try {
    console.log('Updating profile with GCS...');
    const updates = {
      profileName: req.body.profileName,
      bio: req.body.bio,
    };

    // Handle username update
    const newUsername = req.body.username?.trim();
    if (!newUsername) {
      req.flash('error_msg', 'Username is required.');
      return res.redirect('/profile/edit');
    }

    // Check if the username has changed
    const currentUser = await User.findById(req.user._id);
    if (newUsername !== (currentUser.username || '')) {
      // Validate username format
      const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
      if (!usernameRegex.test(newUsername)) {
        req.flash('error_msg', 'Username must be 3-20 characters long, alphanumeric, and can include underscores.');
        return res.redirect('/profile/edit');
      }

      // Check for username uniqueness
      const existingUser = await User.findOne({ username: newUsername });
      if (existingUser && existingUser._id.toString() !== req.user._id.toString()) {
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
        profileBlobStream.on('error', reject);
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
        coverBlobStream.on('error', reject);
        coverBlobStream.end(coverFile.buffer);
      });

      updates.coverPhoto = `https://storage.googleapis.com/${profileBucket.name}/${coverBlobName}`;
    }

    await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    req.flash('success_msg', 'Profile updated successfully!');
    res.redirect('/profile');
  } catch (err) {
    console.error('Error updating profile:', err);
    if (err.code === 11000 && err.keyPattern && err.keyPattern.username) {
      req.flash('error_msg', 'This username is already taken.');
    } else {
      req.flash('error_msg', 'Error updating profile.');
    }
    res.redirect('/profile/edit');
  }
});
// Owner's profile route
// View own profile
router.get('/', authCheck, async (req, res) => {
  try {
    console.log('Loading profile for owner...');
    const user = await User.findById(req.user._id);

    await user.checkExpiredSubscriptions();
    await user.updateSubscriberCount();

    const posts = await Post.find({ creator: req.user._id })
      .populate('comments.user', 'username')
      .sort({ createdAt: -1 });

    // Filter out comments with invalid users
    for (const post of posts) {
      console.log(`Post ${post._id} comments before filtering:`, post.comments);
      post.comments = post.comments.filter(comment => {
        if (comment.user === null) {
          console.log(`Removing invalid comment on post ${post._id}:`, comment);
          return false;
        }
        return true;
      });
      console.log(`Post ${post._id} comments after filtering:`, post.comments);
    }

    await processPostUrls(posts, req.user, user);
    const bundles = await SubscriptionBundle.find({ creatorId: req.user._id });

    const stats = await Post.aggregate([
      { $match: { creator: new mongoose.Types.ObjectId(req.user._id) } },
      {
        $group: {
          _id: null,
          imagesCount: {
            $sum: { $cond: [{ $eq: ['$type', 'image'] }, 1, 0] },
          },
          videosCount: {
            $sum: { $cond: [{ $eq: ['$type', 'video'] }, 1, 0] },
          },
          totalLikes: {
            $sum: { $size: { $ifNull: ['$likes', []] } },
          },
        },
      },
    ]);

    const imagesCount = stats[0]?.imagesCount || 0;
    const videosCount = stats[0]?.videosCount || 0;
    const totalLikes = stats[0]?.totalLikes || 0;
    const subscriberCount = user.subscriberCount;

    res.render('profile', {
      user: {
        ...user.toObject(),
        imagesCount,
        videosCount,
        totalLikes,
        subscriberCount,
      },
      currentUser: req.user,
      isSubscribed: false,
      posts,
      bundles,
    });
  } catch (err) {
    console.error('Error loading profile:', err);
    res.status(500).send('Error loading profile');
  }
});


// View profile by username
router.get('/:username', authCheck, async (req, res) => {
  try {
    const username = req.params.username;
    const ownerUser = await User.findOne({ username });
    if (!ownerUser) return res.status(404).send('User not found');

    // Check if the user is viewing their own profile
    const isOwnProfile = req.user._id.toString() === ownerUser._id.toString();

    // Handle admin view
    const adminView = req.query.adminView === 'true' && req.user.role === 'admin';

    // FIX 1: Replaced incorrect Subscription model query with check on User.subscriptions array
    // Since there is no separate Subscription model, check subscriptions in the current user's subscriptions array
    let isSubscribed = false;
    if (!isOwnProfile && ownerUser.role === 'creator') {
      const now = new Date();
      isSubscribed = req.user.subscriptions.some(
        (sub) =>
          sub.creatorId.toString() === ownerUser._id.toString() &&
          sub.status === 'active' &&
          sub.subscriptionExpiry > now
      );
    }

    // FIX 2: Corrected Bundle model to SubscriptionBundle and used creatorId field
    // Replaced 'Bundle' with 'SubscriptionBundle' and corrected field name from 'creator' to 'creatorId'
    const bundles = ownerUser.role === 'creator' ? await SubscriptionBundle.find({ creatorId: ownerUser._id }) : [];

    // Fetch posts
    let posts = [];
    if (isOwnProfile || isSubscribed || adminView) {
      // FIX 3: Corrected Post query field from 'user' to 'creator' and added populate for comments.user
      // Changed 'user' to 'creator' to match Post model schema, and populated comments.user for consistency
      posts = (await Post.find({ creator: ownerUser._id })
        .populate('comments.user', 'username')
        .sort({ createdAt: -1 })) || [];

      // FIX 4: Removed incorrect assignment from processPostUrls
      // processPostUrls modifies posts in place and does not return a value, so remove the assignment to prevent posts becoming undefined
      await processPostUrls(posts, req.user, ownerUser, adminView);
    }

    // Update counts
    const imagesCount = posts.filter(post => post.type === 'image').length;
    const videosCount = posts.filter(post => post.type === 'video').length;
    const totalLikes = posts.reduce((sum, post) => sum + (post.likes ? post.likes.length : 0), 0);

    // FIX 5: Corrected subscriber count query to check User.subscriptions
    // Replaced incorrect SubscriptionBundle.countDocuments with User.countDocuments to count active subscriptions
    await User.findByIdAndUpdate(ownerUser._id, {
      imagesCount,
      videosCount,
      totalLikes,
      subscriberCount: ownerUser.role === 'creator'
        ? await User.countDocuments({
            'subscriptions.creatorId': ownerUser._id,
            'subscriptions.status': 'active',
            'subscriptions.subscriptionExpiry': { $gt: new Date() },
          })
        : 0,
    });

    // Render the profile view
    res.render('profile', {
      user: ownerUser,
      currentUser: req.user,
      posts,
      isSubscribed,
      bundles,
      adminView,
    });
  } catch (err) {
    console.error('Error loading profile by username:', err);
    res.status(500).send('Error loading profile');
  }
});

// View another user's profile
router.get('/view/:id', authCheck, async (req, res) => {
  try {
    const ownerUser = await User.findById(req.params.id);
    if (!ownerUser) return res.status(404).send('User not found');

    await ownerUser.updateSubscriberCount();

    const currentUser = await User.findById(req.user._id);
    await currentUser.checkExpiredSubscriptions();
    const now = new Date();
    const isSubscribed = currentUser.subscriptions.some(
      (sub) =>
        sub.creatorId.toString() === ownerUser._id.toString() &&
        sub.status === 'active' &&
        sub.subscriptionExpiry > now
    );
    const bundles = await SubscriptionBundle.find({ creatorId: req.params.id });
    const adminView = req.query.adminView && req.user.role === 'admin';

    let posts = [];
    if (isSubscribed || adminView) {
      posts = await Post.find({ creator: ownerUser._id })
        .populate('comments.user', 'username')
        .sort({ createdAt: -1 });

      // Filter out comments with invalid users
      for (const post of posts) {
        post.comments = post.comments.filter(comment => {
          if (comment.user === null) {
            console.log(`Removing invalid comment on post ${post._id}:`, comment);
            return false;
          }
          return true;
        });
      }

      await processPostUrls(posts, currentUser, ownerUser, adminView);
    }

    const stats = await Post.aggregate([
      { $match: { creator: new mongoose.Types.ObjectId(req.params.id) } },
      {
        $group: {
          _id: null,
          imagesCount: {
            $sum: { $cond: [{ $eq: ['$type', 'image'] }, 1, 0] },
          },
          videosCount: {
            $sum: { $cond: [{ $eq: ['$type', 'video'] }, 1, 0] },
          },
          totalLikes: {
            $sum: { $size: { $ifNull: ['$likes', []] } },
          },
        },
      },
    ]);

    const imagesCount = stats[0]?.imagesCount || 0;
    const videosCount = stats[0]?.videosCount || 0;
    const totalLikes = stats[0]?.totalLikes || 0;
    const subscriberCount = ownerUser.subscriberCount;

    res.render('profile', {
      user: {
        ...ownerUser.toObject(),
        imagesCount,
        videosCount,
        totalLikes,
        subscriberCount,
      },
      currentUser,
      isSubscribed: isSubscribed || adminView,
      posts,
      bundles,
      adminView, // Add this to pass adminView to the template
    });
  } catch (err) {
    console.error('Error loading user profile:', err);
    res.status(500).send('Error loading profile');
  }
});
// Unlock special content route (using the Post model)
router.post('/unlock-special-content', authCheck, async (req, res) => {
  try {
    const { contentId, creatorId } = req.body;
    if (!contentId || !creatorId) {
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

    console.log(
      'Special content payment initialization response:',
      paymentResponse
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
      return res.status(400).json({
        status: 'error',
        message: paymentResponse.message || 'Payment initialization failed',
      });
    }
  } catch (err) {
    console.error('Error unlocking special content:', err);
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
      console.error('Missing transaction_id or tx_ref');
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
        console.error('No pending transaction found for tx_ref:', tx_ref);
        return res.redirect('/profile?payment=error');
      }
      const pendingTx = user.pendingTransactions.find(
        (tx) => tx.tx_ref === tx_ref && tx.type === 'subscription'
      );
      if (!pendingTx) {
        console.error('Pending subscription transaction not found');
        return res.redirect('/profile?payment=error');
      }
      if (pendingTx.amount !== paymentResponse.data.amount) {
        console.error('Amount mismatch:', {
          expected: pendingTx.amount,
          received: paymentResponse.data.amount,
        });
        return res.redirect('/profile?payment=error');
      }
      const bundle = await SubscriptionBundle.findById(pendingTx.bundleId);
      if (!bundle) {
        console.error('Subscription bundle not found:', pendingTx.bundleId);
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
      console.error('Payment verification failed:', paymentResponse);
      return res.redirect('/profile?payment=failed');
    }
  } catch (error) {
    console.error('Error in verify-payment:', error);
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
      console.error('Missing transaction_id or tx_ref');
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
        console.error('No pending transaction found for tx_ref:', tx_ref);
        return res.redirect('/profile?specialPayment=error');
      }
      const pendingTx = user.pendingTransactions.find(
        (tx) => tx.tx_ref === tx_ref && tx.type === 'special'
      );
      if (!pendingTx) {
        console.error('Pending special transaction not found');
        return res.redirect('/profile?specialPayment=error');
      }
      if (pendingTx.amount !== paymentResponse.data.amount) {
        console.error('Amount mismatch:', {
          expected: pendingTx.amount,
          received: paymentResponse.data.amount,
        });
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
      console.error('Payment verification failed:', paymentResponse);
      return res.redirect('/profile?specialPayment=failed');
    }
  } catch (error) {
    console.error('Error in verify-special-payment:', error);
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
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const creatorId = post.creator; // the creator of the post

    // Initialize tip payment using the new function
    const paymentResponse = await flutter.initializeTipPayment(
      req.user._id,
      creatorId,
      req.params.postId,
      numericTip
    );

    console.log('Tip payment initialization response:', paymentResponse);

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
      return res.status(400).json({
        status: 'error',
        message: paymentResponse.message || 'Payment initialization failed'
      });
    }
  } catch (err) {
    console.error('Error initializing tip payment:', err);
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
      console.error('Missing transaction_id or tx_ref');
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
        console.error('No user found with tx_ref:', tx_ref);
        return res.redirect('/profile?tipPayment=error');
      }
      const pendingTx = user.pendingTransactions.find(
        (tx) => tx.tx_ref === tx_ref && tx.type === 'tip'
      );
      if (!pendingTx) {
        console.error('No pending tip transaction found for tx_ref:', tx_ref);
        return res.redirect('/profile?tipPayment=error');
      }
      if (Number(pendingTx.amount) !== Number(paymentResponse.data.amount)) {
        console.error('Tip amount mismatch:', {
          expected: pendingTx.amount,
          received: paymentResponse.data.amount,
        });
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
      console.error('Payment verification failed:', paymentResponse);
      return res.redirect('/profile?tipPayment=failed');
    }
  } catch (error) {
    console.error('Error verifying tip payment:', error);
    return res.redirect('/profile?tipPayment=error');
  }
});

router.post('/tip-creator/:creatorId', authCheck, async (req, res) => {
  try {
    const { tipAmount, tipMessage } = req.body;
    const numericTip = Number(tipAmount);
    if (!numericTip || numericTip <= 0) {
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
      return res.status(400).json({
        status: 'error',
        message: paymentResponse.message || 'Payment initialization failed'
      });
    }
  } catch (err) {
    console.error('Error initializing profile-level tip payment:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Error processing tip payment'
    });
  }
});

// Toggle Like a post
router.post('/posts/:postId/like', authCheck, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

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

    // Update the creator's totalLikes in the User model
    await User.findByIdAndUpdate(post.creator, { $inc: { totalLikes: likeChange } });

    res.json({
      message: alreadyLiked ? 'Post unliked successfully' : 'Post liked successfully',
      likes: post.likes.length,
      userLiked: !alreadyLiked,
    });
  } catch (err) {
    console.error('Error toggling like:', err);
    res.status(500).json({ message: 'An error occurred while toggling the like' });
  }
});

// Comment on a post
router.post('/posts/:postId/comment', authCheck, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: 'Comment text required' });
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const newComment = { user: req.user._id, text };
    post.comments.push(newComment);
    await post.save();

    // Fetch the commenter's username
    const commenter = await User.findById(req.user._id).select('username');
    if (!commenter) {
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
    console.error('Error commenting on post:', err);
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
    console.error('Bookmark Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/posts/:postId/bookmark-status', authCheck, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const isBookmarked = user.bookmarks.some(id => id.toString() === req.params.postId.toString());
    res.json({ isBookmarked });
  } catch (error) {
    console.error('Error checking bookmark status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});





router.post(
  '/uploadContent',
  authCheck,
  upload.fields([{ name: 'contentImage' }, { name: 'contentVideo' }]),
  async (req, res) => {
    if (req.user.role !== 'creator') {
      return res
        .status(403)
        .send('You do not have permission to upload content.');
    }
    try {
      const writeUp = req.body.writeUp || '';
      const isSpecial = Boolean(req.body.special);
      const unlockPrice = req.body.unlockPrice
        ? Number(req.body.unlockPrice)
        : undefined;

      console.log(
        'UploadContent: special flag value:',
        req.body.special,
        'parsed as:',
        isSpecial,
        'unlockPrice:',
        unlockPrice
      );

      const postsToCreate = [];

      // Helper function to upload each file to cloud storage
      const uploadToCloud = async (file, type) => {
        const blobName = `uploads/${type}/${Date.now()}_${path.basename(
          file.originalname
        )}`;
        const blob = bucket.file(blobName);
        const blobStream = blob.createWriteStream({
          resumable: false,
          contentType: file.mimetype,
        });
        await new Promise((resolve, reject) => {
          blobStream.on('finish', resolve);
          blobStream.on('error', reject);
          blobStream.end(file.buffer);
        });
        return blobName;
      };

      // Handle uploaded images
      if (req.files.contentImage) {
        for (const file of req.files.contentImage) {
          const blobName = await uploadToCloud(file, 'image');
          postsToCreate.push({
            creator: req.user._id,
            contentUrl: blobName,
            type: 'image',
            writeUp,
            special: isSpecial,
            unlockPrice: isSpecial ? unlockPrice : undefined,
          });
        }
      }
      // Handle uploaded videos
      if (req.files.contentVideo) {
        for (const file of req.files.contentVideo) {
          const blobName = await uploadToCloud(file, 'video');
          postsToCreate.push({
            creator: req.user._id,
            contentUrl: blobName,
            type: 'video',
            writeUp,
            special: isSpecial,
            unlockPrice: isSpecial ? unlockPrice : undefined,
          });
        }
      }
      // Text-only post if no files are provided
      if (postsToCreate.length === 0 && writeUp) {
        postsToCreate.push({
          creator: req.user._id,
          contentUrl: '',
          type: 'text',
          writeUp,
          special: isSpecial,
          unlockPrice: isSpecial ? unlockPrice : undefined,
        });
      }

      // Create new Post documents and update creator counters accordingly
      const createdPosts = [];
      for (const postData of postsToCreate) {
        const post = new Post(postData);
        await post.save();
        createdPosts.push(post);
        // If the post is an image or video, update the corresponding counter
        if (postData.type === 'image') {
          await User.findByIdAndUpdate(req.user._id, { $inc: { imagesCount: 1 } });
        } else if (postData.type === 'video') {
          await User.findByIdAndUpdate(req.user._id, { $inc: { videosCount: 1 } });
        }
      }

      // Notify subscribers if any new posts were created
      if (createdPosts.length > 0) {
        const creatorId = req.user._id;
        const creator = await User.findById(creatorId);
        const subscribers = await User.find({
          'subscriptions.creatorId': creatorId,
          'subscriptions.status': 'active',
        });

        for (const post of createdPosts) {
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
        }
      }

      res.redirect('/profile');
    } catch (err) {
      console.error('Error uploading content:', err);
      res.status(500).send('Error uploading content');
    }
  }
);

// Delete post route
router.post('/delete-post/:postId', authCheck, async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.postId, creator: req.user._id });
    if (!post) {
      return res.status(404).send('Post not found');
    }
    await Post.deleteOne({ _id: post._id });

    // Decrement the user's counter if it was an image or video
    if (post.type === 'image') {
      await User.findByIdAndUpdate(req.user._id, { $inc: { imagesCount: -1 } });
    } else if (post.type === 'video') {
      await User.findByIdAndUpdate(req.user._id, { $inc: { videosCount: -1 } });
    }

    res.redirect('/profile');
  } catch (err) {
    console.error('Error deleting post:', err);
    res.status(500).send('Error deleting post');
  }
});

// Admin delete post with reason
router.post('/admin-delete-post/:postId', authCheck, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can delete posts' });
    }

    const { reason } = req.body;
    if (!reason || reason.trim() === '') {
      return res.status(400).json({ message: 'Reason for deletion is required' });
    }

    const post = await Post.findById(req.params.postId).populate('creator', 'username');
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const creator = post.creator;

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

    // Decrement the user's counter if it was an image or video
    if (post.type === 'image') {
      await User.findByIdAndUpdate(creator._id, { $inc: { imagesCount: -1 } });
    } else if (post.type === 'video') {
      await User.findByIdAndUpdate(creator._id, { $inc: { videosCount: -1 } });
    }

    // Notify the creator
    await Notification.create({
      user: creator._id,
      message: `Your post was deleted by an admin. Reason: ${reason}`,
      type: 'post_deletion',
      postId: post._id,
      creatorId: req.user._id,
      creatorName: req.user.username,
    });

    res.redirect(`/profile/view/${creator._id}?adminView=true`);
  } catch (err) {
    console.error('Error deleting post by admin:', err);
    res.status(500).json({ message: 'Error deleting post' });
  }
});

// Create a new subscription bundle
router.post('/create-bundle', authCheck, async (req, res) => {
  try {
    if (req.user.role !== 'creator') {
      return res.status(403).send('Only creators can create bundles.');
    }

    // 1) Count existing bundles
    const existingCount = await SubscriptionBundle.countDocuments({
      creatorId: req.user._id
    });
    if (existingCount >= 4) {
      // If user already has 4 bundles, block creation
      return res.status(400).send('You have reached the maximum of 4 bundles.');
    }

    const { price, duration, description } = req.body;

    // 2) Validate the duration
    const validDurations = ['1 day', '1 month', '3 months', '6 months', '1 year'];
    if (!validDurations.includes(duration)) {
      return res.status(400).send('Invalid duration selected.');
    }

    // 3) Create the new bundle
    const bundle = new SubscriptionBundle({
      price,
      duration,
      description,
      creatorId: req.user._id,
    });
    await bundle.save();

    res.redirect('/profile'); // Or wherever you want to redirect
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating bundle');
  }
});

router.post('/delete-bundle/:bundleId', authCheck, async (req, res) => {
  try {
    // 1) Find the bundle by ID
    const bundle = await SubscriptionBundle.findById(req.params.bundleId);
    if (!bundle) {
      return res.status(404).send('Bundle not found');
    }

    // 2) Check if the logged-in user is the owner
    if (bundle.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).send('You do not have permission to delete this bundle');
    }

    // 3) Delete it
    await SubscriptionBundle.findByIdAndDelete(bundle._id);

    res.redirect('/profile'); // Or wherever you want to go after deletion
  } catch (err) {
    console.error('Error deleting bundle:', err);
    res.status(500).send('Error deleting bundle');
  }
});

// Subscribe to a creator's subscription bundle
router.post('/subscribe', authCheck, async (req, res) => {
  try {
    console.log('Processing subscription request...');
    const { creatorId, bundleId } = req.body;
    if (!creatorId || !bundleId) {
      return res.status(400).json({ status: 'error', message: 'Creator ID and Bundle ID are required' });
    }
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    const now = new Date();
    let changed = false;
    user.subscriptions.forEach((sub) => {
      if (sub.status === 'active' && sub.subscriptionExpiry && sub.subscriptionExpiry <= now) {
        sub.status = 'expired';
        changed = true;
      }
    });
    if (changed) await user.save();
    const isSubscribed = user.subscriptions.some(
      (sub) => sub.creatorId.toString() === creatorId.toString() && sub.status === 'active'
    );
    if (isSubscribed) {
      return res.status(400).json({ status: 'error', message: 'You are already subscribed to this creator' });
    }
    const [creator, bundle] = await Promise.all([
      User.findById(creatorId),
      SubscriptionBundle.findById(bundleId),
    ]);
    const paymentResponse = await flutter.initializePayment(req.user._id, creatorId, bundleId);
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
      return res.json({
        status: 'success',
        message: paymentResponse.message || 'Payment initialization in progress',
        data: paymentResponse.meta || null,
      });
    }
  } catch (err) {
    console.error('Subscription error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while processing your subscription',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// Webhook route to handle payment notifications
router.post('/webhook', async (req, res) => {
  try {
    const event = req.body;

    if (event.event === 'charge.success') {
      // 1) Find user, creator, and bundle from event metadata
      const user = await User.findById(event.metadata.user_id);
      const creator = await User.findById(event.metadata.creator_id);
      const bundle = await SubscriptionBundle.findById(event.metadata.bundle_id);

      if (!user || !creator || !bundle) {
        return res.status(404).send('User, creator, or bundle not found.');
      }

      // 2) Parse bundle.duration (e.g. "1 day") into milliseconds
      let subscriptionExpiry = new Date();
      if (bundle.duration === '1 day') {
        subscriptionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
      } else if (bundle.duration === '1 month') {
        subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // ~30 days
      } else if (bundle.duration === '3 months') {
        subscriptionExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      } else if (bundle.duration === '6 months') {
        subscriptionExpiry = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
      } else if (bundle.duration === '1 year') {
        subscriptionExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      }

      // 3) Create a new subscription object
      const subscription = {
        creatorId: creator._id,
        subscriptionBundle: bundle._id,
        subscribedAt: new Date(),
        subscriptionExpiry,
        status: 'active',
      };

      // 4) Push the subscription to the user
      user.subscriptions.push(subscription);
      await user.save();

      // 5) (Optional) Add any logic to create transactions or notify the creator
      // e.g., Transaction.create({...}) or Notification.create({...})

      res.send('Webhook received and processed!');
    } else {
      // If it's not a 'charge.success' event, ignore or handle accordingly
      res.send('Webhook received but not processed!');
    }
  } catch (err) {
    console.error('Error processing webhook:', err);
    res.status(500).send('Error processing webhook');
  }
});

module.exports = router;