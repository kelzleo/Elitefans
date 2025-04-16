// routes/requestCreator.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const { creatorRequestsBucket } = require('../utilis/cloudStorage');
const CreatorRequest = require('../models/CreatorRequest');
const User = require('../models/users');

// Use multer with memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) return res.redirect('/');
  next();
};

// Render the "Request to Become a Creator" page
router.get('/', authCheck, async (req, res) => {
  try {
    const existingRequest = await CreatorRequest.findOne({ user: req.user.id, status: 'pending' });
    const requestPending = !!existingRequest;
    res.render('request-creator', { user: req.user, requestPending });
  } catch (err) {
    console.error('Error rendering creator request page:', err);
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
    stream.on('finish', () => resolve(file.name));
    stream.end(fileBuffer);
  });
};

// Estimate age using Luxand.cloud API
router.post('/estimate-age', authCheck, async (req, res) => {
  try {
    const { photoData } = req.body;
    if (!photoData) {
      return res.status(400).json({ success: false, message: 'Photo data is required.' });
    }

    // Extract base64 data
    const matches = photoData.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ success: false, message: 'Invalid photo data.' });
    }
    const base64Data = matches[2];

    // Call Luxand API
    const luxandUrl = `${process.env.LUXAND_API_ENDPOINT}?attributes=1`;
    const luxandKey = process.env.LUXAND_API_KEY;

    const response = await axios.post(
      luxandUrl,
      {
        photo: base64Data,
      },
      {
        headers: {
          'token': luxandKey,
          'Content-Type': 'application/json',
        },
      }
    );

    const faces = response.data.faces || [];
    if (faces.length === 0) {
      return res.status(400).json({ success: false, message: 'No face detected in the photo.' });
    }

    const age = faces[0].age;
    return res.json({ success: true, age });
  } catch (err) {
    console.error('Error estimating age:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Error processing photo.' });
  }
});

// Handle "Request to Become a Creator" submission
router.post('/', authCheck, upload.none(), async (req, res) => {
  try {
    const { bvn, firstName, lastName, passportPhotoData, estimatedAge } = req.body;

    // Validate inputs
    if (!bvn || !/^\d{11}$/.test(bvn)) {
      throw new Error('BVN must be an 11-digit number.');
    }
    if (!firstName || !lastName || !passportPhotoData || !estimatedAge) {
      throw new Error('All fields are required, and photo must be processed successfully.');
    }

    // Check for existing pending request
    const existingRequest = await CreatorRequest.findOne({ user: req.user.id, status: 'pending' });
    if (existingRequest) {
      req.flash('error_msg', 'You have already submitted a creator request. Approval could take 24–72 hours.');
      return res.redirect('/request-creator');
    }

    // Process passport photo
    const matches = passportPhotoData.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid image data. Please try capturing your photo again.');
    }
    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    const fileName = `${req.user.id}-${Date.now()}-passport.jpg`;
    const storedFileName = await uploadToCreatorRequestsBucket(buffer, fileName, mimeType);

    // Create a new CreatorRequest document
    const newRequest = new CreatorRequest({
      user: req.user.id,
      bvn,
      firstName,
      lastName,
      passportPhotoUrl: storedFileName,
      estimatedAge: parseInt(estimatedAge),
    });

    await newRequest.save();

    // Update user record
    const user = await User.findById(req.user.id);
    if (user && !user.requestToBeCreator) {
      user.requestToBeCreator = true;
      await user.save();
    }

    req.flash('success_msg', 'Your creator request has been submitted successfully! Approval could take 24–72 hours.');
    res.redirect('/request-creator');
  } catch (err) {
    console.error('Error submitting creator request:', err);
    req.flash('error_msg', err.message || 'An error occurred. Please try again.');
    res.redirect('/request-creator');
  }
});

module.exports = router;