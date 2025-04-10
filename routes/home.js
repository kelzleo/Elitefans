// routes/home.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Post = require('../models/Post');
const { generateSignedUrl } = require('../utilis/cloudStorage');

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) return res.redirect('/');
  next();
};

/**
 * For special posts:
 *   - If purchased, generate the real signed URL.
 *   - Otherwise, set a placeholder path & mark locked.
 * For normal posts:
 *   - Always generate a signed URL.
 */
const processPostUrlForFeed = async (post, currentUser) => {
  if (post.special) {
    const hasPurchased =
      currentUser.purchasedContent &&
      currentUser.purchasedContent.some(
        (p) => p.contentId.toString() === post._id.toString()
      );
    if (hasPurchased) {
      if (post.contentUrl && !post.contentUrl.startsWith('http')) {
        post.contentUrl = await generateSignedUrl(post.contentUrl);
      }
      post.locked = false;
    } else {
      post.contentUrl = '/uploads/locked-placeholder.png';
      post.locked = true;
    }
  } else {
    if (post.contentUrl && !post.contentUrl.startsWith('http')) {
      post.contentUrl = await generateSignedUrl(post.contentUrl);
    }
    post.locked = false;
  }
};

router.get('/', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).populate('bookmarks');
    const query = req.query.query;

    if (query && query.trim() !== '') {
      // Search mode
      const matchingCreators = await User.find({
        role: 'creator',
        $or: [
          { username: { $regex: query, $options: 'i' } },
          { profileName: { $regex: query, $options: 'i' } }
        ]
      });

      return res.render('home', {
        user: req.user,
        currentUser,
        posts: [],
        creators: matchingCreators,
        featuredCreators: [],
        search: query
      });
    } else {
      // Feed mode
      const now = new Date();
      const subscribedCreatorIds = currentUser.subscriptions
        .filter(sub => {
          if (sub.status !== 'active') return false;
          if (!sub.subscriptionExpiry) return false;
          return sub.subscriptionExpiry > now;
        })
        .map(sub => sub.creatorId);

      const posts = await Post.find({ creator: { $in: subscribedCreatorIds } })
        .populate('creator', 'username profilePicture')
        .populate('comments.user', 'username')
        .sort({ createdAt: -1 });

      // Filter out posts where creator is null (e.g., deleted user)
      const validPosts = posts.filter(post => post.creator !== null);

      for (const post of validPosts) {
        await processPostUrlForFeed(post, currentUser);
      }

      // Fetch trending creators and update subscriberCount
      const featuredCreators = await User.aggregate([
        { $match: { role: 'creator' } },
        {
          $addFields: {
            trendingScore: {
              $add: [
                { $multiply: ['$subscriberCount', 0.7] },
                { $multiply: ['$totalLikes', 0.3] }
              ]
            }
          }
        },
        { $sort: { trendingScore: -1 } },
        { $limit: 5 }
      ]);

      // Update subscriberCount for each featured creator
      for (const creator of featuredCreators) {
        const creatorDoc = await User.findById(creator._id);
        await creatorDoc.updateSubscriberCount();
        creator.subscriberCount = creatorDoc.subscriberCount; // Update the aggregated object
      }

      console.log('Current User Bookmarks:', currentUser.bookmarks.map(b => b.toString()));
      console.log('Post IDs:', validPosts.map(p => p._id.toString()));

      return res.render('home', {
        user: req.user,
        currentUser,
        posts: validPosts,
        creators: [],
        featuredCreators,
        search: ''
      });
    }
  } catch (err) {
    console.error('Error in home route:', err);
    res.status(500).send('Error loading home page');
  }
});

module.exports = router;