// routes/admin.js
const express = require('express');
const router = express.Router();
const CreatorRequest = require('../models/CreatorRequest');
const User = require('../models/users');
const { generateSignedUrlForCreatorRequest } = require('../utilis/cloudStorage');
const logger = require('../logs/logger'); // Import Winston logger at top

const adminCheck = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    logger.warn('Unauthorized access attempt to admin page');
    return res.redirect('/');
  }
  next();
};

router.get('/', (req, res) => {
  res.redirect('/admin/creator-requests');
});

router.get('/creator-requests', adminCheck, async (req, res) => {
  try {
    const pending = await CreatorRequest.find({ status: 'pending' }).populate('user', 'username email');
    const approved = await User.find({ role: 'creator' }, 'username email');
    res.render('admin', { creatorRequests: { pending, approved } });
  } catch (err) {
    logger.error(`Error fetching admin dashboard data: ${err.message}`);
    res.redirect('/');
  }
});

router.get('/creator-request/pending/:id', adminCheck, async (req, res) => {
  try {
    const request = await CreatorRequest.findById(req.params.id)
      .populate('user', 'username email');
    if (!request) {
      logger.warn('Creator request not found in /creator-request/pending/:id');
      req.flash('error_msg', 'Creator request not found.');
      return res.redirect('/admin/creator-requests');
    }
    let signedUrl;
    try {
      signedUrl = await generateSignedUrlForCreatorRequest(request.passportPhotoUrl);
    } catch (e) {
      logger.error(`Error generating signed URL: ${e.message}`);
      signedUrl = null;
    }
    res.render('adminRequestDetails', { request, signedUrl });
  } catch (err) {
    logger.error(`Error fetching request details: ${err.message}`);
    res.redirect('/admin/creator-requests');
  }
});

router.get('/creator-request/approved/:id', adminCheck, async (req, res) => {
  try {
    const creator = await User.findById(req.params.id);
    if (!creator) {
      logger.warn('Creator not found in /creator-request/approved/:id');
      req.flash('error_msg', 'Creator not found.');
      return res.redirect('/admin/creator-requests');
    }
    res.render('adminCreatorDetails', { creator });
  } catch (err) {
    logger.error(`Error fetching creator details: ${err.message}`);
    res.redirect('/admin/creator-requests');
  }
});

router.post('/approve/:id', adminCheck, async (req, res) => {
  try {
    const requestId = req.params.id;
    const requestDoc = await CreatorRequest.findById(requestId);
    if (!requestDoc) {
      logger.warn('Creator request not found in /approve/:id');
      req.flash('error_msg', 'Creator request not found.');
      return res.redirect('/admin/creator-requests');
    }
    const user = await User.findById(requestDoc.user);
    if (!user) {
      logger.warn('User not found for creator request in /approve/:id');
      req.flash('error_msg', 'User not found.');
      return res.redirect('/admin/creator-requests');
    }
    user.role = 'creator';
    user.creatorSince = new Date();
    user.requestToBeCreator = false;
    await user.save();
    requestDoc.status = 'approved';
    requestDoc.bvn = null; // Delete BVN
    await requestDoc.save();
    req.flash('success_msg', `${user.username} has been approved as a creator.`);
    res.redirect('/admin/creator-requests');
  } catch (err) {
    logger.error(`Error approving creator request: ${err.message}`);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/admin/creator-requests');
  }
});

router.post('/reject/:id', adminCheck, async (req, res) => {
  try {
    const requestId = req.params.id;
    const requestDoc = await CreatorRequest.findById(requestId);
    if (!requestDoc) {
      logger.warn('Creator request not found in /reject/:id');
      req.flash('error_msg', 'Creator request not found.');
      return res.redirect('/admin/creator-requests');
    }
    const user = await User.findById(requestDoc.user);
    if (!user) {
      logger.warn('User not found for creator request in /reject/:id');
      req.flash('error_msg', 'User not found.');
      return res.redirect('/admin/creator-requests');
    }
    user.requestToBeCreator = false;
    await user.save();
    requestDoc.status = 'rejected';
    requestDoc.bvn = null; // Delete BVN
    await requestDoc.save();
    req.flash('success_msg', `Creator request from ${user.username} has been rejected.`);
    res.redirect('/admin/creator-requests');
  } catch (err) {
    logger.error(`Error rejecting creator request: ${err.message}`);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/admin/creator-requests');
  }
});

router.get('/delete-logs', adminCheck, async (req, res) => {
  try {
    const PostDeletionLog = require('../models/PostDeletionLog');
    const deletionLogs = await PostDeletionLog.find().sort({ deletedAt: -1 });
    res.render('adminDeleteLogs', { deletionLogs });
  } catch (err) {
    logger.error(`Error fetching deletion logs: ${err.message}`);
    req.flash('error_msg', 'Error fetching deletion logs.');
    res.redirect('/admin/creator-requests');
  }
});

module.exports = router;