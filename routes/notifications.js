// routes/notifications.js
const express = require('express');
const router = express.Router();
const Notification = require('../models/notifications'); // Notice the filename
const User = require('../models/users');

// Authentication middleware
function authCheck(req, res, next) {
  if (!req.user) {
    return res.redirect('/');
  }
  next();
}

// GET /notifications - Show the user's notifications
router.get('/', authCheck, async (req, res) => {
  try {
    // Find notifications for the current user
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 });

    // Render an EJS view
    res.render('notifications', { notifications });
  } catch (err) {
    console.error('Error loading notifications:', err);
    res.status(500).send('Error loading notifications');
  }
});

module.exports = router;
