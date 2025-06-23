// routes/purchasedContent.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Post = require('../models/Post');
const logger = require('../logs/logger');
const rateLimit = require('express-rate-limit');
const MongoStore = require('rate-limit-mongo');

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    logger.warn('Unauthorized access attempt to purchased content page');
    return res.redirect('/');
  }
  next();
};
// Rate limiters
const HighSensitivityLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 3, // 3 requests per minute
  keyGenerator: (req) => req.body.fingerprint || req.ip,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for ${req.originalUrl}: ${req.body.fingerprint || req.ip}`);
    if (req.is('json') || req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests. Please try again in a minute.',
      });
    }
    req.flash('error_msg', 'Too many requests. Please try again in a minute.');
    return res.redirect('/profile');
  },
});

const MediumSensitivityLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  keyGenerator: (req) => req.body.fingerprint || req.ip,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for ${req.originalUrl}: ${req.body.fingerprint || req.ip}`);
    if (req.is('json') || req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests. Please try again in a minute.',
      });
    }
    req.flash('error_msg', 'Too many requests. Please try again in a minute.');
    return res.redirect('/profile');
  },
});

const LowSensitivityLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  keyGenerator: (req) => req.body.fingerprint || req.ip,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for ${req.originalUrl}: ${req.body.fingerprint || req.ip}`);
    if (req.is('json') || req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests. Please try again in a minute.',
      });
    }
    req.flash('error_msg', 'Too many requests. Please try again in a minute.');
    return res.redirect('/profile');
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
// Helper to parse @username tags and convert to HTML links
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

// Helper to process post URLs for client-side fetching
const processPostUrlsForFeed = async (posts, currentUser) => {
  for (const post of posts) {
    // Purchased content is always accessible, no locked status
    post.locked = false;

    // Handle multiple media items
    if (post.mediaItems && post.mediaItems.length > 0) {
      const limitedMediaItems = post.mediaItems.slice(0, 3); // Limit to 3 media items
      post.mediaItems = limitedMediaItems;
      for (const item of limitedMediaItems) {
        if (item.url && !item.url.startsWith('http')) {
          item.originalUrl = item.url;
          item.url = null; // Client will fetch signed URL
        }
        if (item.type === 'video' && item.posterUrl && !item.posterUrl.startsWith('http')) {
          item.originalPosterUrl = item.posterUrl;
          item.posterUrl = null; // Client will fetch signed URL
        }
      }
    } else {
      // Handle single media posts (legacy schema)
      if (post.contentUrl && !post.contentUrl.startsWith('http')) {
        post.originalContentUrl = post.contentUrl;
        post.contentUrl = null; // Client will fetch signed URL
      }
      if (post.type === 'video' && post.posterUrl && !post.posterUrl.startsWith('http')) {
        post.originalPosterUrl = post.posterUrl;
        post.posterUrl = null; // Client will fetch signed URL
      }
    }

    // Render tagged users
    if (post.writeUp && post.taggedUsers) {
      post.renderedWriteUp = renderTaggedWriteUp(post.writeUp, post.taggedUsers);
    } else {
      post.renderedWriteUp = post.writeUp || '';
    }

    // Ensure post._id is a string
    post._id = post._id.toString();
  }
};

// Purchased content page
router.get('/', authCheck, PageLoadLimiter, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).populate({
      path: 'purchasedContent.contentId',
      populate: [
        { path: 'creator', select: 'username profilePicture profileName role' },
        { path: 'taggedUsers', select: 'username' }
      ]
    });

    // Filter valid purchased posts (only special content)
    const purchasedPosts = currentUser.purchasedContent
      .filter(p => {
        if (!p.contentId) {
          logger.warn('Invalid contentId in purchasedContent for user');
          return false;
        }
        if (!p.contentId.special) {
          return false;
        }
        return true;
      })
      .map(p => p.contentId)
      .filter(post => post !== null);

    // Process URLs for all purchased posts
    if (purchasedPosts.length > 0) {
      await processPostUrlsForFeed(purchasedPosts, currentUser);
    }

    res.render('purchased-content', {
      user: currentUser,
      currentUser,
      isSubscribed: false,
      posts: purchasedPosts.sort((a, b) => b.createdAt - a.createdAt)
    });
  } catch (err) {
    logger.error(`Error loading purchased content: ${err.message}`);
    req.flash('error', 'Error loading purchased content.');
    res.redirect('/profile');
  }
});

module.exports = router;