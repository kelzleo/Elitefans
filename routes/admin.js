// routes/admin.js
const express = require('express');
const router = express.Router();
const CreatorRequest = require('../models/CreatorRequest');
const User = require('../models/users');
const { generateSignedUrlForCreatorRequest } = require('../utilis/cloudStorage');

const adminCheck = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') return res.redirect('/');
  next();
};

router.get('/', (req, res) => {
  res.redirect('/admin/creator-requests');
});

router.get('/creator-requests', adminCheck, async (req, res) => {
  try {
    const pending = await CreatorRequest.find({ status: 'pending' }).populate('user', 'username email requestedAt');
    const approved = await User.find({ role: 'creator' }, 'username email');
    res.render('admin', { creatorRequests: { pending, approved } });
  } catch (err) {
    console.error('Error fetching admin dashboard data:', err);
    res.redirect('/');
  }
});

router.get('/creator-request/pending/:id', adminCheck, async (req, res) => {
  try {
    const request = await CreatorRequest.findById(req.params.id)
      .populate('user', 'username email');
    if (!request) {
      req.flash('error_msg', 'Creator request not found.');
      return res.redirect('/admin/creator-requests');
    }
    let signedUrl;
    try {
      signedUrl = await generateSignedUrlForCreatorRequest(request.passportPhotoUrl);
    } catch (e) {
      console.error('Error generating signed URL:', e);
      signedUrl = null;
    }
    res.render('adminRequestDetails', { request, signedUrl });
  } catch (err) {
    console.error('Error fetching request details:', err);
    res.redirect('/admin/creator-requests');
  }
});

router.get('/creator-request/approved/:id', adminCheck, async (req, res) => {
  try {
    const creator = await User.findById(req.params.id);
    if (!creator) {
      req.flash('error_msg', 'Creator not found.');
      return res.redirect('/admin/creator-requests');
    }
    res.render('adminCreatorDetails', { creator });
  } catch (err) {
    console.error('Error fetching creator details:', err);
    res.redirect('/admin/creator-requests');
  }
});

router.post('/approve/:id', adminCheck, async (req, res) => {
  try {
    const requestId = req.params.id;
    const requestDoc = await CreatorRequest.findById(requestId);
    if (requestDoc) {
      const user = await User.findById(requestDoc.user);
      if (user) {
        user.role = 'creator';
        user.creatorSince = new Date(); // Set creatorSince here
        await user.save();
      }
      requestDoc.status = 'approved';
      await requestDoc.save();
      req.flash('success_msg', `${user.username} has been approved as a creator.`);
      res.redirect('/admin/creator-requests');
    } else {
      req.flash('error_msg', 'Creator request not found.');
      res.redirect('/admin/creator-requests');
    }
  } catch (err) {
    console.error('Error approving creator request:', err);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/admin/creator-requests');
  }
});

router.post('/reject/:id', adminCheck, async (req, res) => {
  try {
    const requestId = req.params.id;
    const requestDoc = await CreatorRequest.findById(requestId);
    if (requestDoc) {
      const user = await User.findById(requestDoc.user);
      if (user) {
        user.requestToBeCreator = false;
        await user.save();
      }
      requestDoc.status = 'rejected';
      await requestDoc.save();
      req.flash('success_msg', `Creator request from ${user.username} has been rejected.`);
      res.redirect('/admin/creator-requests');
    } else {
      req.flash('error_msg', 'Creator request not found.');
      res.redirect('/admin/creator-requests');
    }
  } catch (err) {
    console.error('Error rejecting creator request:', err);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/admin/creator-requests');
  }
});

module.exports = router;