// routes/bookmarks.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Post = require('../models/Post');
const logger = require('../logs/logger');
const { param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const MongoStore = require('rate-limit-mongo');

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    logger.warn('Unauthorized access attempt to bookmarks page');
    return res.redirect('/');
  }
  next();
};
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
    // Determine if the user can view the full content
    const hasPurchased = currentUser?.purchasedContent?.some(
      (p) => p.contentId.toString() === post._id.toString()
    );
    const canViewFullContent = !post.special || hasPurchased;

    // Set the locked status
    post.locked = !canViewFullContent;

    // Handle multiple media items
    if (post.mediaItems && post.mediaItems.length > 0) {
      const limitedMediaItems = post.mediaItems.slice(0, 3); // Limit to 3 media items
      post.mediaItems = limitedMediaItems;
      for (const item of limitedMediaItems) {
        if (item.url && !item.url.startsWith('http')) {
          item.originalUrl = item.url;
          if (!post.special || canViewFullContent) {
            item.url = null; // Client will fetch signed URL
          } else if (item.previewUrl && !item.previewUrl.startsWith('http')) {
            item.originalUrl = item.previewUrl; // Use preview for locked content
            item.url = null;
          } else {
            item.url = null;
            post.isNonSubscriber = !currentUser?.subscriptions?.some(
              (sub) =>
                sub.creatorId.toString() === post.creator.toString() &&
                sub.status === 'active' &&
                sub.subscriptionExpiry > new Date()
            );
          }
        }
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
          post.originalContentUrl = post.previewUrl; // Use preview for locked content
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

// Render Bookmarks Page
router.get('/', authCheck, PageLoadLimiter, async (req, res) => {
  try {
    let user = await User.findById(req.user._id);
    await user.checkExpiredSubscriptions();

    user = await User.findById(req.user._id).populate({
      path: 'bookmarks',
      populate: [
        { path: 'creator', select: 'username profilePicture profileName role' },
        { path: 'taggedUsers', select: 'username' },
      ],
    });

    let bookmarkedPosts = user.bookmarks || [];
    bookmarkedPosts = bookmarkedPosts.filter((post) => {
      if (!post || !post.creator) {
        logger.warn('Skipping invalid post in bookmarks');
        return false;
      }
      return true;
    });

    const validBookmarkIds = bookmarkedPosts.map((post) => post._id.toString());
    if (user.bookmarks.length !== validBookmarkIds.length) {
      user.bookmarks = validBookmarkIds;
      await user.save();
    }

    const reversedBookmarkedPosts = bookmarkedPosts.reverse();
    await processPostUrlsForFeed(reversedBookmarkedPosts, user);

    res.render('bookmarks', {
      currentUser: req.user,
      posts: reversedBookmarkedPosts,
    });
  } catch (error) {
    logger.error(`Error loading bookmarks: ${error.message}`);
    req.flash('error', 'Error loading bookmarks.');
    res.redirect('/home');
  }
});

// Bookmark status endpoint
router.get(
  '/:postId/bookmark-status',
  authCheck,
  [
    param('postId').isMongoId().withMessage('Invalid post ID'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors in GET /:postId/bookmark-status: ' + JSON.stringify(errors.array()));
      return res.status(400).json({ message: errors.array().map((err) => err.msg).join(', ') });
    }

    try {
      const user = await User.findById(req.user._id);
      const isBookmarked = user.bookmarks.some((bookmark) => bookmark.toString() === req.params.postId);
      res.json({ isBookmarked });
    } catch (error) {
      logger.error(`Error checking bookmark status: ${error.message}`);
      res.status(500).json({ message: 'Error checking bookmark status' });
    }
  }
);

module.exports = router;