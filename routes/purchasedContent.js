// routes/purchasedContent.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Post = require('../models/Post');
const { createSignedUrlSession } = require('../utilis/cloudStorage');
const logger = require('../logs/logger');

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    logger.warn('Unauthorized access attempt to purchased content page');
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

// Helper to process post URLs for purchased content
const processPostUrls = async (posts, currentUser) => {
  for (const post of posts) {
    // All posts are purchased special content, so no locked status
    post.locked = false;

    // Process mediaItems (new schema)
    if (post.mediaItems?.length > 0) {
      for (const item of post.mediaItems) {
        if (item.url && !item.url.startsWith('http')) {
          try {
            const sessionId = await createSignedUrlSession(currentUser._id, item.url);
            item.url = `/media/${sessionId}`;
          } catch (err) {
            logger.error(`Failed to create signed URL session for mediaItem ${item.url}: ${err.message}`);
            item.url = `/Uploads/placeholder-${item.type}.png`;
          }
        }
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
    }

    // Process contentUrl and posterUrl (legacy schema)
    if (post.contentUrl && !post.contentUrl.startsWith('http')) {
      try {
        const sessionId = await createSignedUrlSession(currentUser._id, post.contentUrl);
        post.contentUrl = `/media/${sessionId}`;
      } catch (err) {
        logger.error(`Failed to create signed URL session for post: ${err.message}`);
        post.contentUrl = '/Uploads/placeholder.png';
      }
    }
    if (post.type === 'video' && post.posterUrl && !post.posterUrl.startsWith('http')) {
      try {
        const sessionId = await createSignedUrlSession(currentUser._id, post.posterUrl);
        post.posterUrl = `/media/${sessionId}`;
      } catch (err) {
        logger.error(`Failed to create signed URL session for post poster: ${err.message}`);
        post.posterUrl = null;
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

// Purchased content page
router.get('/', authCheck, async (req, res) => {
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
        if (!p.contentId || !p.contentId.special) {
          logger.warn(`Invalid or non-special contentId in purchasedContent for user: ${p.contentId?._id}`);
          return false;
        }
        return true;
      })
      .map(p => p.contentId)
      .filter(post => post !== null);

    // Process URLs for all purchased posts
    if (purchasedPosts.length > 0) {
      await processPostUrls(purchasedPosts, currentUser);
    }

    res.render('purchased-content', {
      user: currentUser,
      currentUser,
      isSubscribed: true,
      posts: purchasedPosts.sort((a, b) => b.createdAt - a.createdAt)
    });
  } catch (err) {
    logger.error(`Error loading purchased content: ${err.message}`);
    req.flash('error', 'Something went wrong while loading your content.');
    res.redirect('/profile');
  }
});

module.exports = router;