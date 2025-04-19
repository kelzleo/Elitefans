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
    if (!post.contentUrl.startsWith('http')) {
      try {
        post.contentUrl = await generateSignedUrl(post.contentUrl);
      } catch (urlError) {
        logger.error(`Failed to generate signed URL for post: ${urlError.message}`);
        post.contentUrl = '/uploads/placeholder.png'; // Fallback
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