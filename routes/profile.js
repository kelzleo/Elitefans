// profile.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { bucket, generateSignedUrl } = require('../utilis/cloudStorage');
const SubscriptionBundle = require('../models/SubscriptionBundle');
const flutter = require('../utilis/flutter');

// Set up multer to store files in memory
const multerStorage = multer.memoryStorage();
const upload = multer({ storage: multerStorage });

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) {
    return res.redirect('/');
  }
  next();
};

// Load profile page
// Load profile page
router.get('/', authCheck, async (req, res) => {
  try {
    console.log('Loading profile...');
    // Fetch the latest user data
    const user = await User.findById(req.user._id).populate('uploadedContent');
    console.log('User loaded:', user);

    // Generate a fresh signed URL for each piece of uploaded content
    // Assuming each content item has the blob name stored in 'filename'
    for (const content of user.uploadedContent) {
      // Check if the stored filename is not already a URL (i.e., doesn't start with 'http')
      if (!content.filename.startsWith('http')) {
        content.filename = await generateSignedUrl(content.filename);
      }
    }

    // Fetch only bundles created by this logged-in creator
    const bundles = await SubscriptionBundle.find({ creatorId: req.user._id });
    console.log('Bundles loaded:', bundles);
    res.render('profile', { user, currentUser: req.user, isSubscribed: false, bundles });
  } catch (err) {
    console.error('Error loading profile:', err);
    res.status(500).send('Error loading profile');
  }
});

// View another user's profile
// View another user's profile
router.get('/view/:id', authCheck, async (req, res) => {
  try {
    console.log('Loading user profile...');
    const user = await User.findById(req.params.id).populate('uploadedContent');
    console.log('User loaded:', user);

    // Generate fresh signed URLs for this user's uploaded content
    for (const content of user.uploadedContent) {
      if (!content.filename.startsWith('http')) {
        content.filename = await generateSignedUrl(content.filename);
      }
    }

    // Fetch only bundles for the viewed creator
    const bundles = await SubscriptionBundle.find({ creatorId: req.params.id });
    console.log('Bundles loaded:', bundles);
    if (!user) {
      return res.status(404).send('User not found');
    }

    // Enforce that only active subscriptions count
    const isSubscribed = req.user.subscriptions.some(
      (sub) =>
        sub.creatorId.toString() === user._id.toString() &&
        sub.status === 'active'
    );
    console.log('Is subscribed:', isSubscribed);

    res.render('profile', { user, currentUser: req.user, isSubscribed, bundles });
  } catch (err) {
    console.error('Error loading user profile:', err);
    res.status(500).send('Error loading profile');
  }
});


// Edit profile route (your own profile)
router.get('/edit', authCheck, (req, res) => {
  res.render('edit-profile', { user: req.user, currentUser: req.user });
});

// Profile route to handle POST request (edit profile)
router.post('/edit', authCheck, upload.single('profilePicture'), async (req, res) => {
  try {
    console.log('Updating profile...');
    const updates = {
      profileName: req.body.profileName,
      bio: req.body.bio,
    };

    if (req.file) {
      const uploadsDir = path.join(__dirname, '../public/uploads');
      await fs.mkdir(uploadsDir, { recursive: true });

      const filePath = path.join(uploadsDir, req.file.originalname);
      await fs.writeFile(filePath, req.file.buffer);

      updates.profilePicture = `/uploads/${req.file.originalname}`;
    }

    await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    res.redirect('/profile');
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).send('Error updating profile');
  }
});

// Corrected Content Upload Route (with write-up support)
router.post('/uploadContent', authCheck, upload.fields([{ name: 'contentImage' }, { name: 'contentVideo' }]), async (req, res) => {
  if (req.user.role !== 'creator') {
    return res.status(403).send('You do not have permission to upload content.');
  }
  const content = [];
  try {
    // Read the caption from the form
    const writeUp = req.body.writeUp || '';
    
    // Helper function to upload each file to cloud storage
    const uploadToCloud = async (file, type) => {
      const blobName = `uploads/${type}/${Date.now()}_${path.basename(file.originalname)}`;
      const blob = bucket.file(blobName);
      const blobStream = blob.createWriteStream({
        resumable: false,
        contentType: file.mimetype,
      });
      await new Promise((resolve, reject) => {
        blobStream.on('finish', async () => {
          // Save blobName along with the caption (writeUp)
          content.push({ filename: blobName, type, writeUp });
          resolve();
        });
        blobStream.on('error', (err) => reject(err));
        blobStream.end(file.buffer);
      });
    };

    if (req.files.contentImage) {
      await Promise.all(req.files.contentImage.map(file => uploadToCloud(file, 'image')));
    }
    if (req.files.contentVideo) {
      await Promise.all(req.files.contentVideo.map(file => uploadToCloud(file, 'video')));
    }

    // Update the user's uploadedContent with new posts (including writeUp)
    await User.findByIdAndUpdate(req.user._id, { $push: { uploadedContent: { $each: content } } }, { new: true });
    res.redirect('/profile');
  } catch (err) {
    console.error('Error uploading content:', err);
    res.status(500).send('Error uploading content');
  }
});

router.post('/delete-post/:postId', authCheck, async (req, res) => {
  try {
    const postId = req.params.postId;
    // Pull the post with the given _id from the uploadedContent array of the logged-in user
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { uploadedContent: { _id: postId } }
    });
    res.redirect('/profile');
  } catch (err) {
    console.error('Error deleting post:', err);
    res.status(500).send('Error deleting post');
  }
});


// Create a new subscription bundle
// Create a new subscription bundle
router.post('/create-bundle', authCheck, async (req, res) => {
  try {
    // Ensure that only creators can create bundles (if desired)
    if (req.user.role !== 'creator') {
      return res.status(403).send('Only creators can create bundles.');
    }
    
    console.log('Creating new bundle...');
    const { price, duration, description } = req.body;
    
    // Create the bundle and associate it with the logged-in creator
    const bundle = new SubscriptionBundle({ 
      price, 
      duration, 
      description,
      creatorId: req.user._id  // Associate bundle with the creator
    });
    
    await bundle.save();
    res.send('Bundle created successfully');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating bundle');
  }
});


// Subscribe to a creator's subscription bundle
router.post('/subscribe', authCheck, async (req, res) => {
  try {
    console.log('Processing subscription request...');
    const { creatorId, bundleId } = req.body;

    // Validate required fields
    if (!creatorId || !bundleId) {
      return res.status(400).json({
        status: 'error',
        message: 'Creator ID and Bundle ID are required'
      });
    }

    // Load required data
    const [user, creator, bundle] = await Promise.all([
      User.findById(req.user._id),
      User.findById(creatorId),
      SubscriptionBundle.findById(bundleId)
    ]);

    // Check if user is already subscribed
    const isSubscribed = user.subscriptions.some(
      (sub) => sub.creatorId.toString() === creatorId.toString() &&
               sub.status === 'active'
    );

    if (isSubscribed) {
      return res.status(400).json({
        status: 'error',
        message: 'You are already subscribed to this creator'
      });
    }

    // Initialize payment using Flutterwave
    const paymentResponse = await flutter.initializePayment(
      req.user._id, 
      creatorId, 
      bundleId
    );

    console.log('Payment initialization response:', paymentResponse);

    if (paymentResponse.status === 'success' && paymentResponse.meta?.authorization) {
      const authorization = paymentResponse.meta.authorization;
      
      // Extract bank transfer details if available (for bank transfer payments)
      const transferDetails = {
        // Adjust these fields if you receive them in your response
        accountNumber: authorization.transfer_account || null,
        bankName: authorization.transfer_bank || null,
        amount: authorization.transfer_amount || bundle.price,
        reference: authorization.transfer_reference || authorization.transfer_reference,
        accountExpiration: authorization.account_expiration || null,
        transferNote: authorization.transfer_note || null
      };

      // Store pending transaction using the tx_ref (or transfer_reference)
      await User.findByIdAndUpdate(req.user._id, {
        $push: {
          pendingTransactions: {
            tx_ref: authorization.transfer_reference || `SUB_${Date.now()}_${creatorId}_${bundleId}`,
            creatorId,
            bundleId,
            amount: bundle.price,
            status: 'pending',
            createdAt: new Date()
          }
        }
      });

      // Send success response with transfer details and payment link
      return res.json({
        status: 'success',
        message: 'Payment initialized successfully',
        data: {
          transferDetails,
          subscription: {
            creator: {
              id: creator._id,
              username: creator.username
            },
            bundle: {
              name: bundle.name,
              price: bundle.price,
              duration: bundle.duration
            }
          },
          paymentLink: authorization.payment_link || null
        }
      });
    } else {
      return res.json({
        status: 'success',
        message: paymentResponse.message || 'Payment initialization in progress',
        data: paymentResponse.meta || null
      });
    }
  } catch (err) {
    console.error('Subscription error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while processing your subscription',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Webhook route to handle payment notifications
router.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    if (event.event === 'charge.success') {
      // Update subscription status based on metadata
      const user = await User.findById(event.metadata.user_id);
      const creator = await User.findById(event.metadata.creator_id);
      const bundle = await SubscriptionBundle.findById(event.metadata.bundle_id);
      const subscription = {
        creatorId: creator._id,
        subscriptionBundle: bundle._id,
        subscribedAt: new Date(),
        subscriptionExpiry: new Date(Date.now() + bundle.duration),
        status: 'active',
      };
      user.subscriptions.push(subscription);
      await user.save();
      res.send('Webhook received and processed!');
    } else {
      res.send('Webhook received but not processed!');
    }
  } catch (err) {
    console.error('Error processing webhook:', err);
    res.status(500).send('Error processing webhook');
  }
});

// Verify payment and update subscription status
// Verify payment and update subscription status
router.get('/verify-payment', async (req, res) => {
  try {
    console.log("Verify Payment Route Hit. Query Params:", req.query);
    // Get transaction ID from query parameters
    const transaction_id = req.query.transaction_id;
    if (!transaction_id) {
      return res.status(400).send('Transaction ID is required');
    }

    const paymentResponse = await flutter.verifyPayment(transaction_id);
    console.log("Payment Verification Data:", paymentResponse);

    // Check the payment status inside data
    if (paymentResponse.data && paymentResponse.data.status === 'successful') {
      // Find the pending transaction by matching the tx_ref returned from Flutterwave
      const user = await User.findOne({
        'pendingTransactions.tx_ref': paymentResponse.data.tx_ref
      });

      if (!user) {
        return res.status(404).send('Transaction not found');
      }

      // Get the pending transaction
      const pendingTx = user.pendingTransactions.find(
        tx => tx.tx_ref === paymentResponse.data.tx_ref
      );

      if (!pendingTx) {
        return res.status(404).send('Pending transaction not found');
      }

      // Create subscription record
      const subscription = {
        creatorId: pendingTx.creatorId,
        subscriptionBundle: pendingTx.bundleId,
        subscribedAt: new Date(),
        subscriptionExpiry: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)), // 30 days
        status: 'active',
      };

      // Update user document: add subscription and remove pending transaction
      await User.findByIdAndUpdate(user._id, {
        $push: { subscriptions: subscription },
        $pull: { pendingTransactions: { tx_ref: paymentResponse.data.tx_ref } }
      });

      // Redirect to profile page with a success query parameter
      res.redirect('/profile?payment=success');
    } else {
      res.redirect('/profile?payment=failed');
    }
  } catch (err) {
    console.error('Error verifying payment:', err);
    res.status(500).send('Error verifying payment');
  }
});


module.exports = router;
