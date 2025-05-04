// routes/home.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Post = require('../models/Post');
const { generateSignedUrl } = require('../utilis/cloudStorage');
const logger = require('../logs/logger');

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

// Process post URLs and tagged users for feed
const processPostUrlForFeed = async (post, currentUser) => {
  const hasPurchased = post.special && currentUser.purchasedContent?.some(
    (p) => p.contentId.toString() === post._id.toString()
  );

  if (post.special && !hasPurchased) {
    post.mediaItems = post.mediaItems?.map(item => ({
      ...item,
      url: `/Uploads/locked-placeholder-${item.type}.png`
    })) || [];
    post.contentUrl = post.contentUrl ? '/Uploads/locked-placeholder.png' : null;
    post.locked = true;
  } else {
    post.locked = false;

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

    if (post.contentUrl && !post.contentUrl.startsWith('http')) {
      try {
        post.contentUrl = await generateSignedUrl(post.contentUrl);
      } catch (err) {
        logger.error(`Failed to generate signed URL for post: ${err.message}`);
        post.contentUrl = '/Uploads/placeholder.png';
      }
    }
  }

  // Render tagged users
  if (post.writeUp && post.taggedUsers) {
    post.renderedWriteUp = renderTaggedWriteUp(post.writeUp, post.taggedUsers);
  } else {
    post.renderedWriteUp = post.writeUp || '';
  }
};

router.get('/', authCheck, async (req, res) => {
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
        .populate('taggedUsers', 'username') // Add taggedUsers population
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
    res.status(500).send('Error loading home page');
  }
});

// Search suggestions and search-creators routes remain unchanged
router.get('/search-suggestions', authCheck, async (req, res) => {
  try {
    const query = req.query.query;
    if (!query || query.trim() === '') {
      return res.json({ creators: [] });
    }

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

router.get('/search-creators', authCheck, async (req, res) => {
  try {
    const query = req.query.query;
    if (!query || query.trim() === '') {
      return res.json({ creators: [] });
    }

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