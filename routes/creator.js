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
router.post('/create-bundle', authCheck, async (req, res) => {
    try {
        const { price, duration, description } = req.body;
        // Include creatorId from req.user
        const bundle = new SubscriptionBundle({ 
          price, 
          duration, 
          description,
          creatorId: req.user._id  // Now the bundle is correctly associated with the creator
        });
        await bundle.save();
        res.send(`Bundle created successfully. Price: ${bundle.price}, Duration: ${bundle.duration}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error creating bundle');
    }
});

module.exports = router;
