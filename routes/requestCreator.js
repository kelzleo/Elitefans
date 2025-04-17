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

// Retry helper for transient errors
const retry = async (fn, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1 || err.response?.status === 400 || err.response?.status === 401 || err.response?.status === 405) {
        throw err;
      }
      console.log(`Retry ${i + 1}/${retries} for API request`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Estimate age using configured API
router.post('/estimate-age', authCheck, async (req, res) => {
  try {
    const { photoData } = req.body;
    if (!photoData) {
      console.error('No photoData received in /estimate-age for user:', req.user.id);
      return res.status(400).json({ success: false, message: 'Photo data is required.' });
    }

    // Extract base64 data
    const matches = photoData.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      console.error('Invalid photoData format for user:', req.user.id);
      return res.status(400).json({ success: false, message: 'Invalid photo data.' });
    }
    const base64Data = matches[2];
    const payloadSize = Buffer.from(base64Data, 'base64').length / 1024;
    console.log('Base64 payload size:', payloadSize, 'KB for user:', req.user.id);

    // Select API provider
    const provider = process.env.AGE_API_PROVIDER || 'facepp'; // Default to Face++
    let age;

    if (provider === 'facepp') {
      // Face++ API
      const faceppKey = process.env.FACEPP_API_KEY;
      const faceppSecret = process.env.FACEPP_API_SECRET;
      const faceppDetectEndpoint = process.env.FACEPP_API_ENDPOINT; // https://api-us.faceplusplus.com/facepp/v3/detect
      if (!faceppKey || !faceppSecret || !faceppDetectEndpoint) {
        console.error('Face++ configuration missing:', {
          detectEndpoint: faceppDetectEndpoint,
          key: faceppKey ? 'Set' : 'Missing',
          secret: faceppSecret ? 'Set' : 'Missing',
          userId: req.user.id,
        });
        return res.status(500).json({
          success: false,
          message: 'Photo processing is temporarily unavailable. Please try again later.',
        });
      }

      // Step 1: Call Detect API to get face_token
      const detectUrl = `${faceppDetectEndpoint}?api_key=${faceppKey}&api_secret=${faceppSecret}`;
      console.log('Sending Face++ Detect API request for user:', req.user.id, 'to URL:', detectUrl);

      const cleanBase64 = base64Data;

      let detectResponse;
      try {
        detectResponse = await retry(() =>
          axios.post(
            detectUrl,
            `image_base64=${encodeURIComponent(cleanBase64)}`,
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              timeout: 10000,
            }
          )
        );
      } catch (err) {
        console.error('Face++ Detect API error for user:', req.user.id, {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
        });
        return res.status(500).json({
          success: false,
          message: 'Error processing photo. Please try again.',
        });
      }

      const faces = detectResponse.data.faces || [];
      if (faces.length === 0) {
        console.log('No face detected in photo (Face++ Detect) for user:', req.user.id);
        return res.status(400).json({
          success: false,
          message: 'No face detected in the photo. Please ensure your face is clearly visible.',
        });
      }

      const faceToken = faces[0].face_token;
      console.log('Face++ Detect API face_token:', faceToken, 'for user:', req.user.id);

      // Step 2: Call Analyze API to get age
      const analyzeUrl = `https://api-us.faceplusplus.com/facepp/v3/face/analyze?api_key=${faceppKey}&api_secret=${faceppSecret}&face_tokens=${faceToken}&return_attributes=age`;
      console.log('Sending Face++ Analyze API request for user:', req.user.id, 'to URL:', analyzeUrl);

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
        console.error('Face++ Analyze API error for user:', req.user.id, {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
        });
        return res.status(500).json({
          success: false,
          message: 'Error processing photo. Please try again.',
        });
      }

      const analyzedFaces = analyzeResponse.data.faces || [];
      if (analyzedFaces.length === 0) {
        console.log('No face analyzed (Face++ Analyze) for user:', req.user.id);
        return res.status(400).json({
          success: false,
          message: 'Failed to analyze face. Please try again.',
        });
      }

      age = analyzedFaces[0].attributes.age.value;
      console.log('Age estimated (Face++):', age, 'for user:', req.user.id);
    } else {
      return res.status(500).json({
        success: false,
        message: 'Unsupported API provider configured.',
      });
    }

    return res.json({ success: true, age });
  } catch (err) {
    console.error('API error for user:', req.user.id, {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
    });
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