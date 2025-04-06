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
    // Check if user purchased
    const hasPurchased =
      currentUser.purchasedContent &&
      currentUser.purchasedContent.some(
        (p) => p.contentId.toString() === post._id.toString()
      );

    if (hasPurchased) {
      // Generate the real signed URL
      if (post.contentUrl && !post.contentUrl.startsWith('http')) {
        post.contentUrl = await generateSignedUrl(post.contentUrl);
      }
      post.locked = false;
    } else {
      // Use a placeholder file (image or static placeholder video)
      post.contentUrl = '/uploads/locked-placeholder.png';
      post.locked = true;
    }
  } else {
    // Non-special => always generate if needed
    if (post.contentUrl && !post.contentUrl.startsWith('http')) {
      post.contentUrl = await generateSignedUrl(post.contentUrl);
    }
    post.locked = false;
  }
};
// routes/home.js
router.get('/', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
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
        posts: [],
        creators: matchingCreators,
        featuredCreators: [], // no featured creators in search mode
        search: query
      });

    } else {
      // Feed mode

      // 1) Filter subscriptions that are active AND not expired
      const now = new Date();
      const subscribedCreatorIds = currentUser.subscriptions
        .filter(sub => {
          if (sub.status !== 'active') return false;
          if (!sub.subscriptionExpiry) return false;
          return sub.subscriptionExpiry > now; // only if still valid
        })
        .map(sub => sub.creatorId);

      // 2) Find posts from these subscribed creators
      const posts = await Post.find({ creator: { $in: subscribedCreatorIds } })
        .populate('creator', 'username profilePicture')
        .sort({ createdAt: -1 });

      // 3) Process each post for locked/unlocked content
      for (const post of posts) {
        await processPostUrlForFeed(post, currentUser);
      }

      // 4) Fetch trending creators based on a "trendingScore"
      //    trendingScore = subscriberCount * 0.7 + totalLikes * 0.3
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

      return res.render('home', {
        user: req.user,
        posts,
        creators: [], // not in search mode, so no search results here
        featuredCreators, // trending creators now based on trendingScore
        search: ''
      });
    }
  } catch (err) {
    console.error('Error in home route:', err);
    res.status(500).send('Error loading home page');
  }
});

module.exports = router;
