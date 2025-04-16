// routes/home.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Post = require('../models/Post');
const { generateSignedUrl } = require('../utilis/cloudStorage');

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    console.log('authCheck failed: No user found in session');
    return res.redirect('/');
  }
  next();
};

/**
 * For special posts:
 *   - If purchased, generate the real signed URL.
 *   - Otherwise, set a placeholder path & mark locked.
 * For normal posts:
 *   - Always generate a signed URL.
 */
const processPostUrlForFeed = async (post, currentUser) => {
  if (post.special) {
    const hasPurchased =
      currentUser.purchasedContent &&
      currentUser.purchasedContent.some(
        (p) => p.contentId.toString() === post._id.toString()
      );
    if (hasPurchased) {
      if (post.contentUrl && !post.contentUrl.startsWith('http')) {
        post.contentUrl = await generateSignedUrl(post.contentUrl);
      }
      post.locked = false;
    } else {
      post.contentUrl = '/uploads/locked-placeholder.png';
      post.locked = true;
    }
  } else {
    if (post.contentUrl && !post.contentUrl.startsWith('http')) {
      post.contentUrl = await generateSignedUrl(post.contentUrl);
    }
    post.locked = false;
  }
};

router.get('/', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).populate('bookmarks');
    const query = req.query.query;

    if (query && query.trim() !== '') {
      // Search mode
      const matchingCreators = await User.find({
        role: 'creator',
        $or: [
          { username: { $regex: query, $options: 'i' } },
          { profileName: { $regex: query, $options: 'i' } }
        ]
      });

      return res.render('home', {
        user: req.user,
        currentUser,
        posts: [],
        creators: matchingCreators,
        featuredCreators: [],
        search: query
      });
    } else {
      // Feed mode
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
        .sort({ createdAt: -1 });

      // Filter out posts where creator is null (e.g., deleted user)
      const validPosts = posts.filter(post => post.creator !== null);

      // Filter out comments with invalid users and process post URLs
      for (const post of validPosts) {
        // Log comments before filtering for debugging
        console.log(`Post ${post._id} comments before filtering:`, post.comments);

        // Filter out comments where the user is null (i.e., deleted user)
        post.comments = post.comments.filter(comment => {
          if (comment.user === null) {
            console.log(`Removing invalid comment on post ${post._id}:`, comment);
            return false;
          }
          return true;
        });

        // Log comments after filtering for debugging
        console.log(`Post ${post._id} comments after filtering:`, post.comments);

        await processPostUrlForFeed(post, currentUser);
      }

      // Fetch trending creators and update subscriberCount
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

      // Update subscriberCount for each featured creator
      for (const creator of featuredCreators) {
        const creatorDoc = await User.findById(creator._id);
        await creatorDoc.updateSubscriberCount();
        creator.subscriberCount = creatorDoc.subscriberCount; // Update the aggregated object
      }

      console.log('Current User Bookmarks:', currentUser.bookmarks.map(b => b.toString()));
      console.log('Post IDs:', validPosts.map(p => p._id.toString()));

      return res.render('home', {
        user: req.user,
        currentUser,
        posts: validPosts,
        creators: [],
        featuredCreators,
        search: ''
      });
    }
  } catch (err) {
    console.error('Error in home route:', err);
    res.status(500).send('Error loading home page');
  }
});

// Search suggestions route for autocomplete
router.get('/search-suggestions', authCheck, async (req, res) => {
  try {
    console.log('User in session for /search-suggestions:', req.user);
    const query = req.query.query;
    console.log('Search suggestions query:', query);
    if (!query || query.trim() === '') {
      return res.json({ creators: [] });
    }

    const matchingCreators = await User.find({
      role: 'creator',
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { profileName: { $regex: query, $options: 'i' } },
      ],
    })
      .select('username profileName profilePicture')
      .limit(5);

    console.log('Matching creators for suggestions:', matchingCreators);
    res.json({ creators: matchingCreators });
  } catch (err) {
    console.error('Error in search-suggestions route:', err);
    res.status(500).json({ message: 'Error fetching suggestions', error: err.message });
  }
});

// Search creators route for dynamic results
router.get('/search-creators', authCheck, async (req, res) => {
  try {
    console.log('User in session for /search-creators:', req.user);
    const query = req.query.query;
    console.log('Search creators query:', query);
    if (!query || query.trim() === '') {
      return res.json({ creators: [] });
    }

    const matchingCreators = await User.find({
      role: 'creator',
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { profileName: { $regex: query, $options: 'i' } },
      ],
    })
      .select('username profileName profilePicture subscriberCount')
      .limit(5);

    // Update subscriberCount for each creator
    for (const creator of matchingCreators) {
      await creator.updateSubscriberCount();
    }

    console.log('Matching creators for search:', matchingCreators);
    res.json({ creators: matchingCreators });
  } catch (err) {
    console.error('Error in search-creators route:', err);
    res.status(500).json({ message: 'Error fetching search results', error: err.message });
  }
});

module.exports = router;