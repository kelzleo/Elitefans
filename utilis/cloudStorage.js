const { Storage } = require('@google-cloud/storage');
const path = require('path');
const logger = require('../logs/logger');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const os = require('os');
const INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes
const ABSOLUTE_MS = 4 * 60 * 60 * 1000; // 4 hours

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

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

const storage = new Storage({
  credentials: credentials,
});

const bucketName = 'kaccessfans';
const bucket = storage.bucket(bucketName);

const chatBucketName = 'kaccessfans-chat';
const chatBucket = storage.bucket(chatBucketName);

const profileBucketName = 'my-public-profile-pictures';
const profileBucket = storage.bucket(profileBucketName);

const creatorRequestsBucketName = 'my-creator-requests';
const creatorRequestsBucket = storage.bucket(creatorRequestsBucketName);

const generateSignedUrl = async (filename) => {
  const options = {
    version: 'v4',
    action: 'read',
    expires: Date.now() + 5 * 60 * 1000,
  };
  try {
    const [url] = await bucket.file(filename).getSignedUrl(options);
    return url;
  } catch (err) {
    logger.error(`Error generating signed URL for private content: ${err.message}`);
    throw err;
  }
};

const createSignedUrlSession = async (userId, filename, postId = null) => {
  const SignedUrlSession = require('../models/signedUrlSession');

  try {
    const now = Date.now();
    const existing = await SignedUrlSession.findOne({
      userId,
      filename,
      isActive: true,
      sessionExpiresAt: { $gt: now },
      createdAt: { $gt: now - ABSOLUTE_MS },
    });

    if (existing) {
      existing.lastAccessed = new Date();
      existing.sessionExpiresAt = new Date(now + INACTIVITY_MS);
      await existing.save();
      return existing._id;
    }

    const signedUrl = await generateSignedUrl(filename);
    const signedUrlExpiresAt = new Date(now + 5 * 60 * 1000);
    const sessionExpiresAt = new Date(now + INACTIVITY_MS);

    await SignedUrlSession.deleteMany({
      userId,
      filename,
      sessionExpiresAt: { $lt: now },
    });

    const session = new SignedUrlSession({
      userId,
      filename,
      signedUrl,
      signedUrlExpiresAt,
      sessionExpiresAt,
      lastAccessed: new Date(),
      isActive: true,
      postId,
    });

    await session.save();
    logger.info(`Created signed URL session ${session._id} for post ${postId || 'none'}`);
    return session._id;
  } catch (err) {
    logger.error(`Error creating signed URL session for filename ${filename}: ${err.message}`);
    throw err;
  }
};

const regenerateSignedUrl = async (sessionId) => {
  const SignedUrlSession = require('../models/signedUrlSession');
  const now = Date.now();

  try {
    const session = await SignedUrlSession.findById(sessionId);
    if (
      !session ||
      !session.isActive ||
      now > session.sessionExpiresAt ||
      now > session.createdAt.getTime() + ABSOLUTE_MS
    ) {
      throw new Error('Session not found or expired');
    }

    const newUrl = await generateSignedUrl(session.filename);
    session.signedUrl = newUrl;
    session.signedUrlExpiresAt = new Date(now + 5 * 60 * 1000);
    session.lastAccessed = new Date();
    session.sessionExpiresAt = new Date(now + INACTIVITY_MS);

    await session.save();
    logger.info(`Regenerated signed URL for session ${sessionId}`);
    return session;
  } catch (err) {
    logger.error(`Error regenerating signed URL for session ${sessionId}: ${err.message}`);
    throw err;
  }
};

const regenerateExpiring = async () => {
  const SignedUrlSession = require('../models/signedUrlSession');
  const now = Date.now();

  try {
    const soon = new Date(now + 2 * 60 * 1000);
    const expiringSessions = await SignedUrlSession.find({
      signedUrlExpiresAt: { $lt: soon },
      sessionExpiresAt: { $gt: now },
      createdAt: { $gt: now - ABSOLUTE_MS },
      isActive: true,
    });

    for (const s of expiringSessions) {
      try {
        await regenerateSignedUrl(s._id);
      } catch (err) {
        logger.error(err);
      }
    }
    if (expiringSessions.length) {
      logger.info(`Regenerated ${expiringSessions.length} signed URLs`);
    }

    await SignedUrlSession.deleteMany({
      $or: [
        { sessionExpiresAt: { $lt: now } },
        { createdAt: { $lt: now - ABSOLUTE_MS } },
      ],
    });
  } catch (err) {
    logger.error(`Error in regenerateExpiring job: ${err.message}`);
  }
};

const invalidateUserSessions = async (userId) => {
  const SignedUrlSession = require('../models/signedUrlSession');
  try {
    const result = await SignedUrlSession.deleteMany({
      userId,
      isActive: true,
    });
    logger.info(`Invalidated ${result.deletedCount} sessions for user ${userId}`);
    return result.deletedCount;
  } catch (err) {
    logger.error(`Error invalidating sessions for user ${userId}: ${err.message}`);
    throw err;
  }
};

const extendSessionActivity = async (userId, sessionId) => {
  const SignedUrlSession = require('../models/signedUrlSession');
  const now = Date.now();
  try {
    const query = {
      userId,
      _id: sessionId,
      isActive: true,
      sessionExpiresAt: { $gt: now },
      createdAt: { $gt: now - ABSOLUTE_MS },
    };
    const result = await SignedUrlSession.updateOne(
      query,
      {
        $set: {
          lastAccessed: new Date(),
          sessionExpiresAt: new Date(now + INACTIVITY_MS),
        },
      }
    );
    if (result.modifiedCount > 0) {
      logger.debug(`Extended activity for session ${sessionId} for user ${userId}`);
    } else {
      logger.debug(`No session extended for ${sessionId} (likely inactive or expired)`);
    }
    return result.modifiedCount;
  } catch (err) {
    logger.error(`Error extending session activity for user ${userId}, session ${sessionId}: ${err.message}`);
    throw err;
  }
};
const cleanupExpiredSessions = async () => {
  const SignedUrlSession = require('../models/signedUrlSession');
  const now = Date.now();
  try {
    const result = await SignedUrlSession.deleteMany({
      $or: [
        { sessionExpiresAt: { $lt: now } },
        { createdAt: { $lt: now - ABSOLUTE_MS } },
        { isActive: false },
      ],
    });
    if (result.deletedCount > 0) {
      logger.info(`Cleaned up ${result.deletedCount} expired or inactive sessions`);
    }
    return result.deletedCount;
  } catch (err) {
    logger.error(`Error cleaning up expired sessions: ${err.message}`);
    throw err;
  }
};

// Function to generate a signed URL for chat media, with authorization check
const generateSignedUrlForChatMedia = async (filename, userId, chatId) => {
  const Chat = require('../models/chat');
  try {
    // Log the incoming request
    logger.info(`Generating signed URL for: filename=${filename}, userId=${userId}, chatId=${chatId}`);
    
    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.some(p => p.toString() === userId.toString())) {
      logger.warn('Unauthorized access attempt to chat media');
      throw new Error('Unauthorized access to chat media');
    }
    
    // Check if file exists in bucket
    const file = chatBucket.file(filename);
    const [exists] = await file.exists();
    if (!exists) {
      logger.warn(`File does not exist in bucket: ${filename}`);
      throw new Error('File not found in storage');
    }
    
    const options = {
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    };
    
    const [url] = await chatBucket.file(filename).getSignedUrl(options);
    logger.info(`Signed URL generated successfully for: ${filename}`);
    return url;
  } catch (err) {
    logger.error(`Error generating signed URL for chat media: ${err.message}`);
    throw err;
  }
};
const createSignedUrlSessionForChatMedia = async (userId, filename, chatId) => {
  const SignedUrlSession = require('../models/signedUrlSession');
  const now = Date.now();

  try {
    // Check if the user is a participant in the chat
    const Chat = require('../models/chat');
    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.some(p => p.toString() === userId.toString())) {
      logger.warn(`Unauthorized attempt to create session for chat media: user ${userId}, chat ${chatId}`);
      throw new Error('Unauthorized access to chat media');
    }

    // Check for existing session
    const existing = await SignedUrlSession.findOne({
      userId,
      filename,
      chatId,
      isActive: true,
      sessionExpiresAt: { $gt: now },
      createdAt: { $gt: now - ABSOLUTE_MS },
    });

    if (existing) {
      existing.lastAccessed = new Date();
      existing.sessionExpiresAt = new Date(now + INACTIVITY_MS);
      await existing.save();
      logger.info(`Reused existing chat media session ${existing._id} for user ${userId}, chat ${chatId}`);
      return existing._id;
    }

    // Generate signed URL for the chat media
    const signedUrl = await generateSignedUrlForChatMedia(filename, userId, chatId);
    const signedUrlExpiresAt = new Date(now + 15 * 60 * 1000); // Match the 15-minute expiration
    const sessionExpiresAt = new Date(now + INACTIVITY_MS);

    // Clean up expired sessions for this user and filename
    await SignedUrlSession.deleteMany({
      userId,
      filename,
      chatId,
      sessionExpiresAt: { $lt: now },
    });

    // Create new session
    const session = new SignedUrlSession({
      userId,
      filename,
      signedUrl,
      signedUrlExpiresAt,
      sessionExpiresAt,
      lastAccessed: new Date(),
      isActive: true,
      chatId, // Store chatId to differentiate from post-related sessions
    });

    await session.save();
    logger.info(`Created chat media session ${session._id} for user ${userId}, chat ${chatId}`);
    return session._id;
  } catch (err) {
    logger.error(`Error creating chat media session for user ${userId}, filename ${filename}, chat ${chatId}: ${err.message}`);
    throw err;
  }
};
const generateSignedUrlForCreatorRequest = async (filename) => {
  const options = {
    version: 'v4',
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000,
  };
  try {
    const [url] = await creatorRequestsBucket.file(filename).getSignedUrl(options);
    return url;
  } catch (err) {
    logger.error(`Error generating signed URL for creator request: ${err.message}`);
    throw err;
  }
};

const createBlurredPreview = async (buffer, mimetype, originalBlobName) => {
  try {
    const blurredBuffer = await sharp(buffer)
      .resize({ width: 800, height: 800, fit: 'inside' })
      .blur(20)
      .jpeg({ quality: 60 })
      .toBuffer();

    const previewBlobName = originalBlobName.replace('uploads/', 'previews/');
    const previewBlob = bucket.file(previewBlobName);
    const previewStream = previewBlob.createWriteStream({
      resumable: false,
      contentType: 'image/jpeg',
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

const createVideoPreview = async (buffer, mimetype, originalBlobName) => {
  try {
    const tempInputPath = path.join(os.tmpdir(), `input-${Date.now()}.mp4`);
    const tempOutputPath = path.join(os.tmpdir(), `output-${Date.now()}.mp4`);

    await fs.writeFile(tempInputPath, buffer);

    await new Promise((resolve, reject) => {
      ffmpeg(tempInputPath)
        .outputOptions(['-t 5', '-vf scale=480:-2', '-b:v 500k', '-an'])
        .output(tempOutputPath)
        .on('end', resolve)
        .on('error', (err) => {
          logger.error(`Error processing video preview: ${err.message}`);
          reject(err);
        })
        .run();
    });

    const previewBuffer = await fs.readFile(tempOutputPath);
    const previewBlobName = originalBlobName.replace('uploads/', 'previews/');
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

    await Promise.all([fs.unlink(tempInputPath), fs.unlink(tempOutputPath)]);

    logger.info(`Created video preview for ${originalBlobName}`);
    return previewBlobName;
  } catch (err) {
    logger.error(`Error creating video preview: ${err.message}`);
    throw err;
  }
};

const createVideoThumbnail = async (buffer, originalBlobName) => {
  try {
    const tempInputPath = path.join(os.tmpdir(), `input-thumb-${Date.now()}.mp4`);
    const tempOutputPath = path.join(os.tmpdir(), `thumb-${Date.now()}.jpg`);
    await fs.writeFile(tempInputPath, buffer);
    await new Promise((resolve, reject) => {
      ffmpeg(tempInputPath)
        .screenshots({
          count: 1,
          folder: os.tmpdir(),
          filename: path.basename(tempOutputPath),
          timestamps: ['1'],
          size: '320x?', // Smaller for mobile
        })
        .on('end', resolve)
        .on('error', (err) => {
          logger.error(`Error generating video thumbnail: ${err.message}`);
          reject(err);
        });
    });
    let thumbnailBuffer = await fs.readFile(tempOutputPath);
    thumbnailBuffer = await sharp(thumbnailBuffer)
      .jpeg({ quality: 80, progressive: false, force: true, mozjpeg: true }) // WebKit-compatible
      .toBuffer();
    const thumbnailBlobName = originalBlobName.replace('uploads/', 'thumbnails/').replace(/\.[^/.]+$/, '.jpg');
    const thumbnailBlob = bucket.file(thumbnailBlobName);
    const thumbnailStream = thumbnailBlob.createWriteStream({
      resumable: false,
      contentType: 'image/jpeg',
      metadata: { cacheControl: 'public, max-age=3600' },
    });
    await new Promise((resolve, reject) => {
      thumbnailStream.on('finish', resolve);
      thumbnailStream.on('error', reject);
      thumbnailStream.end(thumbnailBuffer);
    });
    await Promise.all([fs.unlink(tempInputPath), fs.unlink(tempOutputPath)]);
    logger.info(`Created video thumbnail: ${thumbnailBlobName}`);
    return thumbnailBlobName;
  } catch (err) {
    logger.error(`Error creating video thumbnail: ${err.message}`);
    return 'thumbnails/default-thumb.jpg'; // GCS fallback
  }
};

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

  const result = {
    originalUrl: blobName,
    previewUrl: null,
    posterUrl: null,
  };

  if (isSpecial) {
    if (type === 'image') {
      result.previewUrl = await createBlurredPreview(buffer, mimeType, blobName);
    } else if (type === 'video') {
      result.previewUrl = await createVideoPreview(buffer, mimeType, blobName);
    }
  }

  if (type === 'video') {
    result.posterUrl = await createVideoThumbnail(buffer, blobName);
  }

  return result;
};

module.exports = {
  storage,
  bucket,
  profileBucket,
  generateSignedUrl,
  createSignedUrlSession,
  regenerateSignedUrl,
  invalidateUserSessions,
  regenerateExpiring,
  extendSessionActivity,
  creatorRequestsBucket,
  generateSignedUrlForCreatorRequest,
  chatBucket,
  generateSignedUrlForChatMedia,
  createSignedUrlSessionForChatMedia,
  uploadMediaWithPreview,
  cleanupExpiredSessions,
};