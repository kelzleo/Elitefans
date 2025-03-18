const express = require('express');
const router = express.Router();

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    req.flash('error_msg', 'You must be logged in.');
    return res.redirect('/users/login');
  }
  next();
};

router.get('/', authCheck, (req, res) => {
  // Only allow creators to access this page
  if (req.user.role !== 'creator') {
    req.flash('error_msg', 'Only creators can broadcast messages.');
    return res.redirect('/chats');
  }
  res.render('chatBroadcast', { currentUser: req.user });
});

router.post('/', authCheck, async (req, res) => {
  if (req.user.role !== 'creator') {
    req.flash('error_msg', 'Only creators can broadcast messages.');
    return res.redirect('/chats');
  }
  const message = req.body.message;
  // Implement your broadcast logic here:
  // e.g., find all users subscribed to this creator,
  // then for each subscriber, create or update a chat conversation
  // and push the broadcast message.
  console.log('Broadcast message:', message);
  req.flash('success_msg', 'Broadcast message sent (logic not fully implemented).');
  res.redirect('/chats');
});

module.exports = router;
