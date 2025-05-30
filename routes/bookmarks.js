// routes/bookmarks.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Post = require('../models/Post');
const { generateSignedUrl } = require('../utilis/cloudStorage');
const logger = require('../logs/logger');

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
    const hasPurchased = post.special && currentUser.purchasedContent.some(
      (p) => p.contentId.toString() === post._id.toString()
    );

    if (post.special && !hasPurchased) {
      post.locked = true;
      if (post.mediaItems && post.mediaItems.length > 0) {
        for (const item of post.mediaItems) {
          if (item.previewUrl && !item.previewUrl.startsWith('http')) {
            try {
              item.url = await generateSignedUrl(item.previewUrl);
            } catch (err) {
              logger.error(`Failed to generate signed URL for preview: ${err.message}`);
              item.url = `/Uploads/placeholder-${item.type}.png`;
            }
          } else {
            item.url = `/Uploads/placeholder-${item.type}.png`;
          }
          if (item.type === 'video' && item.posterUrl && !item.posterUrl.startsWith('http')) {
            try {
              item.posterUrl = await generateSignedUrl(item.posterUrl);
            } catch (err) {
              logger.error(`Failed to generate signed URL for media item poster: ${err.message}`);
              item.posterUrl = null;
            }
          }
        }
      } else if (post.previewUrl && !post.previewUrl.startsWith('http')) {
        try {
          post.contentUrl = await generateSignedUrl(post.previewUrl);
        } catch (err) {
          logger.error(`Failed to generate signed URL for post preview: ${err.message}`);
          post.contentUrl = '/Uploads/placeholder.png';
        }
        if (post.type === 'video' && post.posterUrl && !post.posterUrl.startsWith('http')) {
          try {
            post.posterUrl = await generateSignedUrl(post.posterUrl);
          } catch (err) {
            logger.error(`Failed to generate signed URL for post poster: ${err.message}`);
            post.posterUrl = null;
          }
        }
      } else {
        post.contentUrl = '/Uploads/placeholder.png';
        if (post.type === 'video' && post.posterUrl && !post.posterUrl.startsWith('http')) {
          try {
            post.posterUrl = await generateSignedUrl(post.posterUrl);
          } catch (err) {
            logger.error(`Failed to generate signed URL for post poster: ${err.message}`);
            post.posterUrl = null;
          }
        }
      }
    } else {
      post.locked = false;
      if (post.mediaItems && post.mediaItems.length > 0) {
        for (const item of post.mediaItems) {
          if (item.url && !item.url.startsWith('http')) {
            try {
              item.url = await generateSignedUrl(item.url);
            } catch (err) {
              logger.error(`Failed to generate signed URL for mediaItem: ${err.message}`);
              item.url = `/Uploads/placeholder-${item.type}.png`;
            }
          }
          if (item.type === 'video' && item.posterUrl && !item.posterUrl.startsWith('http')) {
            try {
              item.posterUrl = await generateSignedUrl(item.posterUrl);
            } catch (err) {
              logger.error(`Failed to generate signed URL for media item poster: ${err.message}`);
              item.posterUrl = null;
            }
          }
        }
      } else if (post.contentUrl && !post.contentUrl.startsWith('http')) {
        try {
          post.contentUrl = await generateSignedUrl(post.contentUrl);
        } catch (err) {
          logger.error(`Failed to generate signed URL for post: ${err.message}`);
          post.contentUrl = '/Uploads/placeholder.png';
        }
        if (post.type === 'video' && post.posterUrl && !post.posterUrl.startsWith('http')) {
          try {
            post.posterUrl = await generateSignedUrl(post.posterUrl);
          } catch (err) {
            logger.error(`Failed to generate signed URL for post poster: ${err.message}`);
            post.posterUrl = null;
          }
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
router.get('/:postId/bookmark-status', authCheck, async (req, res) => {
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