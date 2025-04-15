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
      try {
        post.contentUrl = await generateSignedUrl(post.contentUrl);
        console.log(`Generated signed URL for purchased post ${post._id}`);
      } catch (urlError) {
        console.error(`Failed to generate signed URL for post ${post._id}:`, urlError);
        post.contentUrl = '/uploads/placeholder.png'; // Fallback
      }
    }
  }
};

// Purchased content page
router.get('/', authCheck, async (req, res) => {
  try {
    console.log(`Fetching purchased content for user ${req.user._id}`);
    const currentUser = await User.findById(req.user._id).populate({
      path: 'purchasedContent.contentId',
      populate: { path: 'creator', select: 'username profilePicture' }
    });

    console.log('Purchased content entries:', currentUser.purchasedContent);

    // Filter valid purchased posts (only special content)
    const purchasedPosts = currentUser.purchasedContent
      .filter(p => {
        if (!p.contentId) {
          console.warn(`Invalid contentId in purchasedContent for user ${req.user._id}`);
          return false;
        }
        if (!p.contentId.special) {
          console.log(`Post ${p.contentId._id} is not special, skipping`);
          return false;
        }
        return true;
      })
      .map(p => p.contentId)
      .filter(post => post !== null);

    console.log('Filtered purchased posts:', purchasedPosts.map(p => p._id.toString()));

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
    console.error('Error loading purchased content:', err);
    req.flash('error', 'Error loading purchased content.');
    res.redirect('/profile');
  }
});

module.exports = router;