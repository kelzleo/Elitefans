const express = require('express');
const multer = require('multer');
const path = require('path');
const { bucket, generateSignedUrl } = require('../utilis/cloudStorage'); // Import bucket and generateSignedUrl

const router = express.Router();

// Initialize multer to store files in memory
const upload = multer({ storage: multer.memoryStorage() });

// Upload route to handle file upload - Ensure only creators can upload content
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
  upload.fields([
    { name: 'contentImage', maxCount: 1 },
    { name: 'contentVideo', maxCount: 1 },
  ]),
  async (req, res) => {
    if (
      (!req.files || (!req.files.contentImage && !req.files.contentVideo)) &&
      !req.body.writeUp // Optionally allow text-only posts if desired
    ) {
      return res.status(400).send('No files or text content provided.');
    }

    try {
      const uploadedFiles = [];
      const filesToUpload = req.files || {};

      // Check if there's a write-up (text) sent along with the post
      // This text will be attached to each uploaded file (or used alone in a text-only post)
      const writeUp = req.body.writeUp || '';

      // Process each uploaded file (if any)
      for (const field in filesToUpload) {
        const file = filesToUpload[field][0]; // Get the file from multer
        // Create a unique blob name for the file
        const blobName = `uploads/${field}/${Date.now()}_${path.basename(file.originalname)}`;
        const blob = bucket.file(blobName);
        const blobStream = blob.createWriteStream({
          resumable: false,
          contentType: file.mimetype,
        });

        await new Promise((resolve, reject) => {
          blobStream
            .on('finish', async () => {
              // Instead of generating a signed URL here,
              // store the blob name so that you can generate a fresh signed URL later.
              uploadedFiles.push({
                type: field === 'contentImage' ? 'image' : 'video',
                filename: blobName, // store the blob name (file path)
                writeUp, // attach the provided text write-up
              });
              resolve();
            })
            .on('error', (err) => {
              console.error('Error uploading file:', err);
              reject(err);
            })
            .end(file.buffer);
        });
      }

      // If there is no file uploaded but there is a text write-up, allow a text-only post.
      if (uploadedFiles.length === 0 && writeUp) {
        uploadedFiles.push({
          type: 'text',
          filename: '', // no file
          writeUp,
        });
      }

      // Save the uploaded file information (and text) to the user object (assuming MongoDB)
      // Here we assume req.user is a Mongoose document.
      const user = req.user;
      user.uploadedContent = [...(user.uploadedContent || []), ...uploadedFiles];
      await user.save(); // Save updated user to the database

      res.status(200).json({ message: 'Content uploaded successfully.', uploadedFiles });
    } catch (error) {
      console.error('Error uploading content:', error);
      res.status(500).send('Error uploading content.');
    }
  }
);

module.exports = router;
