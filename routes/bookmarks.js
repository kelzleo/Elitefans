// routes/bookmarks.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Post = require('../models/Post');
const { createSignedUrlSession } = require('../utilis/cloudStorage');
const logger = require('../logs/logger');
const { param, validationResult } = require('express-validator');

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    logger.warn('Unauthorized access attempt to bookmarks page');
    return res.redirect('/');
  }
  next();
};

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

// Helper to process post URLs
const processPostUrls = async (posts, currentUser) => {
  for (const post of posts) {
    // Determine if the user can view the full content
    const hasPurchased = currentUser.purchasedContent?.some(
      (p) => p.contentId.toString() === post._id.toString()
    );
    const canViewFullContent = !post.special || hasPurchased;

    // Set the locked status
    post.locked = !canViewFullContent;

    // Handle multiple media items
    if (post.mediaItems && post.mediaItems.length > 0) {
      for (const item of post.mediaItems) {
        // Process the media URL
        if (item.url && !item.url.startsWith('http')) {
          try {
            if (canViewFullContent) {
              const sessionId = await createSignedUrlSession(currentUser._id, item.url);
              item.url = `/media/${sessionId}`;
            } else if (item.previewUrl && !item.previewUrl.startsWith('http')) {
              const sessionId = await createSignedUrlSession(currentUser._id, item.previewUrl);
              item.url = `/media/${sessionId}`;
            } else {
              item.url = `/Uploads/placeholder-${item.type}.png`;
            }
          } catch (err) {
            logger.error(`Failed to create signed URL session for mediaItem: ${err.message}`);
            item.url = `/Uploads/placeholder-${item.type}.png`;
          }
        }

        // Process the poster URL for videos
        if (item.type === 'video' && item.posterUrl && !item.posterUrl.startsWith('http')) {
          try {
            const sessionId = await createSignedUrlSession(currentUser._id, item.posterUrl);
            item.posterUrl = `/media/${sessionId}`;
          } catch (err) {
            logger.error(`Failed to create signed URL session for media item poster: ${err.message}`);
            item.posterUrl = null;
          }
        }
      }
    } else {
      // Handle single media posts
      if (post.contentUrl && !post.contentUrl.startsWith('http')) {
        try {
          if (canViewFullContent) {
            const sessionId = await createSignedUrlSession(currentUser._id, post.contentUrl);
            post.contentUrl = `/media/${sessionId}`;
          } else if (post.previewUrl && !post.previewUrl.startsWith('http')) {
            const sessionId = await createSignedUrlSession(currentUser._id, post.previewUrl);
            post.contentUrl = `/media/${sessionId}`;
          } else {
            post.contentUrl = '/Uploads/placeholder.png';
          }
        } catch (err) {
          logger.error(`Failed to create signed URL session for post: ${err.message}`);
          post.contentUrl = '/Uploads/placeholder.png';
        }
      }

      // Process the poster URL for single video posts
      if (post.type === 'video' && post.posterUrl && !post.posterUrl.startsWith('http')) {
        try {
          const sessionId = await createSignedUrlSession(currentUser._id, post.posterUrl);
          post.posterUrl = `/media/${sessionId}`;
        } catch (err) {
          logger.error(`Failed to create signed URL session for post poster: ${err.message}`);
          post.posterUrl = null;
        }
      }
    }

    // Render tagged users
    if (post.writeUp && post.taggedUsers) {
      post.renderedWriteUp = renderTaggedWriteUp(post.writeUp, post.taggedUsers);
    } else {
      post.renderedWriteUp = post.writeUp || '';
    }
  }
};

// Render Bookmarks Page
router.get('/', authCheck, async (req, res) => {
  try {
    let user = await User.findById(req.user._id);
    await user.checkExpiredSubscriptions();

    user = await User.findById(req.user._id).populate({
      path: 'bookmarks',
      populate: [
        { path: 'creator', select: 'username profilePicture profileName role' },
        { path: 'taggedUsers', select: 'username' }
      ]
    });

    let bookmarkedPosts = user.bookmarks || [];
    bookmarkedPosts = bookmarkedPosts.filter(post => {
      if (!post || !post.creator) {
        logger.warn('Skipping invalid post in bookmarks');
        return false;
      }
      return true;
    });

    const validBookmarkIds = bookmarkedPosts.map(post => post._id.toString());
    if (user.bookmarks.length !== validBookmarkIds.length) {
      user.bookmarks = validBookmarkIds;
      await user.save();
    }

    const reversedBookmarkedPosts = bookmarkedPosts.reverse();
    await processPostUrls(reversedBookmarkedPosts, user);

    res.render('bookmarks', {
      currentUser: req.user,
      posts: reversedBookmarkedPosts
    });
  } catch (error) {
    logger.error(`Error loading bookmarks: ${error.message}`);
    req.flash('error', 'Error loading bookmarks.');
    res.redirect('/home');
  }
});

// Bookmark status endpoint
router.get('/:postId/bookmark-status', authCheck, [
  param('postId')
    .isMongoId().withMessage('Invalid post ID')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in GET /:postId/bookmark-status: ' + JSON.stringify(errors.array()));
    return res.status(400).json({ message: errors.array().map(err => err.msg).join(', ') });
  }

  try {
    const user = await User.findById(req.user._id);
    const isBookmarked = user.bookmarks.some(
      (bookmark) => bookmark.toString() === req.params.postId
    );
    res.json({ isBookmarked });
  } catch (error) {
    logger.error(`Error checking bookmark status: ${error.message}`);
    res.status(500).json({ message: 'Error checking bookmark status' });
  }
});

module.exports = router;