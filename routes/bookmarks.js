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

// Helper to process post URLs
const processPostUrls = async (posts, currentUser) => {
  for (const post of posts) {
    if (post.special) {
      const hasPurchased = currentUser.purchasedContent.some(
        (p) => p.contentId.toString() === post._id.toString()
      );
      if (hasPurchased) {
        if (!post.contentUrl.startsWith('http')) {
          post.contentUrl = await generateSignedUrl(post.contentUrl);
        }
      } else {
        post.contentUrl = '/uploads/locked-placeholder.png';
      }
    } else {
      if (!post.contentUrl.startsWith('http')) {
        post.contentUrl = await generateSignedUrl(post.contentUrl);
      }
    }
  }
};

// Render Bookmarks Page
router.get('/', authCheck, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'bookmarks',
      populate: { path: 'creator', select: 'username profilePicture' }
    });

    const bookmarkedPosts = user.bookmarks || [];

    // Reverse the bookmarked posts so newest additions appear first
    const reversedBookmarkedPosts = bookmarkedPosts.reverse();

    // Process post URLs for display
    await processPostUrls(reversedBookmarkedPosts, user);

    res.render('bookmarks', {
      currentUser: req.user,
      posts: reversedBookmarkedPosts
    });
  } catch (error) {
    console.error('Bookmarks Error:', error);
    req.flash('error', 'Error loading bookmarks.');
    res.redirect('/home');
  }
});

module.exports = router;