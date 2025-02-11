const express = require('express');
const router = express.Router();
const User = require('../models/users');

// Ensure the user is an admin
const adminCheck = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        res.redirect('/');
    } else {
        next();
    }
};

// Render the admin dashboard
router.get('/', adminCheck, async (req, res) => {
    try {
        const creatorRequests = await User.find({ requestToBeCreator: true });
        res.render('admin', { creatorRequests });
    } catch (err) {
        console.error('Error fetching creator requests:', err);
        res.redirect('/');
    }
});

// Approve a creator request
router.post('/approve/:id', adminCheck, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (user) {
            user.role = 'creator'; // Update the role
            user.requestToBeCreator = false; // Clear the request
            await user.save();
            req.flash('success_msg', `${user.username} has been approved as a creator.`);
            res.redirect('/admin');
        } else {
            req.flash('error_msg', 'User not found.');
            res.redirect('/admin');
        }
    } catch (err) {
        console.error('Error approving creator request:', err);
        req.flash('error_msg', 'An error occurred. Please try again.');
        res.redirect('/admin');
    }
});

module.exports = router;
