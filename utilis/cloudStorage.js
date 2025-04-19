// utilis/cloudStorage.js
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const logger = require('../logs/logger'); // Import Winston logger at top

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

module.exports = { 
  storage, 
  bucket, 
  profileBucket, 
  generateSignedUrl, 
  creatorRequestsBucket, 
  generateSignedUrlForCreatorRequest,
  chatBucket,
  generateSignedUrlForChatMedia
};