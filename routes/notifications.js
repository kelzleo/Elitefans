// routes/notifications.js
const express = require('express');
const router = express.Router();
const Notification = require('../models/notifications'); // Correct filename (plural)
const logger = require('../logs/logger'); // Import Winston logger

// Authentication middleware
function authCheck(req, res, next) {
  if (!req.user) {
    req.flash('error', 'Please log in to view notifications.');
    return res.redirect('/');
  }
  next();
}

// GET /notifications - Show the user's notifications
router.get('/', authCheck, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(); // Optimize query performance
    res.render('notifications', {
      notifications,
      errorMessage: req.flash('error'),
      successMessage: req.flash('success')
    });
  } catch (error) {
    logger.error(`Error loading notifications for user ${req.user._id}: ${error.message}`);
    req.flash('error', 'Failed to load notifications. Please try again.');
    res.redirect('/home');
  }
});

// POST /notifications/:id/read - Mark a notification as read
router.post('/:id/read', authCheck, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      user: req.user._id
    });
    if (!notification) {
      req.flash('error', 'Notification not found.');
      return res.redirect('/notifications');
    }
    notification.isRead = true;
    await notification.save();
    req.flash('success', 'Notification marked as read.');
    res.redirect('/notifications');
  } catch (error) {
    logger.error(`Error marking notification ${req.params.id} as read for user ${req.user._id}: ${error.message}`);
    req.flash('error', 'Failed to mark notification as read.');
    res.redirect('/notifications');
  }
});

module.exports = router;