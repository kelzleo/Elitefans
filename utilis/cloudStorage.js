// utilis/cloudStorage.js
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const logger = require('../logs/logger');
const sharp = require('sharp'); // Add this package for image processing
const ffmpeg = require('fluent-ffmpeg'); // Add this package for video processing
const fs = require('fs');
const os = require('os');
// ← Add these two lines ↓
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);


// Decode the Base64-encoded credentials from GCLOUD_CREDS_BASE64
let credentials;
try {
  const credentialsBase64 = process.env.GCLOUD_CREDS_BASE64;
  if (!credentialsBase64) {
    logger.error('GCLOUD_CREDS_BASE64 environment variable is not set');
    throw new Error('GCLOUD_CREDS_BASE64 environment variable is not set');
  }
  const credentialsJson = Buffer.from(credentialsBase64, 'base64').toString('utf-8');
  credentials = JSON.parse(credentialsJson);
} catch (err) {
  logger.error(`Error decoding GCLOUD_CREDS_BASE64: ${err.message}`);
  throw err;
}

// Initialize Google Cloud Storage client with the credentials
const storage = new Storage({
  credentials: credentials,
});

// Existing bucket for private content (e.g., posts)
const bucketName = 'kaccessfans';
const bucket = storage.bucket(bucketName);

// New bucket for chat media
const chatBucketName = 'kaccessfans-chat';
const chatBucket = storage.bucket(chatBucketName);

// New public bucket for profile pictures
const profileBucketName = 'my-public-profile-pictures';
const profileBucket = storage.bucket(profileBucketName);

// New bucket for creator requests (for sensitive documents)
const creatorRequestsBucketName = 'my-creator-requests';
const creatorRequestsBucket = storage.bucket(creatorRequestsBucketName);

// Function to generate a signed URL for a file stored in the private content bucket
const generateSignedUrl = async (filename) => {
  const options = {
    version: 'v4',
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000, // 15 minutes
  };
  try {
    const [url] = await bucket.file(filename).getSignedUrl(options);
    return url;
  } catch (err) {
    logger.error(`Error generating signed URL for private content: ${err.message}`);
    throw err;
  }
};

// Function to generate a signed URL for chat media, with authorization check
const generateSignedUrlForChatMedia = async (filename, userId, chatId) => {
  const Chat = require('../models/chat');
  try {
    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.some(p => p.toString() === userId.toString())) {
      logger.warn('Unauthorized access attempt to chat media');
      throw new Error('Unauthorized access to chat media');
    }
    const options = {
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    };
    const [url] = await chatBucket.file(filename).getSignedUrl(options);
    return url;
  } catch (err) {
    logger.error(`Error generating signed URL for chat media: ${err.message}`);
    throw err;
  }
};

// Function to generate a signed URL for a file stored in the creator requests bucket
const generateSignedUrlForCreatorRequest = async (filename) => {
  const options = {
    version: 'v4',
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000, // 15 minutes
  };
  try {
    const [url] = await creatorRequestsBucket.file(filename).getSignedUrl(options);
    return url;
  } catch (err) {
    logger.error(`Error generating signed URL for creator request: ${err.message}`);
    throw err;
  }
};

// NEW: Create a blurred preview image for special content
const createBlurredPreview = async (buffer, mimetype, originalBlobName) => {
  try {
    // Create a blurred version of the image
    const blurredBuffer = await sharp(buffer)
      .resize({ width: 800, height: 800, fit: 'inside' }) // Resize to standard dimensions
      .blur(20) // Apply strong blur
      .jpeg({ quality: 60 }) // Lower quality for previews
      .toBuffer();

    // Create a new blob name for the blurred preview
    const previewBlobName = originalBlobName.replace('uploads/', 'previews/');
    
    // Upload the blurred preview to the bucket
    const previewBlob = bucket.file(previewBlobName);
    const previewStream = previewBlob.createWriteStream({
      resumable: false,
      contentType: 'image/jpeg', // Always save as jpeg for consistency
    });

    await new Promise((resolve, reject) => {
      previewStream.on('finish', resolve);
      previewStream.on('error', reject);
      previewStream.end(blurredBuffer);
    });

    logger.info(`Created blurred preview for ${originalBlobName}`);
    return previewBlobName;
  } catch (err) {
    logger.error(`Error creating blurred preview: ${err.message}`);
    throw err;
  }
};

// NEW: Create a short video preview (first few seconds)
const createVideoPreview = async (buffer, mimetype, originalBlobName) => {
  try {
    // Create temporary files for processing
    const tempInputPath = path.join(os.tmpdir(), `input-${Date.now()}.mp4`);
    const tempOutputPath = path.join(os.tmpdir(), `output-${Date.now()}.mp4`);
    
    // Write the buffer to the temp file
    await fs.promises.writeFile(tempInputPath, buffer);

    // Create a 5-second preview of the video with lowered resolution
    await new Promise((resolve, reject) => {
      ffmpeg(tempInputPath)
        .outputOptions([
          '-t 5', // First 5 seconds
          '-vf scale=480:-2', // Lower resolution
          '-b:v 500k', // Lower bitrate
          '-an' // Remove audio
        ])
        .output(tempOutputPath)
        .on('end', resolve)
        .on('error', (err) => {
          logger.error(`Error processing video preview: ${err.message}`);
          reject(err);
        })
        .run();
    });

    // Read the output file
    const previewBuffer = await fs.promises.readFile(tempOutputPath);
    
    // Create a new blob name for the video preview
    const previewBlobName = originalBlobName.replace('uploads/', 'previews/');
    
    // Upload the preview to the bucket
    const previewBlob = bucket.file(previewBlobName);
    const previewStream = previewBlob.createWriteStream({
      resumable: false,
      contentType: 'video/mp4',
    });

    await new Promise((resolve, reject) => {
      previewStream.on('finish', resolve);
      previewStream.on('error', reject);
      previewStream.end(previewBuffer);
    });

    // Clean up temp files
    await Promise.all([
      fs.promises.unlink(tempInputPath),
      fs.promises.unlink(tempOutputPath)
    ]);

    logger.info(`Created video preview for ${originalBlobName}`);
    return previewBlobName;
  } catch (err) {
    logger.error(`Error creating video preview: ${err.message}`);
    throw err;
  }
};

// Enhanced function to upload media with preview generation for special content
const uploadMediaWithPreview = async (buffer, type, filename, isSpecial = false) => {
  const mimeType = type === 'image' ? 'image/jpeg' : 'video/mp4';
  const blobName = `uploads/${type}/${Date.now()}_${filename}`;
  const blob = bucket.file(blobName);
  
  const blobStream = blob.createWriteStream({
    resumable: false,
    contentType: mimeType,
  });
  
  await new Promise((resolve, reject) => {
    blobStream.on('finish', resolve);
    blobStream.on('error', (err) => {
      logger.error(`Error uploading ${type} to cloud storage: ${err.message}`);
      reject(err);
    });
    blobStream.end(buffer);
  });

  // If this is special content, create and upload preview version
  let previewBlobName = null;
  if (isSpecial) {
    if (type === 'image') {
      previewBlobName = await createBlurredPreview(buffer, mimeType, blobName);
    } else if (type === 'video') {
      previewBlobName = await createVideoPreview(buffer, mimeType, blobName);
    }
  }

  return {
    originalUrl: blobName,
    previewUrl: previewBlobName
  };
};

module.exports = {
  storage,
  bucket,
  profileBucket,
  generateSignedUrl,
  creatorRequestsBucket,
  generateSignedUrlForCreatorRequest,
  chatBucket,
  generateSignedUrlForChatMedia,
  uploadMediaWithPreview, // Export the new function
};