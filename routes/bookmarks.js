// bookmarks.js
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

    const now = new Date();
    // Get the user's active subscriptions
    const activeCreatorIds = user.subscriptions
      .filter(
        (sub) =>
          sub.status === 'active' &&
          sub.subscriptionExpiry &&
          sub.subscriptionExpiry > now
      )
      .map((sub) => sub.creatorId.toString());

    // Filter bookmarked posts to include only those from creators with active subscriptions
    // or posts that are not special (free content) or purchased
    let bookmarkedPosts = user.bookmarks || [];
    bookmarkedPosts = bookmarkedPosts.filter((post) => {
      const isCreatorSubscribed = activeCreatorIds.includes(
        post.creator._id.toString()
      );
      const isPurchased = user.purchasedContent.some(
        (p) => p.contentId.toString() === post._id.toString()
      );
      // Include post if:
      // - User has an active subscription to the creator, OR
      // - Post is not special (free), OR
      // - Post is special but has been purchased
      return isCreatorSubscribed || !post.special || isPurchased;
    });

    // Reverse the filtered bookmarked posts so newest additions appear first
    const reversedBookmarkedPosts = bookmarkedPosts.reverse();

    // Process post URLs for display only for allowed posts
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