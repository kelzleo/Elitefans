// routes/requestCreator.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const { creatorRequestsBucket } = require('../utilis/cloudStorage');
const CreatorRequest = require('../models/CreatorRequest');
const User = require('../models/users');
const logger = require('../logs/logger'); // Import Winston logger at top

// Use multer with memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    logger.warn('Unauthorized access attempt to request-creator page');
    return res.redirect('/');
  }
  next();
};

// Render the "Request to Become a Creator" page
router.get('/', authCheck, async (req, res) => {
  try {
    const existingRequest = await CreatorRequest.findOne({ user: req.user.id, status: 'pending' });
    const requestPending = !!existingRequest;
    res.render('request-creator', { user: req.user, requestPending });
  } catch (err) {
    logger.error(`Error rendering creator request page: ${err.message}`);
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
    stream.on('error', (err) => {
      logger.error(`Error uploading to creator requests bucket: ${err.message}`);
      reject(err);
    });
    stream.on('finish', () => resolve(file.name));
    stream.end(fileBuffer);
  });
};

// Retry helper for transient errors
const retry = async (fn, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1 || err.response?.status === 400 || err.response?.status === 401 || err.response?.status === 405) {
        throw err;
      }
      logger.warn(`Retry ${i + 1}/${retries} for API request`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Estimate age using configured API
router.post('/estimate-age', authCheck, async (req, res) => {
  try {
    const { photoData } = req.body;
    if (!photoData) {
      logger.warn('No photoData received in /estimate-age');
      return res.status(400).json({ success: false, message: 'Photo data is required.' });
    }

    // Extract base64 data
    const matches = photoData.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      logger.warn('Invalid photoData format in /estimate-age');
      return res.status(400).json({ success: false, message: 'Invalid photo data.' });
    }
    const base64Data = matches[2];

    // Select API provider
    const provider = process.env.AGE_API_PROVIDER || 'facepp';
    let age;

    if (provider === 'facepp') {
      // Face++ API
      const faceppKey = process.env.FACEPP_API_KEY;
      const faceppSecret = process.env.FACEPP_API_SECRET;
      const faceppDetectEndpoint = process.env.FACEPP_API_ENDPOINT;
      if (!faceppKey || !faceppSecret || !faceppDetectEndpoint) {
        logger.error('Face++ configuration missing');
        return res.status(500).json({
          success: false,
          message: 'Photo processing is temporarily unavailable. Please try again later.',
        });
      }

      // Step 1: Call Detect API to get face_token
      const detectUrl = `${faceppDetectEndpoint}?api_key=${faceppKey}&api_secret=${faceppSecret}`;

      let detectResponse;
      try {
        detectResponse = await retry(() =>
          axios.post(
            detectUrl,
            `image_base64=${encodeURIComponent(base64Data)}`,
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              timeout: 10000,
            }
          )
        );
      } catch (err) {
        logger.error(`Face++ Detect API error: ${err.message}`);
        return res.status(500).json({
          success: false,
          message: 'Error processing photo. Please try again.',
        });
      }

      const faces = detectResponse.data.faces || [];
      if (faces.length === 0) {
        logger.warn('No face detected in photo (Face++ Detect)');
        return res.status(400).json({
          success: false,
          message: 'No face detected in the photo. Please ensure your face is clearly visible.',
        });
      }

      const faceToken = faces[0].face_token;

      // Step 2: Call Analyze API to get age
      const analyzeUrl = `https://api-us.faceplusplus.com/facepp/v3/face/analyze?api_key=${faceppKey}&api_secret=${faceppSecret}&face_tokens=${faceToken}&return_attributes=age`;

      let analyzeResponse;
      try {
        analyzeResponse = await retry(() =>
          axios.post(
            analyzeUrl,
            {},
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              timeout: 10000,
            }
          )
        );
      } catch (err) {
        logger.error(`Face++ Analyze API error: ${err.message}`);
        return res.status(500).json({
          success: false,
          message: 'Error processing photo. Please try again.',
        });
      }

      const analyzedFaces = analyzeResponse.data.faces || [];
      if (analyzedFaces.length === 0) {
        logger.warn('No face analyzed (Face++ Analyze)');
        return res.status(400).json({
          success: false,
          message: 'Failed to analyze face. Please try again.',
        });
      }

      age = analyzedFaces[0].attributes.age.value;
    } else {
      logger.error('Unsupported API provider configured');
      return res.status(500).json({
        success: false,
        message: 'Unsupported API provider configured.',
      });
    }

    return res.json({ success: true, age });
  } catch (err) {
    logger.error(`API error in /estimate-age: ${err.message}`);
    const userMessage =
      err.response?.status === 405
        ? 'Photo processing is temporarily unavailable. Please try again later.'
        : 'Error processing photo. Please ensure a clear face is visible and try again.';
    return res.status(500).json({ success: false, message: userMessage });
  }
});

// Handle "Request to Become a Creator" submission
router.post('/', authCheck, upload.none(), async (req, res) => {
  try {
    const { bvn, firstName, lastName, passportPhotoData, estimatedAge } = req.body;

    // Validate inputs
    if (!bvn || !/^\d{11}$/.test(bvn)) {
      logger.warn('Invalid BVN in creator request');
      throw new Error('BVN must be an 11-digit number.');
    }
    if (!firstName || !lastName || !passportPhotoData || !estimatedAge) {
      logger.warn('Missing required fields in creator request');
      throw new Error('All fields are required, and photo must be processed successfully.');
    }

    // Check for existing pending request
    const existingRequest = await CreatorRequest.findOne({ user: req.user.id, status: 'pending' });
    if (existingRequest) {
      logger.warn('Existing pending creator request found');
      req.flash('error_msg', 'You have already submitted a creator request. Approval could take 24–72 hours.');
      return res.redirect('/request-creator');
    }

    // Process passport photo
    const matches = passportPhotoData.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      logger.warn('Invalid image data in creator request');
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
    logger.error(`Error submitting creator request: ${err.message}`);
    req.flash('error_msg', err.message || 'An error occurred. Please try again.');
    res.redirect('/request-creator');
  }
});

module.exports = router;