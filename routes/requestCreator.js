// routes/requestCreator.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { creatorRequestsBucket } = require('../utilis/cloudStorage');
const CreatorRequest = require('../models/CreatorRequest');
const User = require('../models/users');

// Use multer with memory storage (for parsing text fields)
const upload = multer({ storage: multer.memoryStorage() });

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) return res.redirect('/');
  next();
};

// Render the "Request to Become a Creator" page
router.get('/', authCheck, async (req, res) => {
  try {
    // Check if there's already a pending request for this user
    const existingRequest = await CreatorRequest.findOne({ user: req.user.id, status: 'pending' });
    const requestPending = !!existingRequest;
    res.render('request-creator', { user: req.user, requestPending });
  } catch (err) {
    console.error(err);
    res.render('request-creator', { user: req.user, requestPending: false });
  }
});

// Helper: Upload a buffer to the creator requests bucket
const uploadToCreatorRequestsBucket = (fileBuffer, fileName, mimeType) => {
  return new Promise((resolve, reject) => {
    const file = creatorRequestsBucket.file(fileName);
    const stream = file.createWriteStream({
      metadata: { contentType: mimeType },
    });
    stream.on('error', err => reject(err));
    stream.on('finish', () => {
      // File remains private by default
      resolve(file.name);
    });
    stream.end(fileBuffer);
  });
};

// Handle "Request to Become Creator" submission
router.post('/', authCheck, upload.none(), async (req, res) => {
  try {
    const { bvn, fullName, firstName, passportPhotoData } = req.body;
    
    if (!passportPhotoData) {
      throw new Error("No passport photo data received. Please capture your photo before submitting.");
    }
    
    // Check for an existing pending request
    const existingRequest = await CreatorRequest.findOne({ user: req.user.id, status: 'pending' });
    if (existingRequest) {
      req.flash('error_msg', 'You have already submitted a creator request. Approval could take 24–72 hours.');
      return res.redirect('/request-creator');
    }
    
    const matches = passportPhotoData.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid image data. Please try capturing your photo again.');
    }
    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    const fileName = Date.now() + '-passport.png';
    const storedFileName = await uploadToCreatorRequestsBucket(buffer, fileName, mimeType);

    // Create a new CreatorRequest document
    const newRequest = new CreatorRequest({
      user: req.user.id,
      bvn,
      fullName,
      firstName,
      passportPhotoUrl: storedFileName,
    });
    await newRequest.save();

    // Update the user record if not already set
    const user = await User.findById(req.user.id);
    if (user && !user.requestToBeCreator) {
      user.requestToBeCreator = true;
      await user.save();
    }

    req.flash('success_msg', 'Your creator request has been submitted! Approval could take 24–72 hours.');
    res.redirect('/request-creator');
  } catch (err) {
    console.error('Error submitting creator request:', err);
    req.flash('error_msg', err.message || 'An error occurred. Please try again.');
    res.redirect('/request-creator');
  }
});

module.exports = router;
