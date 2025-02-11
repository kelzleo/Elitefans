const express = require('express');
const router = express.Router();
const User = require('../models/users');
const { generateSignedUrl } = require('../utilis/cloudStorage'); // Import the generateSignedUrl function

// Authentication middleware
const authCheck = (req, res, next) => {
    if (!req.user) {
        return res.redirect('/');
    }
    next();
};

// Home page route
router.get('/', authCheck, async (req, res) => {
    try {
        // Fetch all creators (even if the list is empty)
        const creators = await User.find({ role: 'creator' });
        
        // Re-fetch the logged-in user from the database to get an up-to-date subscriptions array
        const currentUser = await User.findById(req.user._id);
        
        // Filter active subscriptions to obtain the creator IDs the user is subscribed to
        const subscribedCreatorIds = currentUser.subscriptions
            .filter(sub => sub.status === 'active')
            .map(sub => sub.creatorId);
        
        // Fetch subscribed creators and populate their uploadedContent
        let subscribedCreators = await User.find({ _id: { $in: subscribedCreatorIds } })
                                             .populate('uploadedContent');
        
        // Generate fresh signed URLs for each piece of uploaded content for subscribed creators
        for (const creator of subscribedCreators) {
            if (creator.uploadedContent && creator.uploadedContent.length > 0) {
                // Loop over each content item and generate a signed URL if needed
                for (let i = 0; i < creator.uploadedContent.length; i++) {
                    const content = creator.uploadedContent[i];
                    if (!content.filename.startsWith('http')) {
                        // Generate a signed URL for the blob name stored in content.filename
                        creator.uploadedContent[i].filename = await generateSignedUrl(content.filename);
                    }
                }
            }
        }
        
        // Render the home page with the user, creators, subscribedCreators, and an empty search query
        res.render('home', { user: req.user, creators, subscribedCreators, search: '' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading creators');
    }
});

// Search route to handle the search functionality
router.get('/search', authCheck, async (req, res) => {
    const query = req.query.query;
    try {
        // Search for creators by username (or other fields) that match the query
        const creators = await User.find({ 
            username: { $regex: query, $options: 'i' },
            role: 'creator'
        });
        
        // Re-fetch the logged-in user to get their current subscriptions
        const currentUser = await User.findById(req.user._id);
        
        // Filter active subscriptions to obtain the creator IDs the user is subscribed to
        const subscribedCreatorIds = currentUser.subscriptions
            .filter(sub => sub.status === 'active')
            .map(sub => sub.creatorId);
        
        // Fetch subscribed creators and populate their uploadedContent
        let subscribedCreators = await User.find({ _id: { $in: subscribedCreatorIds } })
                                             .populate('uploadedContent');
        
        // Generate signed URLs for each piece of uploaded content for subscribed creators
        for (const creator of subscribedCreators) {
            if (creator.uploadedContent && creator.uploadedContent.length > 0) {
                for (let i = 0; i < creator.uploadedContent.length; i++) {
                    const content = creator.uploadedContent[i];
                    if (!content.filename.startsWith('http')) {
                        creator.uploadedContent[i].filename = await generateSignedUrl(content.filename);
                    }
                }
            }
        }
        
        // Render the home page with search results
        res.render('home', { user: req.user, creators, subscribedCreators, search: query });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error searching for creators');
    }
});

module.exports = router;
