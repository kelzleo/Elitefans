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
        post.locked = true;
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
    // Fetch user and ensure subscriptions are up-to-date
    let user = await User.findById(req.user._id);
    await user.checkExpiredSubscriptions(); // Update subscription statuses

    // Re-fetch user with populated bookmarks
    user = await User.findById(req.user._id).populate({
      path: 'bookmarks',
      populate: { path: 'creator', select: 'username profilePicture' }
    });

    const now = new Date();
    // Get active subscriptions
    const activeCreatorIds = user.subscriptions
      .filter(
        (sub) =>
          sub.status === 'active' &&
          sub.subscriptionExpiry &&
          sub.subscriptionExpiry > now
      )
      .map((sub) => sub.creatorId.toString());

    // Log for debugging
    console.log('Active Creator IDs:', activeCreatorIds);
    console.log('User Subscriptions:', user.subscriptions.map(sub => ({
      creatorId: sub.creatorId,
      status: sub.status,
      expiry: sub.subscriptionExpiry
    })));

    // Filter valid bookmarked posts
    let bookmarkedPosts = user.bookmarks || [];
    bookmarkedPosts = bookmarkedPosts.filter((post) => {
      if (!post || !post.creator) {
        console.log('Skipping invalid post:', post);
        return false;
      }

      const creatorId = post.creator._id.toString();
      const isCreatorSubscribed = activeCreatorIds.includes(creatorId);
      const isPurchased = user.purchasedContent.some(
        (p) => p.contentId.toString() === post._id.toString()
      );

      // Log filtering decision
      console.log(`Post ID: ${post._id}, Creator: ${creatorId}, Subscribed: ${isCreatorSubscribed}, Special: ${post.special}, Purchased: ${isPurchased}`);

      return isCreatorSubscribed || !post.special || isPurchased;
    });

    // Clean up invalid bookmarks
    const validBookmarkIds = bookmarkedPosts.map((post) => post._id.toString());
    if (user.bookmarks.length !== validBookmarkIds.length) {
      user.bookmarks = validBookmarkIds;
      await user.save();
      console.log('Cleaned up invalid bookmarks');
    }

    // Reverse posts to show newest first
    const reversedBookmarkedPosts = bookmarkedPosts.reverse();

    // Log final posts
    console.log('Filtered Bookmarked Posts:', reversedBookmarkedPosts.map(p => ({
      id: p._id,
      creator: p.creator._id,
      special: p.special
    })));

    // Process URLs for accessible posts
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

// Bookmark status endpoint
router.get('/:postId/bookmark-status', authCheck, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const isBookmarked = user.bookmarks.some(
      (bookmark) => bookmark.toString() === req.params.postId
    );
    res.json({ isBookmarked });
  } catch (error) {
    console.error('Bookmark Status Error:', error);
    res.status(500).json({ message: 'Error checking bookmark status' });
  }
});

module.exports = router;