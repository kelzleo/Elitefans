// routes/home.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Post = require('../models/Post');
const { generateSignedUrl, createSignedUrlSession } = require('../utilis/cloudStorage');
const logger = require('../logs/logger');
const { query, validationResult } = require('express-validator');

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    logger.warn('authCheck failed: No user found in session');
    return res.redirect('/');
  }
  next();
};

// Helper function to parse @username tags and convert to HTML links
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

const processPostUrlForFeed = async (post, currentUser) => {
  // Determine if the user can view the full content
  const hasPurchased = currentUser.purchasedContent?.some(
    (p) => p.contentId.toString() === post._id.toString()
  );
  const canViewFullContent = !post.special || hasPurchased;

  // Set the locked status
  post.locked = !canViewFullContent;

  // Handle multiple media items
  if (post.mediaItems && post.mediaItems.length > 0) {
    for (const item of post.mediaItems) {
      // Process the media URL
      if (item.url && !item.url.startsWith('http')) {
        try {
          if (canViewFullContent) {
            const sessionId = await createSignedUrlSession(currentUser._id, item.url);
            item.url = `/media/${sessionId}`;
          } else if (item.previewUrl && !item.previewUrl.startsWith('http')) {
            const sessionId = await createSignedUrlSession(currentUser._id, item.previewUrl);
            item.url = `/media/${sessionId}`;
          } else {
            item.url = `/Uploads/placeholder-${item.type}.png`;
          }
        } catch (err) {
          logger.error(`Failed to create signed URL session for mediaItem: ${err.message}`);
          item.url = `/Uploads/placeholder-${item.type}.png`;
        }
      }

      // Process the poster URL for videos
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
  } else {
    // Handle single media posts
    if (post.contentUrl && !post.contentUrl.startsWith('http')) {
      try {
        if (canViewFullContent) {
          const sessionId = await createSignedUrlSession(currentUser._id, post.contentUrl);
          post.contentUrl = `/media/${sessionId}`;
        } else if (post.previewUrl && !post.previewUrl.startsWith('http')) {
          const sessionId = await createSignedUrlSession(currentUser._id, post.previewUrl);
          post.contentUrl = `/media/${sessionId}`;
        } else {
          post.contentUrl = '/Uploads/placeholder.png';
        }
      } catch (err) {
        logger.error(`Failed to create signed URL session for post: ${err.message}`);
        post.contentUrl = '/Uploads/placeholder.png';
      }
    }

    // Process the poster URL for single video posts
    if (post.type === 'video' && post.posterUrl && !post.posterUrl.startsWith('http')) {
      try {
        const sessionId = await createSignedUrlSession(currentUser._id, post.posterUrl);
        post.posterUrl = `/media/${sessionId}`;
      } catch (err) {
        logger.error(`Failed to create signed URL session for post poster: ${err.message}`);
        post.posterUrl = null;
      }
    }
  }

  // Render tagged users in the write-up
  if (post.writeUp && post.taggedUsers) {
    post.renderedWriteUp = renderTaggedWriteUp(post.writeUp, post.taggedUsers);
  } else {
    post.renderedWriteUp = post.writeUp || '';
  }
};
router.get('/', authCheck, [
  query('query')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 100 }).withMessage('Search query must be 100 characters or less')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in GET /: ' + JSON.stringify(errors.array()));
    return res.status(400).render('home', {
      user: req.user,
      currentUser: null,
      posts: [],
      creators: [],
      featuredCreators: [],
      search: req.query.query || '',
      error_msg: errors.array().map(err => err.msg).join(', '),
      env: process.env.NODE_ENV || 'development'
    });
  }

  try {
    const currentUser = await User.findById(req.user._id).populate('bookmarks');
    const query = req.query.query;

    if (query && query.trim() !== '') {
      const matchingCreators = await User.find({
        role: 'creator',
        $or: [
          { username: { $regex: query, $options: 'i' } },
          { profileName: { $regex: query, $options: 'i' } }
        ]
      });

      for (const creator of matchingCreators) {
        await creator.updateSubscriberCount();
      }

      return res.render('home', {
        user: req.user,
        currentUser,
        posts: [],
        creators: matchingCreators,
        featuredCreators: [],
        search: query,
        env: process.env.NODE_ENV || 'development'
      });
    } else {
      const now = new Date();
      const subscribedCreatorIds = currentUser.subscriptions
        .filter(sub => {
          if (sub.status !== 'active') return false;
          if (!sub.subscriptionExpiry) return false;
          return sub.subscriptionExpiry > now;
        })
        .map(sub => sub.creatorId);

      const posts = await Post.find({ creator: { $in: subscribedCreatorIds } })
        .populate('creator', 'username profilePicture')
        .populate('comments.user', 'username')
        .populate('taggedUsers', 'username')
        .sort({ createdAt: -1 });

      const validPosts = posts.filter(post => post.creator !== null);

      for (const post of validPosts) {
        post.comments = post.comments.filter(comment => {
          if (comment.user === null) {
            logger.warn(`Removing invalid comment on post`);
            return false;
          }
          return true;
        });

        await processPostUrlForFeed(post, currentUser);
      }

      const featuredCreators = await User.aggregate([
        { $match: { role: 'creator' } },
        {
          $addFields: {
            trendingScore: {
              $add: [
                { $multiply: ['$subscriberCount', 0.7] },
                { $multiply: ['$totalLikes', 0.3] }
              ]
            }
          }
        },
        { $sort: { trendingScore: -1 } },
        { $limit: 5 }
      ]);

      for (const creator of featuredCreators) {
        const creatorDoc = await User.findById(creator._id);
        await creatorDoc.updateSubscriberCount();
        creator.subscriberCount = creatorDoc.subscriberCount;
      }

      return res.render('home', {
        user: req.user,
        currentUser,
        posts: validPosts,
        creators: [],
        featuredCreators,
        search: '',
        env: process.env.NODE_ENV || 'development'
      });
    }
  } catch (err) {
    logger.error(`Error in home route: ${err.message}`);
    res.status(500).render('home', {
      user: req.user,
      currentUser: null,
      posts: [],
      creators: [],
      featuredCreators: [],
      search: req.query.query || '',
      error_msg: 'Error loading home page',
      env: process.env.NODE_ENV || 'development'
    });
  }
});

router.get('/search-suggestions', authCheck, [
  query('query')
    .trim()
    .notEmpty().withMessage('Search query is required')
    .escape()
    .isLength({ max: 100 }).withMessage('Search query must be 100 characters or less')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in GET /search-suggestions: ' + JSON.stringify(errors.array()));
    return res.status(400).json({ message: errors.array().map(err => err.msg).join(', '), creators: [] });
  }

  try {
    const query = req.query.query;

    const matchingCreators = await User.find({
      role: 'creator',
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { profileName: { $regex: query, $options: 'i' } }
      ]
    })
      .select('username profileName profilePicture subscriberCount')
      .limit(5);

    for (const creator of matchingCreators) {
      await creator.updateSubscriberCount();
    }

    res.json({ creators: matchingCreators });
  } catch (err) {
    logger.error(`Error in search-suggestions route: ${err.message}`);
    res.status(500).json({ message: 'Error fetching suggestions', error: err.message });
  }
});

router.get('/search-creators', authCheck, [
  query('query')
    .trim()
    .notEmpty().withMessage('Search query is required')
    .escape()
    .isLength({ max: 100 }).withMessage('Search query must be 100 characters or less')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors in GET /search-creators: ' + JSON.stringify(errors.array()));
    return res.status(400).json({ message: errors.array().map(err => err.msg).join(', '), creators: [] });
  }

  try {
    const query = req.query.query;

    const matchingCreators = await User.find({
      role: 'creator',
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { profileName: { $regex: query, $options: 'i' } }
      ]
    })
      .select('username profileName profilePicture subscriberCount')
      .limit(5);

    for (const creator of matchingCreators) {
      await creator.updateSubscriberCount();
    }

    res.json({ creators: matchingCreators });
  } catch (err) {
    logger.error(`Error in search-creators route: ${err.message}`);
    res.status(500).json({ message: 'Error fetching search results', error: err.message });
  }
});

module.exports = router;