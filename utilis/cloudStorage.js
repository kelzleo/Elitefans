const { Storage } = require('@google-cloud/storage');
const path = require('path');

// Set the GOOGLE_APPLICATION_CREDENTIALS environment variable
process.env.GOOGLE_APPLICATION_CREDENTIALS = './google.json';

// Initialize Google Cloud Storage client
const storage = new Storage();

// Existing bucket for private content (e.g., posts)
const bucketName = 'kaccessfans';
const bucket = storage.bucket(bucketName);

// New bucket for chat media
const chatBucketName = 'kaccessfans-chat'; // Ensure this matches the exact bucket name you created
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
    console.error('Error generating signed URL:', err);
    throw err;
  }
};

// Function to generate a signed URL for chat media, with authorization check
const generateSignedUrlForChatMedia = async (filename, userId, chatId) => {
  const Chat = require('../models/chat'); // Adjust path to your Chat model if needed
  const chat = await Chat.findById(chatId);
  if (!chat || !chat.participants.some(p => p.toString() === userId.toString())) {
    throw new Error('Unauthorized access to chat media');
  }
  const options = {
    version: 'v4',
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000, // 15 minutes
  };
  try {
    const [url] = await chatBucket.file(filename).getSignedUrl(options);
    return url;
  } catch (err) {
    console.error('Error generating signed URL for chat media:', err);
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
    console.error('Error generating signed URL for creator request:', err);
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