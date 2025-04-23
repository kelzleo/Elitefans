// uploadroute.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const { bucket } = require('../utilis/cloudStorage');
const Post = require('../models/Post'); // Import the new Post model

const router = express.Router();

// Initialize multer to store files in memory
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Upload route: Only creators are allowed to upload content.
 * This route now creates new Post documents with the special flag and unlockPrice.
 */
router.post(
  '/upload',
  (req, res, next) => {
    if (!req.user) {
      return res.status(401).send('Unauthorized. User information not found.');
    }
    if (req.user.role !== 'creator') {
      return res.status(403).send('You do not have permission to upload content.');
    }
    next();
  },
  // Accept image and video uploads (you can add more fields if needed)
  upload.fields([
    { name: 'contentImage', maxCount: 1 },
    { name: 'contentVideo', maxCount: 1 },
  ]),
  async (req, res) => {
    // Ensure there is either a file or text provided
    if (
      (!req.files || (!req.files.contentImage && !req.files.contentVideo)) &&
      !req.body.writeUp
    ) {
      return res.status(400).send('No files or text content provided.');
    }

    try {
      const postsToCreate = [];
      const writeUp = req.body.writeUp || '';
      // Convert the special checkbox value to boolean
      const isSpecial = Boolean(req.body.special);
      const unlockPrice = req.body.unlockPrice ? Number(req.body.unlockPrice) : undefined;

      console.log("Received special flag:", req.body.special, "Parsed as:", isSpecial);

      // Process image files if available
      if (req.files.contentImage) {
        for (const file of req.files.contentImage) {
          const blobName = `uploads/image/${Date.now()}_${path.basename(file.originalname)}`;
          const blob = bucket.file(blobName);
          const blobStream = blob.createWriteStream({
            resumable: false,
            contentType: file.mimetype,
          });

          await new Promise((resolve, reject) => {
            blobStream.on('finish', resolve);
            blobStream.on('error', reject);
            blobStream.end(file.buffer);
          });

          postsToCreate.push({
            creator: req.user._id,
            contentUrl: blobName,
            type: 'image',
            writeUp,
            special: isSpecial,
            unlockPrice: isSpecial ? unlockPrice : undefined,
          });
        }
      }

      // Process video files if available
      if (req.files.contentVideo) {
        for (const file of req.files.contentVideo) {
          const blobName = `uploads/video/${Date.now()}_${path.basename(file.originalname)}`;
          const blob = bucket.file(blobName);
          const blobStream = blob.createWriteStream({
            resumable: false,
            contentType: file.mimetype,
          });

          await new Promise((resolve, reject) => {
            blobStream.on('finish', resolve);
            blobStream.on('error', reject);
            blobStream.end(file.buffer);
          });

          postsToCreate.push({
            creator: req.user._id,
            contentUrl: blobName,
            type: 'video',
            writeUp,
            special: isSpecial,
            unlockPrice: isSpecial ? unlockPrice : undefined,
          });
        }
      }

      // Allow a text-only post if no files were uploaded
      if (postsToCreate.length === 0 && writeUp) {
        postsToCreate.push({
          creator: req.user._id,
          contentUrl: '', // No file associated
          type: 'text',
          writeUp,
          special: isSpecial,
          unlockPrice: isSpecial ? unlockPrice : undefined,
        });
      }

      // Create new Post documents in the database
      for (const postData of postsToCreate) {
        const post = new Post(postData);
        await post.save();
      }

      res.status(200).json({ message: 'Content uploaded successfully.', posts: postsToCreate });
    } catch (error) {
      console.error('Error uploading content:', error);
      res.status(500).send('Error uploading content.');
    }
  }
);

module.exports = router;
