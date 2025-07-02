// routes/chat.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Chat = require('../models/chat');
const { body, param, validationResult } = require('express-validator'); // Add param here
const logger = require('../logs/logger'); // Import Winston logger at top

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    logger.warn('Unauthorized access attempt to chat page');
    req.flash('error_msg', 'You must be logged in to access chat.');
    return res.redirect('/');
  }
  next();
};

// Route for initiating a chat using a query parameter (e.g., /chat?creatorId=...)
router.get('/', authCheck, async (req, res) => {
  try {
    const { creatorId } = req.query;
    if (!creatorId) {
      logger.warn('No creator specified for chat');
      req.flash('error_msg', 'No creator specified for chat.');
      return res.redirect('/home');
    }

    const currentUser = req.user;
    const creator = await User.findById(creatorId);
    if (!creator) {
      logger.warn('Creator not found for chat initiation');
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
        logger.warn('User not subscribed to creator for chat initiation');
        req.flash('error_msg', 'You must be subscribed to start a chat with this creator.');
        return res.redirect('/profile/view/' + creatorId);
      }
      chat = new Chat({ participants, messages: [] });
      await chat.save();
    }

    return res.redirect(`/chat/${chat._id}`);
  } catch (error) {
    logger.error(`Error initiating chat: ${error.message}`);
    req.flash('error_msg', 'Error initiating chat.');
    res.redirect('/home');
  }
});

// Route to render the chat view for a given chat ID
router.get('/:chatId', authCheck, async (req, res) => {
  try {
    const chatId = req.params.chatId;
    let chat = await Chat.findById(chatId)
      .populate('participants', 'username profilePicture role isOnline lastSeen');
    if (!chat) {
      logger.warn('Chat not found in /:chatId');
      req.flash('error_msg', 'Chat not found.');
      return res.redirect('/chats');
    }
    const currentUser = req.user;

    if (!chat.participants.some(p => p._id.toString() === currentUser._id.toString())) {
      logger.warn('Unauthorized access to chat in /:chatId');
      req.flash('error_msg', 'You are not authorized to view this chat.');
      return res.redirect('/chats');
    }

    // Mark messages as read
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
    logger.error(`Error loading chat: ${error.message}`);
    req.flash('error_msg', 'Error loading chat.');
    res.redirect('/chats');
  }
});
router.get('/media/:sessionId', [
  param('sessionId').isMongoId().withMessage('Invalid session ID'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(`Validation errors in GET /chat/media/:sessionId: ${JSON.stringify(errors.array())}`);
      return res.status(400).json({ error: errors.array().map(e => e.msg).join(', ') });
    }

    if (!req.user) {
      logger.warn(`No user authenticated for /chat/media/${req.params.sessionId}`);
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;
    const userId = req.user._id;

    const SignedUrlSession = require('../models/signedUrlSession');
    let session = await SignedUrlSession.findOne({
      _id: sessionId,
      userId,
      isActive: true,
      chatId: { $exists: true }, // Ensure this is a chat-related session
    });

    if (!session) {
      logger.warn(`Invalid or unauthorized chat media access by user ${userId} for session ${sessionId}`);
      return res.status(403).json({ error: 'Access denied' });
    }

    if (new Date() > session.sessionExpiresAt) {
      logger.warn(`Expired session access by user ${userId} for session ${sessionId}`);
      await SignedUrlSession.deleteOne({ _id: sessionId });
      return res.status(403).json({ error: 'Session expired' });
    }

    const twoMinutesFromNow = new Date(Date.now() + 2 * 60 * 1000);
    if (session.signedUrlExpiresAt < twoMinutesFromNow) {
      logger.info(`Regenerating signed URL for chat media session ${sessionId}`);
      session = await require('../utilis/cloudStorage').regenerateSignedUrl(sessionId);
    }

    try {
      await require('../utilis/cloudStorage').extendSessionActivity(userId, sessionId);
    } catch (err) {
      logger.warn(`Failed to extend session activity for user ${userId}, session ${sessionId}: ${err.message}`);
    }

    const method = req.method.toLowerCase();
    if (method !== 'head' && method !== 'get') {
      return res.status(405).send('Method not allowed');
    }

    const axiosConfig = {
      method,
      url: session.signedUrl,
      responseType: method === 'get' ? 'stream' : undefined,
      timeout: 120000,
      headers: { 'Connection': 'keep-alive' },
    };
    if (method === 'get' && req.headers.range) {
      axiosConfig.headers.Range = req.headers.range;
      res.set('Accept-Ranges', 'bytes');
    }
    const axiosResponse = await require('axios')(axiosConfig);

    const headers = {
      'Content-Type': axiosResponse.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=300',
      'Connection': 'keep-alive',
    };
    if (method === 'get') {
      if (req.headers.range && axiosResponse.headers['content-range']) {
        headers['Content-Range'] = axiosResponse.headers['content-range'];
        headers['Content-Length'] = axiosResponse.headers['content-length'];
        res.status(206);
      } else {
        headers['Content-Length'] = axiosResponse.headers['content-length'];
        res.status(200);
      }
    }
    res.set(headers);

    if (method === 'head') {
      return res.status(axiosResponse.status).end();
    }

    let completed = false;
    res.on('finish', () => {
      completed = true;
    });

    axiosResponse.data.pipe(res);

    axiosResponse.data.on('error', (err) => {
      if (!completed) {
        if (err.code === 'ECONNABORTED' || err.message.includes('aborted')) {
          logger.info(`Stream aborted by client for session ${sessionId}: ${err.message}`);
        } else {
          logger.error(`Stream error for session ${sessionId}: ${err.message}`);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Stream error' });
          }
        }
      }
    });
  } catch (err) {
    if (err.response) {
      logger.warn(`Storage provider error for session ${req.params.sessionId}: ${err.response.status} ${err.response.statusText}`);
      return res.status(err.response.status).send(err.response.statusText);
    }
    logger.error(`Error in chat media proxy for session ${req.params.sessionId}: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Route to serve signed URLs for chat media
router.get('/media-session/:chatId/:filename', authCheck, async (req, res) => {
  try {
    const { chatId, filename } = req.params;
    const userId = req.user._id;

    // Validate chat access
    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.some(p => p._id.toString() === userId.toString())) {
      logger.warn(`Unauthorized access attempt to chat media: user ${userId}, chat ${chatId}`);
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Create or reuse a session for the chat media
    const { createSignedUrlSessionForChatMedia } = require('../utilis/cloudStorage');
    const sessionId = await createSignedUrlSessionForChatMedia(userId, filename, chatId);

    // Return the proxy URL
    const proxyUrl = `/chat/media/${sessionId}`;
    res.json({ url: proxyUrl });
  } catch (err) {
    logger.error(`Error generating chat media session for user ${req.user._id}, chat ${chatId}, filename ${filename}: ${err.message}`);
    res.status(500).json({ error: 'Failed to generate media session' });
  }
});

module.exports = router;