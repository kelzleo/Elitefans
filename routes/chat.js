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
    const creator = await User.findById(creatorId);
    if (!creator) {
      req.flash('error_msg', 'Creator not found.');
      return res.redirect('/home');
    }

    // Check if there's an existing chat
    const participants = [creatorId, currentUser._id.toString()].sort();
    let chat = await Chat.findOne({ participants });

    // If no chat exists, check subscription for new chat creation
    if (!chat) {
      const isSubscribed = currentUser.subscriptions.some(
        (sub) => sub.creatorId.toString() === creatorId && sub.status === 'active'
      );
      if (!isSubscribed) {
        req.flash('error_msg', 'You must be subscribed to start a chat with this creator.');
        return res.redirect('/profile/view/' + creatorId);
      }
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
// In the chat view route handler:
router.get('/:chatId', authCheck, async (req, res) => {
  try {
    const chatId = req.params.chatId;
    let chat = await Chat.findById(chatId)
      .populate('participants', 'username profilePicture role isOnline lastSeen');
    if (!chat) {
      req.flash('error_msg', 'Chat not found.');
      return res.redirect('/chats');
    }
    const currentUser = req.user;

    if (!chat.participants.some(p => p._id.toString() === currentUser._id.toString())) {
      req.flash('error_msg', 'You are not authorized to view this chat.');
      return res.redirect('/chats');
    }

    // Mark messages as read - fixed to use readBy array
    let updated = false;
    chat.messages.forEach(message => {
      if (message.sender.toString() !== currentUser._id.toString() && 
          !message.readBy.includes(currentUser._id.toString())) {
        message.readBy.push(currentUser._id);
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

// Route to serve signed URLs for chat media
router.get('/media/:chatId/:filename', authCheck, async (req, res) => {
  try {
    const { chatId, filename } = req.params;
    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.some(p => p._id.toString() === req.user._id.toString())) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const signedUrl = await require('../utilis/cloudStorage').generateSignedUrlForChatMedia(filename, req.user._id, chatId);
    res.json({ url: signedUrl });
  } catch (err) {
    console.error('Error serving chat media:', err);
    res.status(500).json({ error: 'Failed to serve media' });
  }
});

module.exports = router;