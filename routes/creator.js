const express = require('express');
const router = express.Router();
const SubscriptionBundle = require('../models/SubscriptionBundle');

// (Optional) Add your authentication middleware if this route is for logged-in creators
const authCheck = (req, res, next) => {
  if (!req.user) {
    return res.status(401).send('You must be logged in.');
  }
  next();
};

// Create a new subscription bundle
// Create a new subscription bundle
router.post('/create-bundle', authCheck, async (req, res) => {
  try {
    if (req.user.role !== 'creator') {
      return res.status(403).send('Only creators can create bundles.');
    }

    // 1) Count existing bundles
    const existingCount = await SubscriptionBundle.countDocuments({
      creatorId: req.user._id
    });
    if (existingCount >= 4) {
      // If user already has 4 bundles, block creation
      return res.status(400).send('You have reached the maximum of 4 bundles.');
    }

    const { price, duration, description } = req.body;

    // 2) Validate the duration
    const validDurations = ['1 day', '1 month', '3 months', '6 months', '1 year'];
    if (!validDurations.includes(duration)) {
      return res.status(400).send('Invalid duration selected.');
    }

    // 3) Create the new bundle
    const bundle = new SubscriptionBundle({
      price,
      duration,
      description,
      creatorId: req.user._id,
    });
    await bundle.save();

    res.redirect('/profile'); // Or wherever you want to redirect
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating bundle');
  }
});

module.exports = router;
