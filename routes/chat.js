const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Chat = require('../models/chat');

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    req.flash('error_msg', 'You must be logged in to access chat.');
    return res.redirect('/users/login');
  }
  next();
};

// Route for initiating a chat using a query parameter (e.g., /chat?creatorId=...)
router.get('/', authCheck, async (req, res) => {
  try {
    const { creatorId } = req.query;
    if (!creatorId) {
      req.flash('error_msg', 'No creator specified for chat.');
      return res.redirect('/home');
    }
    
    const currentUser = req.user;
    const isSubscribed = currentUser.subscriptions.some(
      (sub) => sub.creatorId.toString() === creatorId && sub.status === 'active'
    );
    
    if (!isSubscribed) {
      req.flash('error_msg', 'You must be subscribed to chat with this creator.');
      return res.redirect('/profile/view/' + creatorId);
    }
    
    const participants = [creatorId, currentUser._id.toString()].sort();
    let chat = await Chat.findOne({ participants });
    if (!chat) {
      chat = new Chat({ participants, messages: [] });
      await chat.save();
    }
    
    return res.redirect(`/chat/${chat._id}`);
  } catch (error) {
    console.error('Error initiating chat:', error);
    req.flash('error_msg', 'Error initiating chat.');
    res.redirect('/home');
  }
});

// Route to render the chat view for a given chat ID
router.get('/:chatId', authCheck, async (req, res) => {
  try {
    const chatId = req.params.chatId;
    let chat = await Chat.findById(chatId).populate('participants');
    if (!chat) {
      req.flash('error_msg', 'Chat not found.');
      return res.redirect('/chats');
    }
    const currentUser = req.user;
    
    if (!chat.participants.some(p => p._id.toString() === currentUser._id.toString())) {
      req.flash('error_msg', 'You are not authorized to view this chat.');
      return res.redirect('/chats');
    }
    
    // Mark messages as read
    let updated = false;
    chat.messages.forEach(message => {
      if (!message.read && message.sender.toString() !== currentUser._id.toString()) {
        message.read = true;
        updated = true;
      }
    });
    if (updated) {
      chat.updatedAt = new Date();
      await chat.save();
    }

    let otherParticipant;
    if (chat.participants.length === 2) {
      otherParticipant = chat.participants.find(p => p._id.toString() !== currentUser._id.toString());
    }
    
    res.render('chat', { chat, creator: otherParticipant, currentUser });
  } catch (error) {
    console.error('Error loading chat:', error);
    req.flash('error_msg', 'Error loading chat.');
    res.redirect('/chats');
  }
});

module.exports = router;