// routes/purchasedContent.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Post = require('../models/Post');
const { generateSignedUrl } = require('../utilis/cloudStorage');
const logger = require('../logs/logger'); // Import Winston logger at top

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    return res.redirect('/');
  }
  next();
};

// Helper to process post URLs for purchased content
const processPostUrls = async (posts) => {
  for (const post of posts) {
    // Process mediaItems (new schema)
    if (post.mediaItems?.length > 0) {
      for (const item of post.mediaItems) {
        if (item.url && !item.url.startsWith('http')) {
          try {
            item.url = await generateSignedUrl(item.url);
          } catch (err) {
            logger.error(`Failed to generate signed URL for mediaItem ${item.url}: ${err.message}`);
            item.url = `/Uploads/placeholder-${item.type}.png`;
          }
        }
      }
    }

    // Process contentUrl (legacy schema)
    if (post.contentUrl && !post.contentUrl.startsWith('http')) {
      try {
        post.contentUrl = await generateSignedUrl(post.contentUrl);
      } catch (err) {
        logger.error(`Failed to generate signed URL for post: ${err.message}`);
        post.contentUrl = '/Uploads/placeholder.png';
      }
    }
  }
};
// Purchased content page
router.get('/', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).populate({
      path: 'purchasedContent.contentId',
      populate: { path: 'creator', select: 'username profilePicture' }
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
      await processPostUrls(purchasedPosts);
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