const express = require('express');
const router = express.Router();

const authCheck = (req, res, next) => {
  if (!req.user) {
    req.flash('error_msg', 'You must be logged in.');
    return res.redirect('/users/login');
  }
  next();
};

router.get('/', authCheck, (req, res) => {
  console.log('User role:', req.user.role); // Debug log
  if (req.user.role !== 'creator') {
    req.flash('error_msg', 'Only creators can broadcast messages.');
    return res.redirect('/chats');
  }
  res.render('chatbroadcast', { currentUser: req.user });
});

router.post('/', authCheck, async (req, res) => {
  if (req.user.role !== 'creator') {
    req.flash('error_msg', 'Only creators can broadcast messages.');
    return res.redirect('/chats');
  }
  const message = req.body.message;
  console.log('Broadcast message:', message);
  req.flash('success_msg', 'Broadcast message sent (logic not fully implemented).');
  res.redirect('/chats');
});

module.exports = router;