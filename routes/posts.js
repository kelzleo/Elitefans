// routes/posts.js
const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const User = require('../models/users');
const { generateSignedUrl } = require('../utilis/cloudStorage');

// Optional auth middleware
function authCheck(req, res, next) {
  if (!req.user) {
    return res.redirect('/');
  }
  next();
}

// GET /posts/:postId
router.get('/:postId', authCheck, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId).populate('creator', 'username profilePicture');
    if (!post) {
      return res.status(404).send('Post not found');
    }

    const currentUser = await User.findById(req.user._id);

    // Check if user is the owner
    const isOwner = post.creator._id.toString() === currentUser._id.toString();

    // Check if user is subscribed to the post's creator
    // (i.e., sub.status === 'active' and subscriptionExpiry > now if you have expiry logic)
    const now = new Date();
    const isSubscribed = currentUser.subscriptions.some((sub) => {
      if (sub.creatorId.toString() !== post.creator._id.toString()) return false;
      if (sub.status !== 'active') return false;
      if (!sub.subscriptionExpiry) return false;
      return sub.subscriptionExpiry > now; // Not expired
    });

    // If the post is special, also check purchase
    if (post.special) {
      const hasPurchased = currentUser.purchasedContent?.some(
        (p) => p.contentId.toString() === post._id.toString()
      );

      if (isOwner) {
        // Owner sees the real URL
        post.locked = false;
        if (!post.contentUrl.startsWith('http')) {
          post.contentUrl = await generateSignedUrl(post.contentUrl);
        }
      } else {
        // Must be subscribed + purchased
        if (isSubscribed && hasPurchased) {
          post.locked = false;
          if (!post.contentUrl.startsWith('http')) {
            post.contentUrl = await generateSignedUrl(post.contentUrl);
          }
        } else {
          // Not subscribed or not purchased => locked
          post.locked = true;
          // Do NOT generate a real URL
        }
      }

    } else {
      // Non-special => must be subscribed or owner
      if (isOwner || isSubscribed) {
        post.locked = false;
        if (!post.contentUrl.startsWith('http')) {
          post.contentUrl = await generateSignedUrl(post.contentUrl);
        }
      } else {
        // Not subscribed => locked
        post.locked = true;
        // No real URL
      }
    }

    res.render('single-post', { post });
  } catch (err) {
    console.error('Error loading post:', err);
    res.status(500).send('Error loading post');
  }
});

module.exports = router;
