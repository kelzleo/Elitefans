// routes/support.js
const express = require('express');
const router = express.Router();
const logger = require('../logs/logger');
const crypto = require('crypto');

// NOTE: This file expects process.env.TAWK_SECRET to contain your secure mode secret.
// Do NOT hardcode your secret in client-side files. Keep it server-side.
// The support template should include data-user-hash="<%= tawkHash %>" on the support container
// (example shown in assistant message).

// GET /support (render support page and compute tawk hash for authenticated users)
router.get('/', (req, res) => {
  try {
    // compute tawk hash only when user is authenticated and secret is configured
    let tawkHash = '';
    let identifier = '';
    try {
      const TAWK_SECRET = process.env.TAWK_SECRET;
      if (req.user && TAWK_SECRET) {
        // Always use _id for consistent hashing and login identifier
        identifier = req.user._id.toString();
        tawkHash = crypto.createHmac('sha256', TAWK_SECRET).update(identifier).digest('hex');
      }
    } catch (hErr) {
      // don't fail page render for hash compute errors; log and continue
      logger.error(`Error computing Tawk hash: ${hErr.message}`);
      tawkHash = '';
    }

    // Relaxed CSP for the support page, including 'unsafe-inline' for Tawk's inline styles
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; " +
      // allow Tawk scripts and permit inline script execution for this route
      "script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://embed.tawk.to https://*.tawk.to 'unsafe-inline'; " +
      // allow external stylesheets and permit inline styles for this route
      "style-src 'self' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://*.tawk.to 'unsafe-inline'; " +
      // explicit control for external style elements (fallback if browser uses this)
      "style-src-elem 'self' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://*.tawk.to 'unsafe-inline'; " +
      "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com https://*.tawk.to; " +
      "img-src 'self' data: blob: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://storage.googleapis.com https://*.tawk.to https://tawk.link s3.amazonaws.com; " +
      "connect-src 'self' https://*.tawk.to wss://*.tawk.to; " +
      "frame-src 'self' https://embed.tawk.to https://*.tawk.to; " +
      "child-src 'self' https://embed.tawk.to https://*.tawk.to; " +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none';"
    );

    res.render('support', {
      currentUser: req.user || null,
      tawkHash,
      env: process.env.NODE_ENV || 'development'
    });
  } catch (err) {
    logger.error(`Error rendering support page: ${err.message}`);
    res.status(500).send('Server Error');
  }
});

// GET /support/visitor-identity
// Returns JSON { ok, identifier, hash, name, email } for authenticated users.
// This is a fallback for clients that cannot read the hash from the page DOM.
router.get('/visitor-identity', (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    const TAWK_SECRET = process.env.TAWK_SECRET;
    if (!TAWK_SECRET) {
      logger.error('TAWK_SECRET not configured');
      return res.status(500).json({ ok: false, error: 'Server misconfiguration' });
    }

    // Always use _id for consistent hashing and login identifier
    const identifier = req.user._id.toString();
    const hash = crypto.createHmac('sha256', TAWK_SECRET).update(identifier).digest('hex');
    const name = req.user.displayName || req.user.username || req.user.name || '';
    const email = req.user.email || '';

    return res.json({ ok: true, identifier, hash, name, email });
  } catch (err) {
    logger.error(`Error in /support/visitor-identity: ${err.message}`);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

module.exports = router;