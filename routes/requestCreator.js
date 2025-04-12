// routes/requestCreator.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcrypt');
const { creatorRequestsBucket } = require('../utilis/cloudStorage');
const CreatorRequest = require('../models/CreatorRequest');
const User = require('../models/users');
const { verifyBVNInfo } = require('../utilis/flutter'); // Adjust path as needed

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
    stream.on('finish', () => {
      resolve(file.name);
    });
    stream.end(fileBuffer);
  });
};

// Handle "Request to Become Creator" submission
// Handle "Request to Become Creator" submission
router.post('/', authCheck, upload.none(), async (req, res) => {
  try {
    const { bvn, firstName, lastName, passportPhotoData } = req.body;

    // Log incoming data for debugging (without showing the full BVN)
    console.log('Received form data:', { 
      bvn: bvn ? `${bvn.substring(0, 4)}*******` : 'Missing', 
      firstName, 
      lastName, 
      passportPhotoData: passportPhotoData ? 'Provided' : 'Missing' 
    });

    // Validate inputs
    if (!bvn || !firstName || !lastName || !passportPhotoData) {
      throw new Error('All fields are required: BVN, first name, last name, and passport photo.');
    }

    // Check for an existing pending request
    const existingRequest = await CreatorRequest.findOne({ user: req.user.id, status: 'pending' });
    if (existingRequest) {
      req.flash('error_msg', 'You have already submitted a creator request. Approval could take 24–72 hours.');
      return res.redirect('/request-creator');
    }

    try {
      // Verify BVN
      console.log(`Attempting to verify BVN for ${firstName} ${lastName}...`);
      const bvnData = await verifyBVNInfo(bvn, firstName, lastName);
      console.log('BVN verification successful');
      
      // The updated verifyBVNInfo function will already check if names match
      // so we don't need the explicit check here anymore
      
      // Encrypt BVN before storing
      const saltRounds = 10;
      const encryptedBVN = await bcrypt.hash(bvn, saltRounds);

      // Process passport photo
      const matches = passportPhotoData.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new Error('Invalid image data. Please try capturing your photo again.');
      }
      const mimeType = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');

      const fileName = `${req.user.id}-${Date.now()}-passport.png`;
      const storedFileName = await uploadToCreatorRequestsBucket(buffer, fileName, mimeType);

      // Create a new CreatorRequest document
      const newRequest = new CreatorRequest({
        user: req.user.id,
        bvn: encryptedBVN,
        firstName,
        lastName,
        passportPhotoUrl: storedFileName,
        bvnVerificationData: {
          verifiedFirstName: bvnData.first_name,
          verifiedLastName: bvnData.last_name,
          verifiedAt: new Date()
        }
      });

      await newRequest.save();

      // Update the user record
      const user = await User.findById(req.user.id);
      if (user && !user.requestToBeCreator) {
        user.requestToBeCreator = true;
        await user.save();
      }

      req.flash('success_msg', 'Your creator request has been submitted successfully! Approval could take 24–72 hours.');
      res.redirect('/request-creator');
    } catch (verifyError) {
      console.error('BVN verification error details:', verifyError);
      
      // Map specific error messages to user-friendly messages
      if (verifyError.message.includes('names do not match')) {
        req.flash('error_msg', 'The names you provided do not match the BVN records. Please ensure you enter your legal name exactly as registered with your bank.');
      } else if (verifyError.message.includes('API key')) {
        console.error('API Configuration Error:', verifyError.message);
        req.flash('error_msg', 'Our verification system is experiencing configuration issues. Please try again later or contact support.');
      } else if (verifyError.message.includes('Network error')) {
        req.flash('error_msg', 'Could not connect to the verification service. Please check your internet connection and try again.');
      } else if (verifyError.message.includes('balance')) {
        req.flash('error_msg', 'Verification service is temporarily unavailable. Please try again later or contact support.');
      } else {
        req.flash('error_msg', verifyError.message || 'An error occurred during BVN verification. Please try again later.');
      }
      
      res.redirect('/request-creator');
    }
  } catch (err) {
    console.error('Error submitting creator request:', err);
    req.flash('error_msg', err.message || 'An error occurred. Please try again.');
    res.redirect('/request-creator');
  }
});

module.exports = router;