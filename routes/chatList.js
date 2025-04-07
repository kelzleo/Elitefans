const express = require('express');
const router = express.Router();
const Chat = require('../models/chat');
const User = require('../models/users');

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    req.flash('error_msg', 'You must be logged in to view your chats.');
    return res.redirect('/users/login');
  }
  next();
};

router.get('/', authCheck, async (req, res) => {
  try {
    const currentUser = req.user;
    // Find all chats where the current user is a participant,
    // sorted by updatedAt in descending order (most recent first)
    const chats = await Chat.find({ participants: currentUser._id })
      .populate('participants')
      .sort({ updatedAt: -1 });

    // Add unread status to each chat
    const chatsWithStatus = chats.map(chat => {
      const hasUnread = chat.messages.some(
        message => !message.read && message.sender.toString() !== currentUser._id.toString()
      );
      return { ...chat.toObject(), hasUnread };
    });

    console.log(`Loaded ${chats.length} chats for user ${currentUser._id}`);
    res.render('chatList', { chats: chatsWithStatus, currentUser });
  } catch (error) {
    console.error('Error loading chat list:', error);
    req.flash('error_msg', 'Error loading chat list.');
    res.redirect('/home');
  }
});

module.exports = router;