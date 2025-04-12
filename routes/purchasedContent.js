// routes/purchasedContent.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Post = require('../models/Post');
const { generateSignedUrl } = require('../utilis/cloudStorage');

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
      post.contentUrl = await generateSignedUrl(post.contentUrl);
      console.log(`Generated signed URL for purchased post ${post._id}`);
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
      .filter(p => p.contentId && p.contentId.special)
      .map(p => p.contentId)
      .filter(post => post !== null);

    // Process URLs for all purchased posts
    await processPostUrls(purchasedPosts);

    res.render('purchased-content', {
      user: currentUser,
      currentUser,
      isSubscribed: false,
      posts: purchasedPosts.sort((a, b) => b.createdAt - a.createdAt)
    });
  } catch (err) {
    console.error('Error loading purchased content:', err);
    req.flash('error', 'Error loading purchased content.');
    res.redirect('/profile');
  }
});

module.exports = router;