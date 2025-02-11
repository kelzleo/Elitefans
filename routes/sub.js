const express = require('express');
const router = express.Router();
const Subscription = require('../models/users'); // Subscription model
 // Middleware for route protection


// Authentication middleware
const authCheck = (req, res, next) => {
    if (!req.user) {
        res.redirect('/');
    } else {
        next();
    }
};
// GET: View all subscriptions (Admin/Restricted Access)
router.get('/', ensureAuthenticated, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).send('Access denied.');
        }
        const subscriptions = await Subscription.find();
        res.render('subscriptions/index', { subscriptions });
    } catch (err) {
        console.error('Error fetching subscriptions:', err);
        req.flash('error_msg', 'Failed to retrieve subscriptions.');
        res.redirect('/');
    }
});

// POST: Subscribe to a plan
router.post('/subscribe', ensureAuthenticated, async (req, res) => {
    const { planId } = req.body;
    try {
        const subscription = new Subscription({
            user: req.user.id,
            plan: planId,
            subscribedAt: new Date(),
        });
        await subscription.save();
        req.flash('success_msg', 'Successfully subscribed to the plan.');
        res.redirect('/profile');
    } catch (err) {
        console.error('Error subscribing:', err);
        req.flash('error_msg', 'Subscription failed.');
        res.redirect('/subscriptions');
    }
});

// POST: Unsubscribe from a plan
router.post('/unsubscribe', ensureAuthenticated, async (req, res) => {
    try {
        const subscription = await Subscription.findOneAndDelete({ user: req.user.id });
        if (!subscription) {
            req.flash('error_msg', 'You are not subscribed to any plan.');
            return res.redirect('/subscriptions');
        }
        req.flash('success_msg', 'Successfully unsubscribed.');
        res.redirect('/profile');
    } catch (err) {
        console.error('Error unsubscribing:', err);
        req.flash('error_msg', 'Unsubscription failed.');
        res.redirect('/subscriptions');
    }
});

// GET: View subscription status
router.get('/status', ensureAuthenticated, async (req, res) => {
    try {
        const subscription = await Subscription.findOne({ user: req.user.id });
        if (!subscription) {
            return res.render('subscriptions/status', { isSubscribed: false });
        }
        res.render('subscriptions/status', {
            isSubscribed: true,
            subscription,
        });
    } catch (err) {
        console.error('Error checking subscription status:', err);
        req.flash('error_msg', 'Failed to retrieve subscription status.');
        res.redirect('/');
    }
});

module.exports = router;
