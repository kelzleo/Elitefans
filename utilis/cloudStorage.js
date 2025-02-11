const { Storage } = require('@google-cloud/storage');
const path = require('path');

// Set the GOOGLE_APPLICATION_CREDENTIALS environment variable
process.env.GOOGLE_APPLICATION_CREDENTIALS = './google.json';

// Initialize Google Cloud Storage client
const storage = new Storage();
const bucketName = 'kaccessfans'; // Your bucket name
const bucket = storage.bucket(bucketName);

// Function to generate a signed URL for a file
const generateSignedUrl = async (filename) => {
  const options = {
    version: 'v4',
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000, // 15 minutes
  };

  try {
    const [url] = await storage
      .bucket(bucketName)
      .file(filename)
      .getSignedUrl(options);
    return url;
  } catch (err) {
    console.error('Error generating signed URL:', err);
    throw err;
  }
};

module.exports = { storage, bucket, generateSignedUrl };
