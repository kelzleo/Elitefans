// routes/home.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Post = require('../models/Post');
const { generateSignedUrl, createSignedUrlSession } = require('../utilis/cloudStorage');
const logger = require('../logs/logger');
const { query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const MongoStore = require('rate-limit-mongo');
// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    logger.warn('authCheck failed: No user found in session');
    return res.redirect('/');
  }
  next();
};

// Rate limiters
const HighSensitivityGetLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 3,                  // 3 requests per minute
  keyGenerator: (req) => req.query.fingerprint || req.ip,
  handler: (req, res) => {
    const key = req.query.fingerprint || req.ip;
    logger.warn(`Rate limit exceeded for ${req.originalUrl}: ${key}`);
    if (req.is('json') || req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests. Please try again in a minute.',
      });
    }
    req.flash('error_msg', 'Too many requests. Please try again in a minute.');
    return res.redirect('/home');
  },
});

const MediumSensitivityGetLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5,                  // 5 requests per minute
  keyGenerator: (req) => req.query.fingerprint || req.ip,
  handler: (req, res) => {
    const key = req.query.fingerprint || req.ip;
    logger.warn(`Rate limit exceeded for ${req.originalUrl}: ${key}`);
    if (req.is('json') || req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests. Please try again in a minute.',
      });
    }
    req.flash('error_msg', 'Too many requests. Please try again in a minute.');
    return res.redirect('/home');
  },
});

const LowSensitivityGetLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10,                 // 10 requests per minute
  keyGenerator: (req) => req.query.fingerprint || req.ip,
  handler: (req, res) => {
    const key = req.query.fingerprint || req.ip;
    logger.warn(`Rate limit exceeded for ${req.originalUrl}: ${key}`);
    if (req.is('json') || req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests. Please try again in a minute.',
      });
    }
    req.flash('error_msg', 'Too many requests. Please try again in a minute.');
    return res.redirect('/home');
  },
});

// Rate limiters
const VeryLooseSearchGetLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200,                // 100 requests per minute
  keyGenerator: (req) => req.query.fingerprint || req.ip,
  handler: (req, res) => {
    const key = req.query.fingerprint || req.ip;
    logger.warn(`Rate limit exceeded for ${req.originalUrl}: ${key}`);
    if (req.is('json') || req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests. Please try again in a minute.',
      });
    }
    req.flash('error_msg', 'Too many requests. Please try again in a minute.');
    return res.redirect('/home');
  },
});

const PageLoadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute
  max:      30,             // 30 full‐page loads per minute
  keyGenerator: (req) => req.ip,  // fingerprint not used on full‐page GETs
  handler: (req, res) => {
    const key = req.ip;
    logger.warn(`Rate limit exceeded for ${req.originalUrl}: ${key}`);
    if (req.is('json') || req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests. Please try again in a minute.',
      });
    }
    req.flash('error_msg', 'Too many requests. Please try again in a minute.');
    return res.redirect('/home');
  },
});



// Helper function to parse @username tags and convert to HTML links
const renderTaggedWriteUp = (writeUp, taggedUsers) => {
  if (!writeUp) return writeUp || '';

  const userMap = taggedUsers.reduce((map, user) => {
    if (user && user.username) {
      map[user.username.toLowerCase()] = user.username;
    }
    return map;
  }, {});

  return writeUp.replace(/@(\w+)/g, (match, username) => {
    const lowerUsername = username.toLowerCase();
    if (userMap[lowerUsername]) {
      const actualUsername = userMap[lowerUsername];
      return `<a href="/profile/${encodeURIComponent(actualUsername)}" class="tagged-user">@${actualUsername}</a>`;
    }
    return match;
  });
};
const processPostUrlForFeed = async (post, currentUser) => {
  // Determine if the user can view the full content
  const hasPurchased = currentUser?.purchasedContent?.some(
    (p) => p.contentId.toString() === post._id.toString()
  );
  const canViewFullContent = !post.special || hasPurchased;

  // Set the locked status
  post.locked = !canViewFullContent;

  // Handle multiple media items
  if (post.mediaItems && post.mediaItems.length > 0) {
    const limitedMediaItems = post.mediaItems.slice(0, 3); // Limit to 3 media items, matching profile.js
    post.mediaItems = limitedMediaItems; // Update post to enforce limit
    for (const item of limitedMediaItems) {
      // Store original URLs for client-side fetching
      if (item.url && !item.url.startsWith('http')) {
        item.originalUrl = item.url;
        if (!post.special || canViewFullContent) {
          item.url = null; // Client will fetch signed URL
        } else if (item.previewUrl && !item.previewUrl.startsWith('http')) {
          item.originalUrl = item.previewUrl; // Use preview for non-purchased special content
          item.url = null;
          post.isLocked = true;
        } else {
          item.url = null;
          post.isLocked = true;
          post.isNonSubscriber = !currentUser?.subscriptions?.some(
            (sub) =>
              sub.creatorId.toString() === post.creator.toString() &&
              sub.status === 'active' &&
              sub.subscriptionExpiry > new Date()
          );
        }
      }

      // Store original poster URL for videos
      if (item.type === 'video' && item.posterUrl && !item.posterUrl.startsWith('http')) {
        item.originalPosterUrl = item.posterUrl;
        item.posterUrl = null; // Client will fetch signed URL
      }
    }
  } else {
    // Handle single media posts
    if (post.contentUrl && !post.contentUrl.startsWith('http')) {
      post.originalContentUrl = post.contentUrl;
      if (!post.special || canViewFullContent) {
        post.contentUrl = null; // Client will fetch signed URL
      } else if (post.previewUrl && !post.previewUrl.startsWith('http')) {
        post.originalContentUrl = post.previewUrl; // Use preview for non-purchased special content
        post.contentUrl = null;
        post.isLocked = true;
      } else {
        post.contentUrl = null;
        post.isLocked = true;
        post.isNonSubscriber = !currentUser?.subscriptions?.some(
          (sub) =>
            sub.creatorId.toString() === post.creator.toString() &&
            sub.status === 'active' &&
            sub.subscriptionExpiry > new Date()
        );
      }
    }

    // Store original poster URL for single video posts
    if (post.type === 'video' && post.posterUrl && !post.posterUrl.startsWith('http')) {
      post.originalPosterUrl = post.posterUrl;
      post.posterUrl = null; // Client will fetch signed URL
    }
  }

  // Render tagged users in the write-up
  if (post.writeUp && post.taggedUsers) {
    post.renderedWriteUp = await renderTaggedWriteUp(post.writeUp, post.taggedUsers);
  } else {
    post.renderedWriteUp = post.writeUp || '';
  }

  // Ensure post._id is a string
  post._id = post._id.toString();
};
router.get('/', authCheck, PageLoadLimiter, [
  query('query')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 100 }).withMessage('Search query must be 100 characters or less')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in GET /: ' + JSON.stringify(errors.array()));
    return res.status(400).render('home', {
      user: req.user,
      currentUser: null,
      posts: [],
      creators: [],
      featuredCreators: [],
      search: req.query.query || '',
      error_msg: errors.array().map(err => err.msg).join(', '),
      env: process.env.NODE_ENV || 'development'
    });
  }

  try {
    const currentUser = await User.findById(req.user._id).populate('bookmarks');
    const query = req.query.query;

    if (query && query.trim() !== '') {
      const matchingCreators = await User.find({
        role: 'creator',
        $or: [
          { username: { $regex: query, $options: 'i' } },
          { profileName: { $regex: query, $options: 'i' } }
        ]
      });

      for (const creator of matchingCreators) {
        await creator.updateSubscriberCount();
      }

      return res.render('home', {
        user: req.user,
        currentUser,
        posts: [],
        creators: matchingCreators,
        featuredCreators: [],
        search: query,
        env: process.env.NODE_ENV || 'development'
      });
    } else {
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
        .populate('taggedUsers', 'username')
        .sort({ createdAt: -1 });

      const validPosts = posts.filter(post => post.creator !== null);

      for (const post of validPosts) {
        post.comments = post.comments.filter(comment => {
          if (comment.user === null) {
            logger.warn(`Removing invalid comment on post`);
            return false;
          }
          return true;
        });

        await processPostUrlForFeed(post, currentUser);
      }

      // === EXCLUDE OFFICIAL ELITEFANS ACCOUNT ===
const EXCLUDED_USERNAMES = ['elitefans', 'elite_fans', 'officialelitefans']; // Add more if needed

const featuredCreators = await User.aggregate([
  { 
    $match: { 
      role: 'creator',
      username: { $nin: EXCLUDED_USERNAMES }  // ← EXCLUDES THEM HERE
    } 
  },
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
  { $limit: 50 }
]);
      for (const creator of featuredCreators) {
        const creatorDoc = await User.findById(creator._id);
        await creatorDoc.updateSubscriberCount();
        creator.subscriberCount = creatorDoc.subscriberCount;
      }

      return res.render('home', {
        user: req.user,
        currentUser,
        posts: validPosts,
        creators: [],
        featuredCreators,
        search: '',
        env: process.env.NODE_ENV || 'development'
      });
    }
  } catch (err) {
    logger.error(`Error in home route: ${err.message}`);
    res.status(500).render('home', {
      user: req.user,
      currentUser: null,
      posts: [],
      creators: [],
      featuredCreators: [],
      search: req.query.query || '',
      error_msg: 'Error loading home page',
      env: process.env.NODE_ENV || 'development'
    });
  }
});

router.get('/search-suggestions', authCheck, VeryLooseSearchGetLimiter, [
  query('query')
    .trim()
    .notEmpty().withMessage('Search query is required')
    .escape()
    .isLength({ max: 100 }).withMessage('Search query must be 100 characters or less')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in GET /search-suggestions: ' + JSON.stringify(errors.array()));
    return res.status(400).json({ message: errors.array().map(err => err.msg).join(', '), creators: [] });
  }

  try {
    const query = req.query.query;

    const matchingCreators = await User.find({
      role: 'creator',
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { profileName: { $regex: query, $options: 'i' } }
      ]
    })
      .select('username profileName profilePicture subscriberCount')
      .limit(5);

    for (const creator of matchingCreators) {
      await creator.updateSubscriberCount();
    }

    res.json({ creators: matchingCreators });
  } catch (err) {
    logger.error(`Error in search-suggestions route: ${err.message}`);
    res.status(500).json({ message: 'Error fetching suggestions', error: err.message });
  }
});

router.get('/search-creators', authCheck, LowSensitivityGetLimiter,[
  query('query')
    .trim()
    .notEmpty().withMessage('Search query is required')
    .escape()
    .isLength({ max: 100 }).withMessage('Search query must be 100 characters or less')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in GET /search-creators: ' + JSON.stringify(errors.array()));
    return res.status(400).json({ message: errors.array().map(err => err.msg).join(', '), creators: [] });
  }

  try {
    const query = req.query.query;

    const matchingCreators = await User.find({
      role: 'creator',
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { profileName: { $regex: query, $options: 'i' } }
      ]
    })
      .select('username profileName profilePicture subscriberCount')
      .limit(5);

    for (const creator of matchingCreators) {
      await creator.updateSubscriberCount();
    }

    res.json({ creators: matchingCreators });
  } catch (err) {
    logger.error(`Error in search-creators route: ${err.message}`);
    res.status(500).json({ message: 'Error fetching search results', error: err.message });
  }
});

module.exports = router;