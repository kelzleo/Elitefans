const express = require('express');
const router = express.Router();
const User = require('../models/users');

// Ensure the user is authenticated
const authCheck = (req, res, next) => {
    if (!req.user) {
        res.redirect('/');
    } else {
        next();
    }
};

// Render the settings page
router.get('/', authCheck, (req, res) => {
    res.render('settings', { user: req.user });
});

// Handle "Request to Become Creator" submission
router.post('/request-creator', authCheck, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user) {
            user.requestToBeCreator = true; // Mark the request
            await user.save();
            req.flash('success_msg', 'Your request to become a creator has been submitted!');
            res.redirect('/settings');
        } else {
            req.flash('error_msg', 'User not found.');
            res.redirect('/settings');
        }
    } catch (err) {
        console.error('Error submitting creator request:', err);
        req.flash('error_msg', 'An error occurred. Please try again.');
        res.redirect('/settings');
    }
});

module.exports = router;
