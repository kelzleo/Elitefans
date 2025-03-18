const { Storage } = require('@google-cloud/storage');
const path = require('path');

// Set the GOOGLE_APPLICATION_CREDENTIALS environment variable
process.env.GOOGLE_APPLICATION_CREDENTIALS = './google.json';

// Initialize Google Cloud Storage client
const storage = new Storage();

// Existing bucket for private content (e.g., posts)
const bucketName = 'kaccessfans'; // Your original bucket name
const bucket = storage.bucket(bucketName);

// New public bucket for profile pictures
const profileBucketName = 'my-public-profile-pictures'; // New bucket name for profile pictures
const profileBucket = storage.bucket(profileBucketName);

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

module.exports = { storage, bucket, profileBucket, generateSignedUrl };
