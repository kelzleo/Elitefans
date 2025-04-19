// routes/chatlist.js
const express = require('express');
const router = express.Router();
const Chat = require('../models/chat');
const User = require('../models/users');
const logger = require('../logs/logger'); // Import Winston logger at top

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    logger.warn('Unauthorized access attempt to chat list page');
    req.flash('error_msg', 'You must be logged in to view your chats.');
    return res.redirect('/users/login');
  }
  next();
};

router.get('/', authCheck, async (req, res) => {
  try {
    const currentUser = req.user;
    // Find all chats where the current user is a participant
    const chats = await Chat.find({ participants: currentUser._id })
      .populate('participants', 'username profilePicture isOnline lastSeen')
      .sort({ updatedAt: -1 });

    // Add unread status and latest message details to each chat
    const chatsWithStatus = chats.map(chat => {
      // Check for unread messages
      const hasUnread = chat.messages.some(
        message =>
          message.sender.toString() !== currentUser._id.toString() &&
          !message.readBy.includes(currentUser._id.toString())
      );
      
      // Get the latest message (text or media)
      const latestMessage = chat.messages.length > 0 
        ? chat.messages.sort((a, b) => b.timestamp - a.timestamp)[0] 
        : null;
      
      // Determine preview content based on the latest message
      let previewText = 'No messages yet.';
      let mediaType = null;
      let isTip = false;
      let tipAmount = null;

      if (latestMessage) {
        if (latestMessage.text) {
          previewText = latestMessage.text;
        } else if (latestMessage.media && latestMessage.media.url) {
          mediaType = latestMessage.media.type; // 'image' or 'video'
        }
        isTip = latestMessage.isTip || false;
        tipAmount = isTip ? latestMessage.tipAmount : null;
      }

      return { 
        ...chat.toObject(), 
        hasUnread, 
        previewText, 
        mediaType, 
        isTip, 
        tipAmount 
      };
    });

    res.render('chatList', { chats: chatsWithStatus, currentUser });
  } catch (error) {
    logger.error(`Error loading chat list: ${error.message}`);
    req.flash('error_msg', 'Error loading chat list.');
    res.redirect('/home');
  }
});

module.exports = router;