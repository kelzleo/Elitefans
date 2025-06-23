 // Helper function to safely get data attribute boolean
 function getDataBoolean(element, attributeName) {
  return element && element.dataset[attributeName] === 'true';
}

document.addEventListener('DOMContentLoaded', function() {
  const profileContainer = document.querySelector('.profile-container');
  const isDevEnv = profileContainer && profileContainer.dataset.env === 'development'; // Check environment
  const isCreatorViewingOwnProfile = getDataBoolean(profileContainer, 'isCreatorViewing');
  const isVisitorSubscribed = getDataBoolean(profileContainer, 'isSubscribed');
  const isLoggedIn = getDataBoolean(profileContainer, 'currentUser');

   // Initialize FingerprintJS once and store visitorId
 // FingerprintJS initialization with caching
  let fingerprint = null;
  let fingerprintPromise = null;

  // Function to get or initialize fingerprint
  const getFingerprint = async () => {
    if (fingerprint) return fingerprint; // Return cached fingerprint
    if (fingerprintPromise) return await fingerprintPromise; // Wait for ongoing initialization

    fingerprintPromise = (async () => {
      if (typeof FingerprintJS === 'undefined') {
        if (isDevEnv) console.error('FingerprintJS is not loaded. Ensure script is included in profile.ejs.');
        throw new Error('FingerprintJS is not available');
      }
      try {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        fingerprint = result.visitorId;
        if (isDevEnv) console.log('Fingerprint initialized:', fingerprint);
        return fingerprint;
      } catch (err) {
        if (isDevEnv) console.error('Failed to initialize FingerprintJS:', err.message);
        throw err;
      } finally {
        fingerprintPromise = null; // Reset promise after completion
      }
    })();

    return await fingerprintPromise;
  };

// ─── Lazy-loading + Signed URL batching ───

const batchSize = 3;
let pendingPosts = new Set();
let isProcessing = false;
let lastBatchTime = 0;
const batchThrottle = 1000; // Increased to 1s to reduce overlap

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Fetch with CSRF token
async function fetchWithCsrf(url, options) {
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
  if (!csrfToken) {
    console.error('CSRF token not found');
    throw new Error('CSRF token not found');
  }
  options.headers = {
    ...options.headers,
    'X-CSRF-Token': csrfToken,
  };
  return fetch(url, options);
}

// Fetch signed URLs, updated to throw on error for consistent handling
async function fetchSignedUrlSessions(postData) {
  console.debug('🔑 Requesting signed URLs for:', postData);
  const response = await fetchWithCsrf('/api/generate-signed-urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(postData),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Fetch failed: ${response.status} - ${error.message || response.statusText}`);
  }
  const result = await response.json();
  return result.sessions || {};
}

// Extend session activity with sessionId, debounced
const extendSessionActivity = debounce(async (sessionId) => {
  try {
    const response = await fetchWithCsrf('/api/extend-session-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (!response.ok) {
      console.warn(`Failed to extend session ${sessionId}: ${response.status}`);
    }
  } catch (err) {
    console.error(`Error extending session ${sessionId}: ${err.message}`);
  }
}, 5000); // Debounce to every 5 seconds

// Process batch function with consistent use of pendingPosts and fetchSignedUrlSessions
async function processBatch() {
  const now = Date.now();
  if (isProcessing || pendingPosts.size === 0 || now - lastBatchTime < batchThrottle) return;
  if (isDevEnv) console.log(`Starting batch, pendingPosts size: ${pendingPosts.size}`);
  isProcessing = true;
  lastBatchTime = now;

  try {
    const batch = Array.from(pendingPosts).slice(0, batchSize);
    const postData = batch
      .map((post) => {
        const mediaEls = post.querySelectorAll('.lazy-media');
        if (!mediaEls.length) {
          if (isDevEnv) console.log(`No media for post ${post.dataset.postId}`);
          pendingPosts.delete(post);
          return null;
        }
        return {
          postId: post.dataset.postId,
          media: Array.from(mediaEls)
            .slice(0, 3) // Limit to 3 media items
            .map((el) => {
              const elementId = el.id || `media-${Math.random().toString(36).substr(2, 9)}`;
              el.id = elementId;
              const item = { originalUrl: el.dataset.originalUrl, elementId };
              if (el.dataset.originalPoster?.trim()) item.originalPoster = el.dataset.originalPoster;
              return item;
            }),
        };
      })
      .filter((post) => post !== null);

    if (!postData.length) {
      batch.forEach((post) => pendingPosts.delete(post));
      isProcessing = false;
      return;
    }

    const sessions = await fetchSignedUrlSessions(postData);

    batch.forEach((post) => {
      const postId = post.dataset.postId;
      const postSessions = sessions[postId] || [];
      if (!postSessions.length) {
        if (isDevEnv) console.warn(`No sessions returned for post ${postId}`);
        post.querySelectorAll('.lazy-media').forEach((el) => {
          el.src = '/images/error.png';
          el.classList.remove('lazy-media');
        });
        pendingPosts.delete(post);
        return;
      }

      post.querySelectorAll('.lazy-media').forEach((el) => {
        const session = postSessions.find((s) => s.elementId === el.id);
        if (!session) {
          if (isDevEnv) console.warn(`No session for element ${el.id} in post ${postId}`);
          el.src = '/images/error.png';
          el.classList.remove('lazy-media');
          return;
        }

        if (isDevEnv) console.log(`Updating ${el.tagName} ${el.id} with URL: ${session.url}`);
        el.dataset.retryCount = el.dataset.retryCount || '0';

        if (el.tagName === 'IMG') {
          el.src = `${session.url}?t=${Date.now()}`;
          el.dataset.fullscreenSrc = session.url;
          el.addEventListener(
            'error',
            () => {
              const retryCount = parseInt(el.dataset.retryCount);
              if (retryCount < 3) {
                if (isDevEnv) console.warn(`Image error for ${el.id}, retry ${retryCount}`);
                el.dataset.retryCount = (retryCount + 1).toString();
                pendingPosts.add(post);
              } else {
                el.src = '/images/error.png';
                el.classList.remove('lazy-media');
              }
            },
            { once: true }
          );
          el.addEventListener(
            'load',
            () => {
              el.classList.remove('lazy-media');
            },
            { once: true }
          );
        } else if (el.tagName === 'VIDEO') {
          const source = el.querySelector('source') || document.createElement('source');
          source.src = `${session.url}?t=${Date.now()}`;
          source.type = el.querySelector('source')?.type || 'video/mp4';
          if (!el.querySelector('source')) el.appendChild(source);
          el.dataset.fullscreenSrc = session.url;
          if (session.posterUrl) el.poster = `${session.posterUrl}?t=${Date.now()}`;
          el.load();
          el.addEventListener(
            'error',
            () => {
              const retryCount = parseInt(el.dataset.retryCount);
              if (retryCount < 3) {
                if (isDevEnv) console.warn(`Video error for ${el.id}, retry ${retryCount}`);
                el.dataset.retryCount = (retryCount + 1).toString();
                pendingPosts.add(post);
              } else {
                el.poster = '/images/error.png';
                el.classList.remove('lazy-media');
              }
            },
            { once: true }
          );
          el.addEventListener(
            'canplay',
            () => {
              el.classList.remove('lazy-media');
            },
            { once: true }
          );
        }

        extendSessionActivity(session.sessionId);
      });

      pendingPosts.delete(post);
    });
  } catch (error) {
    if (isDevEnv) console.error('Batch processing error:', error);
    batch.forEach((post) => {
      const batchRetryCount = parseInt(post.dataset.batchRetryCount || '0');
      if (batchRetryCount < 3) {
        post.dataset.batchRetryCount = (batchRetryCount + 1).toString();
      } else {
        post.querySelectorAll('.lazy-media').forEach((el) => {
          el.src = '/images/error.png';
          el.classList.remove('lazy-media');
        });
        pendingPosts.delete(post);
      }
    });
  } finally {
    isProcessing = false;
    if (isDevEnv) console.log(`Batch done, remaining: ${pendingPosts.size}`);
    if (pendingPosts.size > 0) setTimeout(processBatch, batchThrottle);
  }
}

// Intersection Observer to trigger lazy loading
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      console.log(`Post ${entry.target.dataset.postId} intersecting: ${entry.isIntersecting}`);
      if (entry.isIntersecting && !entry.target.dataset.processed) {
        pendingPosts.add(entry.target);
        entry.target.dataset.processed = 'true'; // Prevent re-adding
        observer.unobserve(entry.target); // Unobserve after enqueuing
        processBatch();
      }
    });
  },
  {
    root: null,
    rootMargin: '0px 0px -100px 0px', // Trigger ~100px before entering from bottom
    threshold: 0.1,
  }
);

// Observe all post cards
document.querySelectorAll('.post-card').forEach((post) => {
  observer.observe(post);
});
  // Select all required elements
const lightbox = document.getElementById('lightbox');
const lbBackdrop = document.getElementById('lb-backdrop');
const lbContent = document.getElementById('lb-content');
const lbClose = document.getElementById('lb-close');
const lbImg = document.getElementById('lb-img');
const lbVid = document.getElementById('lb-vid');
const customControls = document.getElementById('custom-controls');
const playPauseBtn = document.getElementById('play-pause');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const muteUnmuteBtn = document.getElementById('mute-unmute');

// Check if all required elements exist
if (!lightbox || !lbBackdrop || !lbContent || !lbClose || !lbImg || !lbVid || !customControls || !playPauseBtn || !progressContainer || !progressBar || !muteUnmuteBtn) {
  if (isDevEnv) {
    console.error('One or more lightbox elements are missing:', {
      lightbox, lbBackdrop, lbContent, lbClose, lbImg, lbVid, customControls, playPauseBtn, progressContainer, progressBar, muteUnmuteBtn
    });
  }
  return;
}

// Prevent right-click context menu on the entire lightbox
lightbox.addEventListener('contextmenu', e => {
  e.preventDefault();
  return false;
});

// Prevent double-click to avoid triggering native fullscreen
lightbox.addEventListener('dblclick', e => {
  e.preventDefault();
  e.stopPropagation();
});

// Open lightbox function
function openLightbox(src, isVideo, time = 0) {
  if (isDevEnv) console.log('Opening lightbox:', { src, isVideo, time });

  // Reset active states
  lbImg.classList.remove('active');
  lbVid.classList.remove('active');
  customControls.classList.remove('active');

  if (isVideo) {
    lbVid.src = src;
    lbVid.currentTime = time;
    lbVid.classList.add('active');
    customControls.classList.add('active');

    // Remove native controls and add security attributes
    lbVid.removeAttribute('controls');
    lbVid.setAttribute('controlsList', 'nodownload noremoteplayback');
    lbVid.setAttribute('disablePictureInPicture', '');

    // Prevent context menu on video
    lbVid.addEventListener('contextmenu', preventContextMenu);

    // Initialize video state
    updatePlayPauseButton();
    setupVideoListeners();

    // Attempt auto-play
    lbVid.play().catch(e => {
      if (isDevEnv) console.log('Autoplay prevented:', e);
      updatePlayPauseButton();
    });
  } else {
    lbVid.pause();
    lbVid.removeAttribute('src');
    lbImg.src = src;
    lbImg.classList.add('active');
  }

  lightbox.classList.remove('hidden');
  document.body.classList.add('lightbox-open');

  // Prevent native fullscreen
  document.addEventListener('fullscreenchange', preventNativeFullscreen);
}

// Prevent context menu (factored out for reusability)
function preventContextMenu(e) {
  e.preventDefault();
  return false;
}

// Setup video event listeners
function setupVideoListeners() {
  lbVid.addEventListener('timeupdate', updateProgressBar);
  lbVid.addEventListener('play', updatePlayPauseButton);
  lbVid.addEventListener('pause', updatePlayPauseButton);
  lbVid.addEventListener('volumechange', updateMuteButton);
}

// Update progress bar
function updateProgressBar() {
  const percentage = (lbVid.currentTime / lbVid.duration) * 100;
  progressBar.value = percentage;
}

// Update play/pause button text
function updatePlayPauseButton() {
  playPauseBtn.textContent = lbVid.paused ? '▶' : '⏸';
}

// Update mute/unmute button text
function updateMuteButton() {
  muteUnmuteBtn.textContent = lbVid.muted ? '🔇' : '🔊';
}

// Play/Pause button click handler
playPauseBtn.addEventListener('click', () => {
  if (lbVid.paused) {
    lbVid.play();
  } else {
    lbVid.pause();
  }
  updatePlayPauseButton();
});

// Progress bar click handler
progressContainer.addEventListener('click', (e) => {
  const rect = progressContainer.getBoundingClientRect();
  const pos = (e.clientX - rect.left) / rect.width;
  lbVid.currentTime = pos * lbVid.duration;
});

// Mute/Unmute button click handler
muteUnmuteBtn.addEventListener('click', () => {
  lbVid.muted = !lbVid.muted;
  updateMuteButton();
});

// Prevent native fullscreen mode
function preventNativeFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
    if (isDevEnv) console.log('Blocked native fullscreen attempt');
  }
}

// Attach click handlers to fullscreenable media
document.querySelectorAll('.fullscreenable').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const src = el.dataset.fullscreenSrc || el.src || el.currentSrc;
    if (!src) {
      if (isDevEnv) console.warn('No src found for fullscreenable element:', el);
      return;
    }
    const isVideo = el.tagName.toLowerCase() === 'video';
    const time = isVideo ? el.currentTime : 0;
    if (isDevEnv) console.log('Fullscreenable clicked:', { src, isVideo, time });
    openLightbox(src, isVideo, time);
  });

  // Prevent double-click and context menu on media
  el.addEventListener('dblclick', e => {
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener('contextmenu', preventContextMenu);
});

// Close lightbox function
function close() {
  lightbox.classList.add('hidden');
  lbVid.pause();
  lbVid.removeAttribute('src');
  lbImg.removeAttribute('src');
  document.body.classList.remove('lightbox-open');
  document.removeEventListener('fullscreenchange', preventNativeFullscreen);

  // Clean up video event listeners
  lbVid.removeEventListener('timeupdate', updateProgressBar);
  lbVid.removeEventListener('play', updatePlayPauseButton);
  lbVid.removeEventListener('pause', updatePlayPauseButton);
  lbVid.removeEventListener('volumechange', updateMuteButton);
  lbVid.removeEventListener('contextmenu', preventContextMenu);
}

// Close event handlers
lbClose.addEventListener('click', close);
lbBackdrop.addEventListener('click', close);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') close();
});

// Prevent keyboard shortcuts in lightbox
lightbox.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    return false;
  }
});

// Drag-to-close functionality for mobile
let touchStartY = 0;
let touchCurrentY = 0;
let isDragging = false;
const dragThreshold = window.innerHeight * 0.3; // Close if dragged 30% of screen height

lbContent.addEventListener('touchstart', e => {
  if (e.target.closest('#custom-controls') || e.target.closest('#lb-close')) return;
  touchStartY = e.touches[0].clientY;
  isDragging = true;
});

lbContent.addEventListener('touchmove', e => {
  if (!isDragging) return;
  touchCurrentY = e.touches[0].clientY;
});

lbContent.addEventListener('touchend', e => {
  if (!isDragging) return;
  isDragging = false;
  const deltaY = touchCurrentY - touchStartY;
  if (deltaY > dragThreshold) {
    lightbox.classList.add('closing');
    setTimeout(() => {
      close();
      lightbox.classList.remove('closing');
    }, 300);
  }
});

// Debug: Log initialization
if (isDevEnv) console.log('Lightbox script initialized');

  // --- Free Subscription Form ---
document.querySelectorAll('.subscribe-free-bundle-form').forEach(form => {
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!isLoggedIn) {
      try {
        const redirectResponse = await fetchWithCsrf('/store-redirect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ redirectTo: window.location.pathname })
        });
        if (!redirectResponse.ok && isDevEnv) {
          console.error('Failed to store redirect:', redirectResponse.status);
        }
      } catch (error) {
        if (isDevEnv) console.error('Error storing redirect:', error.message);
      }
      const username = document.querySelector('.profile-container').dataset.username;
      window.location.href = `/?creator=${encodeURIComponent(username)}`;
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    const originalHtml = submitButton.innerHTML;
    submitButton.innerHTML = 'Processing...';
    submitButton.disabled = true;

    try {
      const formData = new FormData(form);
      const fingerprintId = await getFingerprint(); // Get the fingerprint
      const data = {
        creatorId: formData.get('creatorId'),
        creatorUsername: formData.get('creatorUsername'),
        fingerprint: fingerprintId // Add fingerprint to data
      };
      const response = await fetchWithCsrf('/profile/subscribe-free', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text);
        throw new Error(`Failed to parse server response: ${parseError.message}`);
      }
      if (response.ok && result.status === 'success') {
        alert(result.message || 'Subscribed successfully.');
        window.location.href = result.redirect || window.location.pathname;
      } else {
        if (isDevEnv) console.error('Free subscription error:', result);
        alert(result.message || 'Error subscribing. Please try again.');
        submitButton.innerHTML = originalHtml;
        submitButton.disabled = false;
      }
    } catch (err) {
      if (isDevEnv) console.error('Error subscribing to free bundle:', err.message);
      alert('Error subscribing. Please try again.');
      submitButton.innerHTML = originalHtml;
      submitButton.disabled = false;
    }
  });
});
// --- Subscription Dropdown Toggle ---
const toggleBtn = document.getElementById('toggleBundlesBtn');
const dropdown = document.getElementById('subscriptionDropdown');

if (toggleBtn && dropdown) {
  dropdown.classList.add('hidden');
  toggleBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!isLoggedIn) {
      try {
        const redirectResponse = await fetchWithCsrf('/store-redirect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ redirectTo: window.location.pathname })
        });
        if (!redirectResponse.ok && isDevEnv) {
          console.error('Failed to store redirect:', redirectResponse.status);
        }
      } catch (error) {
        if (isDevEnv) console.error('Error storing redirect:', error.message);
      }
      // Get username from data attribute instead of EJS template
      const username = document.querySelector('.profile-container').dataset.username;
      window.location.href = `/?creator=${encodeURIComponent(username)}`;
      return;
    }
    dropdown.classList.toggle('hidden');
    toggleBtn.classList.toggle('active', !dropdown.classList.contains('hidden'));
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
      dropdown.classList.add('hidden');
      if (toggleBtn) toggleBtn.classList.remove('active');
    }
  });
} else if (isDevEnv) {
  console.warn('Missing toggleBundlesBtn or subscriptionDropdown');
}

// --- Toggle Free Subscription Confirmation ---
document.querySelector('.toggle-free-subscription-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const submitButton = form.querySelector('button[type="submit"]');
  const originalHtml = submitButton.innerHTML;
  const isEnabling = submitButton.textContent.includes('Enable');

  if (isEnabling && !confirm('Enabling free mode will delete all paid bundles. Continue?')) {
    return;
  }

  submitButton.innerHTML = 'Processing...';
  submitButton.disabled = true;

  try {
    const fingerprintId = await getFingerprint();
    const data = { fingerprint: fingerprintId };
    if (isDevEnv) console.log('Toggle free subscription data:', data);

    const response = await fetchWithCsrf('/profile/toggle-free-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (parseError) {
      if (isDevEnv) console.error('Non-JSON response:', text);
      throw new Error(`Failed to parse server response: ${parseError.message}`);
    }

    if (response.ok && result.status === 'success') {
      alert(result.message || 'Free subscription mode toggled successfully.');
      window.location.href = result.redirect || window.location.pathname;
    } else {
      if (isDevEnv) console.error('Toggle free subscription error:', result);
      alert(result.message || 'Error toggling free subscription.');
      submitButton.innerHTML = originalHtml;
      submitButton.disabled = false;
    }
  } catch (err) {
    if (isDevEnv) console.error('Error toggling free subscription:', err.message);
    alert('Error toggling free subscription. Please try again.');
    submitButton.innerHTML = originalHtml;
    submitButton.disabled = false;
  }
});
 // --- Edit Bundle Modal and Form ---
const editBundleModal = document.getElementById('editBundleModal');
const editBundleForm = document.getElementById('editBundleForm');
const closeEditBundleModal = document.getElementById('closeEditBundleModal');
const editBundlePrice = document.getElementById('editBundlePrice');
const editBundleDiscount = document.getElementById('editBundleDiscount');
const editBundleDescription = document.getElementById('editBundleDescription');

if (editBundleModal && editBundleForm && closeEditBundleModal && editBundlePrice && editBundleDiscount && editBundleDescription) {
  // Handle "Edit" button clicks
  document.querySelectorAll('.edit-bundle-button').forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      const bundleId = button.dataset.bundleId;
      const price = button.dataset.price;
      const description = button.dataset.description;
      const discountPercentage = button.dataset.discountPercentage;

      if (!bundleId) {
        if (isDevEnv) console.error('Bundle ID not found on edit button');
        alert('Error: Bundle ID missing.');
        return;
      }

      // Populate form fields
      editBundleForm.action = `/profile/edit-bundle/${bundleId}`;
      editBundlePrice.value = price;
      editBundleDiscount.value = discountPercentage || 0;
      editBundleDescription.value = description;

      if (isDevEnv) {
        console.log('Populating edit form:', {
          bundleId,
          price,
          discountPercentage,
          description
        });
      }

      // Show the modal
      editBundleModal.classList.remove('hidden');
    });
  });

  // Close modal on close button click
  closeEditBundleModal.addEventListener('click', () => {
    editBundleModal.classList.add('hidden');
    editBundleForm.reset();
  });

  // Close modal when clicking outside the modal content
  editBundleModal.addEventListener('click', (e) => {
    if (e.target === editBundleModal) {
      editBundleModal.classList.add('hidden');
      editBundleForm.reset();
    }
  });

  // Handle form submission
  editBundleForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const rawPrice = editBundlePrice.value.trim();
    const price = Number(rawPrice);
    const discount = editBundleDiscount.value ? Number(editBundleDiscount.value) : 0;
    const description = editBundleDescription.value.trim();

    if (isDevEnv) {
      console.log('Form inputs:', {
        rawPrice,
        convertedPrice: price,
        discount,
        description
      });
    }

    if (!rawPrice || isNaN(price) || price <= 0) {
      alert('Please enter a valid price greater than 0.');
      if (isDevEnv) console.warn('Invalid price input:', rawPrice);
      return;
    }

    if (discount < 0 || discount > 100) {
      alert('Discount percentage must be between 0 and 100.');
      if (isDevEnv) console.warn('Invalid discount input:', editBundleDiscount.value);
      return;
    }

    if (!description) {
      alert('Please enter a bundle description.');
      if (isDevEnv) console.warn('Empty description input');
      return;
    }

    const data = {
      price,
      description,
      discountPercentage: discount,
      fingerprint: null // Placeholder, will be set after getting fingerprint
    };

    const submitButton = editBundleForm.querySelector('.form-button');
    const originalText = submitButton.textContent;
    submitButton.textContent = 'Updating...';
    submitButton.disabled = true;

    const bundleId = editBundleForm.action.split('/').pop();
    const actionUrl = `/profile/edit-bundle/${bundleId}`;
    if (isDevEnv) console.log('Submitting to URL:', actionUrl);

    try {
      // Retrieve fingerprint
      const fingerprintId = await getFingerprint();
      data.fingerprint = fingerprintId;
      if (isDevEnv) console.log('Data sent to server:', data);

      const response = await fetchWithCsrf(actionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text);
        throw new Error(`Failed to parse server response: ${parseError.message}`);
      }

      if (response.ok && result.status === 'success') {
        alert(result.message || 'Bundle updated successfully.');
        window.location.reload();
      } else {
        if (isDevEnv) console.error('Bundle update error:', result);
        alert(result.message || 'Error updating bundle. Please try again.');
        submitButton.textContent = originalText;
        submitButton.disabled = false;
      }
    } catch (err) {
      if (isDevEnv) console.error('Fetch error updating bundle:', err.message);
      alert('Error updating bundle. Please try again.');
      submitButton.textContent = originalText;
      submitButton.disabled = false;
    } finally {
      editBundleModal.classList.add('hidden');
      editBundleForm.reset();
    }
  });
} else if (isDevEnv) {
  console.warn('Edit bundle modal or form elements not found:', {
    editBundleModal: !!editBundleModal,
    editBundleForm: !!editBundleForm,
    closeEditBundleModal: !!closeEditBundleModal,
    editBundlePrice: !!editBundlePrice,
    editBundleDiscount: !!editBundleDiscount,
    editBundleDescription: !!editBundleDescription
  });
}

// --- Delete Bundle ---
document.querySelectorAll('.delete-bundle-form').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = form.querySelector('button');
    const originalHtml = submitButton.innerHTML;
    submitButton.innerHTML = 'Processing...';
    submitButton.disabled = true;

    // Confirmation prompt
    if (!confirm('Are you sure you want to delete this bundle? This action cannot be undone.')) {
      submitButton.innerHTML = originalHtml;
      submitButton.disabled = false;
      return;
    }

    try {
      const fingerprintId = await getFingerprint();
      const data = { fingerprint: fingerprintId };
      if (isDevEnv) console.log('Data sent to server:', data);

      const response = await fetchWithCsrf(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text);
        throw new Error('Failed to parse server response');
      }

      if (response.ok && result.status === 'success') {
        alert(result.message || 'Bundle deleted successfully.');
        // Remove bundle from DOM
        const bundleItem = form.closest('.bundle-item');
        if (bundleItem) bundleItem.remove();
        // Update bundle count in Manage Bundles button
        const manageBundlesBtn = document.querySelector('.manage-bundles-button');
        if (manageBundlesBtn) {
          const currentCount = parseInt(manageBundlesBtn.textContent.match(/\d+/)[0], 10);
          manageBundlesBtn.textContent = `Manage Bundles (${currentCount - 1})`;
        }
      } else {
        if (isDevEnv && response.status === 429) {
          console.log('Rate limit exceeded for delete bundle:', result.message);
        }
        alert(result.message || 'Failed to delete bundle.');
        submitButton.innerHTML = originalHtml;
        submitButton.disabled = false;
      }
    } catch (error) {
      if (isDevEnv) console.error('Error deleting bundle:', error.message);
      alert(`Error deleting bundle: ${error.message}`);
      submitButton.innerHTML = originalHtml;
      submitButton.disabled = false;
    }
  });
});
  // --- Create Bundle Form AJAX ---
const createBundleForm = document.getElementById('createBundleForm');
if (createBundleForm) {
  createBundleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const priceInput = document.getElementById('bundlePrice');
    const discountInput = document.getElementById('bundleDiscount');
    const durationInput = document.getElementById('bundleDuration');
    const descriptionInput = document.getElementById('bundleDescription');

    const price = Number(priceInput.value.trim());
    const discount = Number(discountInput.value) || 0;
    const duration = durationInput.value;
    const description = descriptionInput.value.trim();

    const submitButton = createBundleForm.querySelector('.form-button');
    const originalText = submitButton.textContent;

    if (isDevEnv) {
      console.log('Create form inputs:', { price, discount, duration, description });
    }

    if (isNaN(price) || price <= 0) {
      alert('Please enter a valid price greater than 0.');
      if (isDevEnv) console.warn('Invalid price:', price);
      return;
    }
    if (discount < 0 || discount > 100) {
      alert('Discount percentage must be between 0 and 100.');
      if (isDevEnv) console.warn('Invalid discount:', discount);
      return;
    }
    if (!duration || !['1 day', '1 month', '3 months', '6 months', '1 year'].includes(duration)) {
      alert('Please select a valid duration.');
      if (isDevEnv) console.warn('Invalid duration:', duration);
      return;
    }
    if (!description) {
      alert('Please enter a bundle description.');
      if (isDevEnv) console.warn('Empty description');
      return;
    }

    const data = {
      price,
      discountPercentage: discount,
      duration,
      description,
      fingerprint: null // Placeholder, will be set after getting fingerprint
    };

    submitButton.textContent = 'Creating...';
    submitButton.disabled = true;

    try {
      // Retrieve fingerprint
      const fingerprintId = await getFingerprint();
      data.fingerprint = fingerprintId;
      if (isDevEnv) console.log('Data sent to server:', data);

      const response = await fetchWithCsrf('/profile/create-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text);
        throw new Error(`Failed to parse server response: ${parseError.message}`);
      }

      if (response.ok && result.status === 'success') {
        alert(result.message || 'Bundle created successfully.');
        window.location.href = result.redirect || '/profile';
      } else {
        if (isDevEnv) console.error('Bundle creation error:', result);
        alert(result.message || 'Error creating bundle. Please try again.');
        submitButton.textContent = originalText;
        submitButton.disabled = false;
      }
    } catch (err) {
      if (isDevEnv) console.error('Error creating bundle:', err.message);
      alert(`Error creating bundle: ${err.message}`);
      submitButton.textContent = originalText;
      submitButton.disabled = false;
    }
  });
}

  // --- Toggle Unlock Price based on Special Checkbox ---
  if (isCreatorViewingOwnProfile) {
    const specialCheckbox = document.getElementById('specialCheckbox');
    const unlockPriceContainer = document.getElementById('unlockPriceContainer');
    const unlockPriceInput = document.getElementById('unlockPrice');

    if (specialCheckbox && unlockPriceContainer && unlockPriceInput) {
      const togglePriceVisibility = () => {
        if (specialCheckbox.checked) {
          unlockPriceContainer.classList.remove('hidden');
          unlockPriceInput.required = true;
        } else {
          unlockPriceContainer.classList.add('hidden');
          unlockPriceInput.required = false;
        }
      };
      togglePriceVisibility();
      specialCheckbox.addEventListener('change', togglePriceVisibility);
    }
  }

  // --- Unlock Special Content ---
document.querySelectorAll('.unlock-button').forEach(button => {
  button.addEventListener('click', async function(e) {
    e.preventDefault();
    e.stopPropagation();
    const contentId = this.dataset.contentId;
    const creatorId = this.dataset.creatorId;
    const originalText = this.textContent;
    this.textContent = 'Processing...';
    this.disabled = true;

    try {
      const fingerprintId = await getFingerprint();
      const response = await fetchWithCsrf('/profile/unlock-special-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentId, creatorId, fingerprint: fingerprintId })
      });

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text);
        throw new Error(`Failed to parse server response: ${parseError.message}`);
      }

      if (response.ok && result.status === 'success' && result.data.paymentLink) {
        this.textContent = 'Redirecting...';
        window.location.href = result.data.paymentLink;
      } else {
        if (isDevEnv && response.status === 429) {
          console.log('Rate limit exceeded for unlock:', result.message);
        }
        alert(result.message || 'Failed to initialize payment.');
        this.textContent = originalText;
        this.disabled = false;
      }
    } catch (error) {
      if (isDevEnv) console.error('Error unlocking content:', error.message);
      alert(`Error unlocking: ${error.message}`);
      this.textContent = originalText;
      this.disabled = false;
    }
  });
});
  // --- Like Button ---
document.querySelectorAll('.like-button').forEach(button => {
  button.addEventListener('click', async function() {
    const postId = this.dataset.postId;
    const likeIcon = this.querySelector('i');
    const likeCountSpan = this.querySelector('.like-count');

    // Validate inputs
    if (!postId) {
      alert('Error: Post ID is missing');
      return;
    }
    if (!likeIcon || !likeCountSpan) {
      alert('Error: Like button is missing icon or count element');
      return;
    }

    try {
      // Check if fetchWithCsrf is defined
      if (typeof fetchWithCsrf !== 'function') {
        throw new Error('fetchWithCsrf is not defined. Please check script loading.');
      }

      const fingerprintId = await getFingerprint();
      const res = await fetchWithCsrf(`/profile/posts/${postId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: fingerprintId })
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text);
        throw new Error(`Failed to parse server response: ${parseError.message}`);
      }

      if (res.ok) {
        likeCountSpan.textContent = data.likes;
        likeIcon.classList.toggle('liked', data.userLiked);
      } else {
        if (isDevEnv && res.status === 429) {
          console.log('Rate limit exceeded for like:', data.message);
        }
        alert(data.message || `Could not like post (Status: ${res.status})`);
      }
    } catch (error) {
      if (isDevEnv) console.error('Error liking post:', error.message);
      alert(`Error liking post: ${error.message}`);
    }
  });
});

// --- Comment Icon Toggle ---
// (Unchanged, no FingerprintJS needed)
document.querySelectorAll('.comment-icon').forEach(button => {
  button.addEventListener('click', function() {
    const parentElement = this.closest('.post-card') || this.closest('.media-item');
    if (!parentElement) {
      if (isDevEnv) console.warn('Parent element not found for comment icon');
      return;
    }
    const commentContainer = parentElement.querySelector('.comment-form-container');
    if (!commentContainer) {
      if (isDevEnv) console.warn('Comment form container not found');
      return;
    }
    const isHidden = commentContainer.classList.contains('hidden');
    commentContainer.classList.toggle('hidden');
    if (isHidden) {
      const input = commentContainer.querySelector('input[name="comment"]');
      if (input) input.focus();
    }
  });
});

// --- Comment Form Submit ---
document.querySelectorAll('.comment-form').forEach(form => {
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const postId = this.dataset.postId;
    const commentInput = this.querySelector('input[name="comment"]');
    const commentText = commentInput.value.trim();
    const submitButton = this.querySelector('button[type="submit"]');
    if (!commentText) return;
    const originalButtonText = submitButton.textContent;
    submitButton.textContent = 'Posting...';
    submitButton.disabled = true;

    try {
      const fingerprintId = await getFingerprint();
      const res = await fetchWithCsrf(`/profile/posts/${postId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: commentText, fingerprint: fingerprintId })
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text);
        throw new Error(`Failed to parse server response: ${parseError.message}`);
      }

      if (res.ok) {
        const parentElement = this.closest('.post-card') || this.closest('.media-item');
        const commentsDiv = parentElement.querySelector('.comments');
        const newCommentDiv = document.createElement('div');
        newCommentDiv.classList.add('comment');
        const username = data.comment && data.comment.user ? data.comment.user.username : 'You';
        newCommentDiv.innerHTML = `<strong>${username}:</strong> ${data.comment.text}`;
        const viewAllLink = commentsDiv.querySelector('.view-all-comments');
        if (viewAllLink) {
          commentsDiv.insertBefore(newCommentDiv, viewAllLink);
        } else {
          commentsDiv.appendChild(newCommentDiv);
        }
        const commentCountSpan = parentElement.querySelector('.comment-count');
        if (commentCountSpan && data.commentCount !== undefined) {
          commentCountSpan.textContent = data.commentCount;
        }
        commentInput.value = '';
        this.closest('.comment-form-container').classList.add('hidden');
      } else {
        if (isDevEnv && res.status === 429) {
          console.log('Rate limit exceeded for comment:', data.message);
        }
        alert(data.message || 'Failed to post comment.');
      }
    } catch (error) {
      if (isDevEnv) console.error('Error posting comment:', error.message);
      alert(`Error posting comment: ${error.message}`);
    } finally {
      submitButton.textContent = originalButtonText;
      submitButton.disabled = false;
    }
  });
});

// --- Bookmark Button ---
document.querySelectorAll('.bookmark-button').forEach(button => {
  button.addEventListener('click', async function() {
    const postId = this.dataset.postId;
    const bookmarkIcon = this.querySelector('i');

    try {
      const fingerprintId = await getFingerprint();
      const res = await fetchWithCsrf(`/profile/posts/${postId}/bookmark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: fingerprintId })
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text);
        throw new Error(`Failed to parse server response: ${parseError.message}`);
      }

      if (res.ok) {
        bookmarkIcon.classList.toggle('bookmarked', data.isBookmarked);
      } else {
        if (isDevEnv && res.status === 429) {
          console.log('Rate limit exceeded for bookmark:', data.message);
        }
        alert(data.message || 'Could not bookmark post.');
      }
    } catch (error) {
      if (isDevEnv) console.error('Error bookmarking post:', error.message);
      alert(`Error bookmarking post: ${error.message}`);
    }
  });
});
  // --- AJAX for Bundle Subscription ---
 document.querySelectorAll('.subscribe-bundle-form').forEach(form => {
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!isLoggedIn) {
      try {
        const redirectResponse = await fetchWithCsrf('/store-redirect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ redirectTo: window.location.pathname }) // Fixed redirect path
        });
        if (!redirectResponse.ok && isDevEnv) {
          console.error('Failed to store redirect:', redirectResponse.status);
        }
      } catch (error) {
        if (isDevEnv) console.error('Error storing redirect:', error.message);
      }
      const username = document.querySelector('.profile-container').dataset.username;
      window.location.href = `/?creator=${encodeURIComponent(username)}`; // Fixed redirect URL
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    const originalHtml = submitButton.innerHTML;
    submitButton.innerHTML = 'Processing...';
    submitButton.disabled = true;

    try {
      const formData = new FormData(form);
      const fingerprintId = await getFingerprint(); // Get the fingerprint
      const data = {
        creatorId: formData.get('creatorId'),
        bundleId: formData.get('bundleId'),
        creatorUsername: formData.get('creatorUsername'),
        fingerprint: fingerprintId // Add fingerprint to data
      };
      const response = await fetchWithCsrf('/profile/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text);
        throw new Error(`Failed to parse server response: ${parseError.message}`);
      }
      if (response.ok && result.status === 'success') {
        if (result.data && result.data.paymentLink) {
          submitButton.innerHTML = 'Redirecting...';
          window.location.href = result.data.paymentLink;
        } else {
          alert(result.message || 'Subscribed successfully.');
          window.location.href = result.redirect || window.location.pathname; // Fixed redirect path
        }
      } else {
        if (isDevEnv) console.error('Bundle subscription error:', result);
        alert(result.message || 'Error subscribing. Please try again.');
        submitButton.innerHTML = originalHtml;
        submitButton.disabled = false;
      }
    } catch (err) {
      if (isDevEnv) console.error('Error subscribing to bundle:', err.message);
      alert('Error subscribing. Please try again.');
      submitButton.innerHTML = originalHtml;
      submitButton.disabled = false;
    }
  });
});

   // --- Tip Button (Post-specific) ---
  document.querySelectorAll('.tip-button').forEach(button => {
    button.addEventListener('click', async function() {
      const postId = this.dataset.postId;
      const creatorId = this.dataset.creatorId;
      let tipAmountNum = NaN;

      // Prompt for tip amount and validate
      while (isNaN(tipAmountNum) || tipAmountNum <= 0) {
        const tipAmountStr = prompt("Enter tip amount in NGN (e.g., 500):");
        if (tipAmountStr === null) return; // User canceled
        tipAmountNum = parseFloat(tipAmountStr);
        if (isNaN(tipAmountNum) || tipAmountNum <= 0) {
          alert("Please enter a valid positive number.");
        }
      }

      const originalHtml = this.innerHTML;
      this.innerHTML = 'Processing...';
      this.disabled = true;

      try {
        const fingerprintId = await getFingerprint();
        const response = await fetchWithCsrf(`/profile/posts/${postId}/tip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tipAmount: tipAmountNum,
            creatorId: creatorId,
            fingerprint: fingerprintId
          })
        });

        const text = await response.text();
        let result;
        try {
          result = JSON.parse(text);
        } catch (parseError) {
          if (isDevEnv) console.error('Non-JSON response:', text);
          throw new Error('Failed to parse server response');
        }

        if (response.ok && result.status === 'success' && result.data.paymentLink) {
          this.innerHTML = 'Redirecting...';
          window.location.href = result.data.paymentLink;
        } else {
          if (isDevEnv && response.status === 429) {
            console.log('Rate limit exceeded for tip:', result.message);
          }
          alert(result.message || 'Failed to initialize tip payment.');
          this.innerHTML = originalHtml;
          this.disabled = false;
        }
      } catch (error) {
        if (isDevEnv) console.error('Error processing tip:', error.message);
        alert(`Error processing tip: ${error.message}`);
        this.innerHTML = originalHtml;
        this.disabled = false;
      }
    });
  });

  // --- Unsubscribe Form ---
document.querySelectorAll('.inline-form').forEach(form => {
  form.addEventListener('submit', async function(e) {
    e.preventDefault();

    // Check if the user is logged in
    if (!isLoggedIn) {
      try {
        const redirectResponse = await fetchWithCsrf('/store-redirect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ redirectTo: window.location.pathname })
        });
        if (!redirectResponse.ok && isDevEnv) {
          console.error('Failed to store redirect:', redirectResponse.status);
        }
      } catch (error) {
        if (isDevEnv) console.error('Error storing redirect:', error.message);
      }
      const username = document.querySelector('.profile-container').dataset.username;
      window.location.href = `/?creator=${encodeURIComponent(username)}`;
      return;
    }

    // Update button state to indicate processing
    const submitButton = form.querySelector('.unsubscribe-btn');
    const originalHtml = submitButton.innerHTML;
    submitButton.innerHTML = 'Processing...';
    submitButton.disabled = true;

    try {
      // Extract creatorId from the form action URL
      const creatorId = form.action.match(/\/unsubscribe\/([a-f0-9]+)/)?.[1];
      if (!creatorId) {
        throw new Error('Creator ID not found in form action URL');
      }

      // Get the device fingerprint
      const fingerprintId = await getFingerprint();
      const data = {
        fingerprint: fingerprintId
      };
      if (isDevEnv) console.log('Unsubscribe data:', data);

      // Send AJAX request to unsubscribe endpoint
      const response = await fetchWithCsrf(`/profile/unsubscribe/${creatorId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      // Parse the response
      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text);
        throw new Error(`Failed to parse server response: ${parseError.message}`);
      }

      // Handle successful response
      if (response.ok && result.status === 'success') {
        alert(result.message || 'Unsubscribed successfully.');
        window.location.href = result.redirect || window.location.pathname;
      } else {
        // Handle error response
        if (isDevEnv) console.error('Unsubscribe error:', result);
        alert(result.message || 'Error unsubscribing. Please try again.');
        submitButton.innerHTML = originalHtml;
        submitButton.disabled = false;
      }
    } catch (err) {
      // Handle any errors during the process
      if (isDevEnv) console.error('Error unsubscribing:', err.message);
      alert('Error unsubscribing. Please try again.');
      submitButton.innerHTML = originalHtml;
      submitButton.disabled = false;
    }
  });
});
  // --- Tip Modal ---
if (isVisitorSubscribed && !isCreatorViewingOwnProfile) {
  const initializeTipModal = () => {
    const tipProfileButtons = document.querySelectorAll('.tip-profile-button');
    const tipModal = document.getElementById('tipModal');
    const closeTipModal = document.getElementById('closeTipModal');
    const tipForm = document.getElementById('tipForm');

    let currentCreatorId = null;

    if (!tipModal || tipProfileButtons.length === 0) {
      if (isDevEnv) console.warn('Tip modal or buttons not found');
      return;
    }

    tipProfileButtons.forEach(button => {
      button.addEventListener('click', function() {
        currentCreatorId = this.dataset.creatorId;
        tipModal.classList.add('active');
      });
    });

    closeTipModal.addEventListener('click', () => {
      tipModal.classList.remove('active');
      tipForm.reset();
    });

    tipModal.addEventListener('click', (e) => {
      if (e.target === tipModal) {
        tipModal.classList.remove('active');
        tipForm.reset();
      }
    });

    tipForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      const tipAmount = parseFloat(document.getElementById('tipAmount').value);
      const tipMessage = document.getElementById('tipMessage').value.trim();
      const submitButton = tipForm.querySelector('.send-tip-button');
      const originalText = submitButton.textContent;

      if (!tipAmount || tipAmount <= 0) {
        alert('Please enter a valid tip amount greater than 0.');
        return;
      }

      submitButton.textContent = 'Processing...';
      submitButton.disabled = true;

      try {
        const fingerprintId = await getFingerprint();
        const response = await fetchWithCsrf(`/profile/tip-creator/${currentCreatorId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipAmount, tipMessage, fingerprint: fingerprintId })
        });

        const text = await response.text();
        let result;
        try {
          result = JSON.parse(text);
        } catch (parseError) {
          if (isDevEnv) console.error('Non-JSON response:', text);
          throw new Error('Failed to parse server response');
        }

        if (response.ok && result.status === 'success' && result.data.paymentLink) {
          submitButton.textContent = 'Redirecting...';
          window.location.href = result.data.paymentLink;
        } else {
          if (isDevEnv && response.status === 429) {
            console.log('Rate limit exceeded for profile tip:', result.message);
          }
          alert(result.message || 'Failed to initialize tip payment.');
          submitButton.textContent = originalText;
          submitButton.disabled = false;
        }
      } catch (err) {
        if (isDevEnv) console.error('Error processing profile tip:', err.message);
        alert(`Error processing tip: ${err.message}`);
        submitButton.textContent = originalText;
        submitButton.disabled = false;
      } finally {
        tipModal.classList.remove('active');
        tipForm.reset();
      }
    });
  };

  initializeTipModal();
}

  // --- Tab Switching ---
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.add('hidden'));
      button.classList.add('active');
      document.getElementById(`${button.dataset.tab}-tab`).classList.remove('hidden');
    });
  });

 // --- Sub-Tab Switching ---
// Posts Subtabs
const postSubtabButtons = document.querySelectorAll('.posts-subtabs .subtab-button');
const postsContainer = document.querySelector('#posts-tab .posts-container');
const postsList = postsContainer ? postsContainer.querySelector('.posts-list') : null;
const posts = postsList ? postsList.querySelectorAll('.post-card') : [];
const noPostsMessage = postsList ? postsList.querySelector('.no-posts-message') : null;

// Function to filter posts based on subtab
function filterPosts(selectedSubtab) {
  const subtab = selectedSubtab.toLowerCase();
  let visiblePosts = 0;

  posts.forEach(post => {
    const postCategory = (post.getAttribute('data-category') || 'none').toLowerCase();
    if (subtab === 'all' || subtab === postCategory) {
      post.classList.remove('hidden');
      visiblePosts++;
    } else {
      post.classList.add('hidden');
    }
  });

  if (noPostsMessage) {
    noPostsMessage.classList.toggle('hidden', visiblePosts !== 0);
    noPostsMessage.textContent = subtab === 'all' ? 
      'This creator hasn\'t posted anything yet.' : 
      subtab === 'none' ? 
        'No uncategorized posts.' : 
        `No posts in the ${subtab.charAt(0).toUpperCase() + subtab.slice(1)} category.`;
  }
}

// Attach event listeners to subtab buttons
if (postsList && postSubtabButtons.length > 0) {
  postSubtabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const subtab = button.getAttribute('data-subtab');

      // Update active subtab
      postSubtabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');

      // Filter posts
      filterPosts(subtab);
    });
  });

  // Apply initial filtering based on active subtab
  const activeSubtabButton = document.querySelector('.posts-subtabs .subtab-button.active');
  if (activeSubtabButton) {
    filterPosts(activeSubtabButton.getAttribute('data-subtab'));
  }
} else if (noPostsMessage) {
  noPostsMessage.classList.remove('hidden');
  noPostsMessage.textContent = 'This creator hasn\'t posted anything yet.';
}
  // Media Subtabs
  const mediaSubtabButtons = document.querySelectorAll('.media-subtabs .subtab-button');
  const mediaViews = document.querySelectorAll('.media-view');
  mediaSubtabButtons.forEach(button => {
    button.addEventListener('click', () => {
      mediaSubtabButtons.forEach(btn => btn.classList.remove('active'));
      mediaViews.forEach(view => view.classList.remove('active'));
      button.classList.add('active');
      const subtab = button.getAttribute('data-subtab');
      document.getElementById(`media-${subtab}`).classList.add('active');
    });
  });

 // --- Category Management Form ---
const manageCategoriesForm = document.getElementById('manage-categories-form');
if (manageCategoriesForm) {
  manageCategoriesForm.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const action = form.querySelector('select[name="action"]').value;
    const category = form.querySelector('input[name="category"]').value;
    const newCategory = form.querySelector('input[name="newCategory"]').value;

    try {
      const fingerprintId = await getFingerprint();
      const response = await fetchWithCsrf('/profile/manage-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, category, newCategory, fingerprint: fingerprintId })
      });

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text);
        throw new Error(`Failed to parse server response: ${parseError.message}`);
      }

      if (response.ok && result.status === 'success') {
        alert(result.message);
        window.location.reload(); // Reload to update subtabs and views
      } else {
        if (isDevEnv && response.status === 429) {
          console.log('Rate limit exceeded for category management:', result.message);
        }
        alert(result.message || 'Error managing category.');
      }
    } catch (err) {
      if (isDevEnv) console.error('Error managing category:', err.message);
      alert(`Error managing category: ${err.message}`);
    }
  });

  // Show/hide newCategory input based on action
  const actionSelect = manageCategoriesForm.querySelector('select[name="action"]');
  if (actionSelect) {
    actionSelect.addEventListener('change', e => {
      const newCategoryInput = document.getElementById('new-category-input');
      if (e.target.value === 'edit') {
        newCategoryInput.classList.remove('hidden');
      } else {
        newCategoryInput.classList.add('hidden');
      }
    });
  }
}
  // --- Compact View Toggle ---
  const viewToggle = document.querySelector('.view-toggle-button');
  const mediaContents = document.querySelectorAll('.media-content');
  if (viewToggle) {
    viewToggle.addEventListener('click', () => {
      const isCompact = mediaContents[0].classList.contains('posts-list');
      mediaContents.forEach(content => {
        if (isCompact) {
          content.classList.remove('posts-list');
          content.classList.add('media-list');
        } else {
          content.classList.remove('media-list');
          content.classList.add('posts-list');
        }
      });
      viewToggle.classList.toggle('active');
      const icon = viewToggle.querySelector('i');
      icon.classList.toggle('fa-th');
      icon.classList.toggle('fa-th-large');
      if (isDevEnv) {
        console.log(`Switched to ${isCompact ? 'compact' : 'normal'} view`);
      }
    });
  }

  // --- Upload Form Validation ---
if (isCreatorViewingOwnProfile) {
  const uploadForm = document.getElementById('uploadContentForm');
  const specialCheckbox = document.getElementById('specialCheckbox');
  const unlockPriceContainer = document.getElementById('unlockPriceContainer');
  const unlockPriceInput = document.getElementById('unlockPrice');
  const imagesInput = document.getElementById('contentImages');
  const videosInput = document.getElementById('contentVideos');
  const addImagesButton = document.getElementById('addImagesButton');
  const addVideosButton = document.getElementById('addVideosButton');
  const mediaPreview = document.getElementById('mediaPreview');
  const categorySelect = document.getElementById('category');

  // Store selected files
  let selectedImages = [];
  let selectedVideos = [];

  if (uploadForm && specialCheckbox && unlockPriceContainer && unlockPriceInput && imagesInput && videosInput && addImagesButton && addVideosButton && mediaPreview && categorySelect) {
    // Toggle unlock price visibility
    const togglePriceVisibility = () => {
      if (specialCheckbox.checked) {
        unlockPriceContainer.classList.remove('hidden');
        unlockPriceInput.required = true;
      } else {
        unlockPriceContainer.classList.add('hidden');
        unlockPriceInput.required = false;
        unlockPriceInput.value = '';
      }
    };
    specialCheckbox.addEventListener('change', togglePriceVisibility);
    togglePriceVisibility();

    // Trigger file input clicks
    addImagesButton.addEventListener('click', () => imagesInput.click());
    addVideosButton.addEventListener('click', () => videosInput.click());

    // Generate preview for selected files
    const updatePreview = () => {
      mediaPreview.innerHTML = ''; // Clear existing previews
      const totalFiles = selectedImages.length + selectedVideos.length;

      if (totalFiles === 0) {
        mediaPreview.classList.add('hidden');
        return;
      }
      mediaPreview.classList.remove('hidden');

      // Display images
      selectedImages.forEach((file, index) => {
        const previewItem = document.createElement('div');
        previewItem.className = 'preview-item';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.alt = file.name;
        const removeButton = document.createElement('button');
        removeButton.className = 'remove-media-button';
        removeButton.innerHTML = '×';
        removeButton.addEventListener('click', () => {
          selectedImages.splice(index, 1);
          updatePreview();
        });
        const nameSpan = document.createElement('span');
        nameSpan.className = 'preview-name';
        nameSpan.textContent = file.name;
        previewItem.appendChild(img);
        previewItem.appendChild(removeButton);
        previewItem.appendChild(nameSpan);
        mediaPreview.appendChild(previewItem);
      });

      // Display videos (thumbnail or fallback icon)
      selectedVideos.forEach((file, index) => {
        const previewItem = document.createElement('div');
        previewItem.className = 'preview-item';
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.muted = true; // Required for autoplay in some browsers
        video.addEventListener('loadedmetadata', () => {
          video.currentTime = 1; // Show a frame at 1 second
        });
        const removeButton = document.createElement('button');
        removeButton.className = 'remove-media-button';
        removeButton.innerHTML = '×';
        removeButton.addEventListener('click', () => {
          selectedVideos.splice(index, 1);
          updatePreview();
        });
        const nameSpan = document.createElement('span');
        nameSpan.className = 'preview-name';
        nameSpan.textContent = file.name;
        previewItem.appendChild(video);
        previewItem.appendChild(removeButton);
        previewItem.appendChild(nameSpan);
        mediaPreview.appendChild(previewItem);
      });
    };

    // Handle image selection
    imagesInput.addEventListener('change', (e) => {
      const newFiles = Array.from(e.target.files);
      if (selectedImages.length + selectedVideos.length + newFiles.length > 10) {
        alert('You can upload a maximum of 10 media files (images or videos combined).');
        e.target.value = ''; // Clear input
        return;
      }
      selectedImages = [...selectedImages, ...newFiles];
      e.target.value = ''; // Clear input for next selection
      updatePreview();
    });

    // Handle video selection
    videosInput.addEventListener('change', (e) => {
      const newFiles = Array.from(e.target.files);
      if (selectedImages.length + selectedVideos.length + newFiles.length > 10) {
        alert('You can upload a maximum of 10 media files (images or videos combined).');
        e.target.value = ''; // Clear input
        return;
      }
      selectedVideos = [...selectedVideos, ...newFiles];
      e.target.value = ''; // Clear input for next selection
      updatePreview();
    });

    // Form submission: Append files to FormData
    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault(); // Prevent default submission

      const writeUp = document.getElementById('writeUp').value.trim();
      const isSpecial = specialCheckbox.checked;
      const unlockPrice = parseFloat(unlockPriceInput.value);
      const category = categorySelect.value; // Get selected category
      const totalFiles = selectedImages.length + selectedVideos.length;

      // Validation
      if (totalFiles === 0 && !writeUp) {
        alert('Please provide text or upload at least one image or video to create a post.');
        return;
      }
      if (totalFiles > 10) {
        alert('You can upload a maximum of 10 media files (images or videos combined).');
        return;
      }
      if (isSpecial && (!unlockPrice || unlockPrice < 100)) {
        alert('Please provide a valid unlock price (minimum 100 NGN) for special content.');
        return;
      }

      // Create FormData and append fields
      const formData = new FormData();
      formData.append('writeUp', writeUp);
      formData.append('special', isSpecial);
      if (isSpecial) {
        formData.append('unlockPrice', unlockPrice);
      }
      formData.append('category', category || ''); // Append category
      selectedImages.forEach((file) => {
        formData.append('contentImages', file);
      });
      selectedVideos.forEach((file) => {
        formData.append('contentVideos', file);
      });

      // Append fingerprint
      try {
        const fingerprintId = await getFingerprint();
        formData.append('fingerprint', fingerprintId);
      } catch (error) {
        if (isDevEnv) console.error('Failed to get fingerprint for upload:', error.message);
        alert(`Error preparing upload: ${error.message}`);
        return;
      }

      // Submit FormData via fetchWithCsrf
      try {
        const response = await fetchWithCsrf(uploadForm.action, {
          method: 'POST',
          body: formData
        });

        // Check for redirect first
        if (response.redirected) {
          window.location.href = response.url;
          return;
        }

        // If not redirected, try to parse the response as JSON
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (parseError) {
          if (isDevEnv) console.error('Non-JSON response:', text, parseError);
          // If response is OK but not JSON, treat as success (fallback)
          if (response.ok) {
            alert('Post created successfully!');
            window.location.reload();
            return;
          }
          throw new Error(`Failed to parse server response: ${parseError.message}`);
        }

        // Handle JSON response
        if (response.ok && data.status === 'success') {
          alert('Post created successfully!');
          window.location.reload(); // Reload to update posts
        } else {
          if (isDevEnv && response.status === 429) {
            console.log('Rate limit exceeded for upload:', data.message);
          }
          alert(data.message || 'Error uploading content.');
        }
      } catch (error) {
        if (isDevEnv) console.error('Form submission error:', error);
        alert(`Error uploading content: ${error.message}`);
      }
    });
  } else if (isDevEnv) {
    console.warn('Upload form elements not found:', {
      uploadForm: !!uploadForm,
      specialCheckbox: !!specialCheckbox,
      unlockPriceContainer: !!unlockPriceContainer,
      unlockPriceInput: !!unlockPriceInput,
      imagesInput: !!imagesInput,
      videosInput: !!videosInput,
      addImagesButton: !!addImagesButton,
      addVideosButton: !!addVideosButton,
      mediaPreview: !!mediaPreview,
      categorySelect: !!categorySelect
    });
  }
}

  // --- Share Profile Modal ---
  const initializeShareModal = () => {
    const shareButtons = document.querySelectorAll('.share-icon');
    const shareModal = document.getElementById('shareModal');
    const closeShareModal = document.getElementById('closeShareModal');
    const copyLinkButton = document.getElementById('copyLinkButton');
    const shareTwitter = document.getElementById('shareTwitter');
    const shareWhatsApp = document.getElementById('shareWhatsApp');
    const shareTelegram = document.getElementById('shareTelegram');
    const shareFacebook = document.getElementById('shareFacebook');
    const shareNativeButton = document.getElementById('shareNativeButton');

    let currentUsername = null;

    if (!shareModal || shareButtons.length === 0) {
      if (isDevEnv) console.warn('Share modal or buttons not found');
      return;
    }

    const getProfileLink = (username) => {
      return `${window.location.origin}/profile/${username}`;
    };

    const updateShareLinks = (username) => {
      const profileLink = getProfileLink(username);
      const encodedLink = encodeURIComponent(profileLink);
      const shareText = encodeURIComponent(`Check out ${username}'s profile!`);

      copyLinkButton.dataset.link = profileLink;
      shareTwitter.href = `https://twitter.com/intent/tweet?url=${encodedLink}&text=${shareText}`;
      shareWhatsApp.href = `https://api.whatsapp.com/send?text=${shareText}%20${encodedLink}`;
      shareTelegram.href = `https://t.me/share/url?url=${encodedLink}&text=${shareText}`;
      shareFacebook.href = `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}`;
    };

    shareButtons.forEach(button => {
      button.addEventListener('click', function() {
        currentUsername = this.dataset.username;
        updateShareLinks(currentUsername);
        shareModal.classList.add('active');

        if (navigator.share) {
          shareNativeButton.classList.remove('hidden');
        } else {
          shareNativeButton.classList.add('hidden');
        }
      });
    });

    closeShareModal.addEventListener('click', () => {
      shareModal.classList.remove('active');
    });

    shareModal.addEventListener('click', (e) => {
      if (e.target === shareModal) {
        shareModal.classList.remove('active');
      }
    });

    copyLinkButton.addEventListener('click', async function() {
      const link = this.dataset.link;
      try {
        await navigator.clipboard.writeText(link);
        this.textContent = 'Link Copied!';
        this.disabled = true;
        setTimeout(() => {
          this.textContent = 'Copy Link';
          this.disabled = false;
        }, 2000);
      } catch (err) {
        if (isDevEnv) console.error('Error copying link:', err.message);
        alert('Failed to copy link.');
      }
    });

    shareNativeButton.addEventListener('click', async () => {
      try {
        await navigator.share({
          title: `${currentUsername}'s Profile`,
          text: `Check out ${currentUsername}'s profile!`,
          url: getProfileLink(currentUsername),
        });
        shareModal.classList.remove('active');
      } catch (err) {
        if (isDevEnv) console.error('Error sharing profile:', err.message);
        alert('Error sharing profile.');
      }
    });
  };

  initializeShareModal();

  // --- Post Action Modal ---
  const initializePostActionModal = () => {
    const container = document.querySelector('.profile-container') || document.querySelector('.home-container');
    const isDevEnv = container && container.dataset.env === 'development';
    const username = container ? container.dataset.username : null;

    const postMenuButtons = document.querySelectorAll('.post-menu-button');
    const postActionModal = document.getElementById('postActionModal');
    const closePostActionModal = document.getElementById('closePostActionModal');
    const sharePostButton = document.getElementById('sharePostButton');
    const reportPostButton = document.getElementById('reportPostButton');
    const postShareModal = document.getElementById('postShareModal');
    const closePostShareModal = document.getElementById('closePostShareModal');
    const copyPostLinkButton = document.getElementById('copyPostLinkButton');
    const sharePostTwitter = document.getElementById('sharePostTwitter');
    const sharePostWhatsApp = document.getElementById('sharePostWhatsApp');
    const sharePostTelegram = document.getElementById('sharePostTelegram');
    const sharePostFacebook = document.getElementById('sharePostFacebook');
    const sharePostNativeButton = document.getElementById('sharePostNativeButton');
    const reportPostModal = document.getElementById('reportPostModal');
    const closeReportPostModal = document.getElementById('closeReportPostModal');
    const reportForm = document.getElementById('reportPostForm');

    if (!postActionModal || postMenuButtons.length === 0) {
      if (isDevEnv) console.warn('Post action modal or menu buttons not found');
      return;
    }

    if (!reportPostModal || !reportForm || !closeReportPostModal) {
      if (isDevEnv) console.warn('Report modal, form, or close button not found');
      return;
    }

    postMenuButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        const postId = button.dataset.postId;
        if (!postId) {
          if (isDevEnv) console.warn('Post ID not found on menu button');
          return;
        }
        sharePostButton.dataset.postId = postId;
        reportPostButton.dataset.postId = postId;
        postActionModal.classList.remove('hidden');
        if (isDevEnv) console.log(`Opening post action modal for post ID: ${postId}`);
      });
    });

    closePostActionModal.addEventListener('click', () => {
      postActionModal.classList.add('hidden');
    });

    postActionModal.addEventListener('click', (e) => {
      if (e.target === postActionModal) {
        postActionModal.classList.add('hidden');
      }
    });

    // Share Post Button
    sharePostButton.addEventListener('click', () => {
      const postId = sharePostButton.dataset.postId;
      const effectiveUsername = username || document.querySelector('.share-icon')?.dataset.username || 'unknown';
      const postLink = `${window.location.origin}/profile/${encodeURIComponent(effectiveUsername)}/post/${postId}`;
      const encodedLink = encodeURIComponent(postLink);
      const shareText = encodeURIComponent(`Check out this post by @${effectiveUsername}!`);

      copyPostLinkButton.dataset.link = postLink;
      sharePostTwitter.href = `https://twitter.com/intent/tweet?url=${encodedLink}&text=${shareText}`;
      sharePostWhatsApp.href = `https://api.whatsapp.com/send?text=${shareText}%20${encodedLink}`;
      sharePostTelegram.href = `https://t.me/share/url?url=${encodedLink}&text=${shareText}`;
      sharePostFacebook.href = `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}`;
      sharePostNativeButton.dataset.link = postLink;

      if (navigator.share) {
        sharePostNativeButton.classList.remove('hidden');
      } else {
        sharePostNativeButton.classList.add('hidden');
      }

      postShareModal.classList.remove('hidden');
      postActionModal.classList.add('hidden');
      if (isDevEnv) console.log(`Opening share modal for post ID: ${postId}, link: ${postLink}`);
    });

    // Copy Link
    copyPostLinkButton.addEventListener('click', async () => {
      const link = copyPostLinkButton.dataset.link;
      try {
        await navigator.clipboard.writeText(link);
        copyPostLinkButton.textContent = 'Link Copied!';
        copyPostLinkButton.disabled = true;
        setTimeout(() => {
          copyPostLinkButton.textContent = 'Copy Link';
          copyPostLinkButton.disabled = false;
        }, 2000);
        if (isDevEnv) console.log(`Copied post link: ${link}`);
      } catch (err) {
        if (isDevEnv) console.error('Error copying post link:', err.message);
        alert('Failed to copy link.');
      }
    });

    // Native Share
    sharePostNativeButton.addEventListener('click', async () => {
      const link = sharePostNativeButton.dataset.link;
      const effectiveUsername = username || document.querySelector('.share-icon')?.dataset.username || 'unknown';
      try {
        await navigator.share({
          title: `Post by @${effectiveUsername}`,
          text: `Check out this post by @${effectiveUsername}!`,
          url: link
        });
        postShareModal.classList.add('hidden');
        if (isDevEnv) console.log(`Shared post via native share: ${link}`);
      } catch (err) {
        if (isDevEnv) console.error('Error sharing post:', err.message);
        alert('Error sharing post.');
      }
    });

    // Close Share Modal
    closePostShareModal.addEventListener('click', () => {
      postShareModal.classList.add('hidden');
    });

    postShareModal.addEventListener('click', (e) => {
      if (e.target === postShareModal) {
        postShareModal.classList.add('hidden');
      }
    });

    // Report Post Button
reportPostButton.addEventListener('click', () => {
  const postId = reportPostButton.dataset.postId;
  reportForm.dataset.postId = postId;
  reportPostModal.classList.remove('hidden');
  postActionModal.classList.add('hidden');
  if (isDevEnv) console.log(`Opening report modal for post ID: ${postId}`);
});

// Close Report Modal
closeReportPostModal.addEventListener('click', () => {
  reportPostModal.classList.add('hidden');
  reportForm.reset();
});

reportPostModal.addEventListener('click', (e) => {
  if (e.target === reportPostModal) {
    reportPostModal.classList.add('hidden');
    reportForm.reset();
  }
});

// Handle Report Form Submission
reportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const postId = reportForm.dataset.postId;
  const reason = reportForm.querySelector('#reportReason').value;
  const details = reportForm.querySelector('#reportDetails').value.trim();
  const submitButton = reportForm.querySelector('.report-submit-button');
  const originalText = submitButton.textContent;

  if (!postId || !reason) {
    if (isDevEnv) console.warn('Missing postId or reason:', { postId, reason });
    alert('Please select a reason for reporting.');
    return;
  }

  submitButton.textContent = 'Submitting...';
  submitButton.disabled = true;

  try {
    const fingerprintId = await getFingerprint();
    const response = await fetchWithCsrf('/profile/report-post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, reason, details, fingerprint: fingerprintId })
    });

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (parseError) {
      if (isDevEnv) console.error('Non-JSON response:', text);
      throw new Error(`Failed to parse server response: ${parseError.message}`);
    }

    if (response.ok && result.status === 'success') {
      alert(result.message || 'Report submitted successfully.');
      reportPostModal.classList.add('hidden');
      reportForm.reset();
    } else {
      if (isDevEnv && response.status === 429) {
        console.log('Rate limit exceeded for report:', result.message);
      }
      alert(result.message || 'Error submitting report.');
    }
  } catch (err) {
    if (isDevEnv) console.error('Error submitting report:', err.message);
    alert(`Error submitting report: ${err.message}`);
  } finally {
    submitButton.textContent = originalText;
    submitButton.disabled = false;
  }
});
  };

  // Call the function once to initialize the post action modal
  initializePostActionModal();

  // --- Post Deletion Forms ---
document.querySelectorAll('.delete-post-form').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const postId = form.dataset.postId || form.action.match(/\/(?:delete-post|admin-delete-post)\/([a-f0-9]+)/)?.[1];
    const isAdminDelete = form.action.includes('admin-delete-post');
    const reasonInput = isAdminDelete ? form.querySelector('input[name="reason"]') : null;
    const reason = reasonInput ? reasonInput.value.trim() : null;

    if (!postId) {
      if (isDevEnv) console.warn('Post ID not found in delete form');
      alert('Error: Post ID missing.');
      return;
    }

    if (isAdminDelete && (!reason || reason.length > 500)) {
      alert('Please provide a valid reason for deletion (max 500 characters).');
      return;
    }

    // Show confirmation alert
    if (!confirm('Are you sure you want to delete this post?')) {
      return;
    }

    const submitButton = form.querySelector('.delete-post-btn');
    const originalText = submitButton.textContent;
    submitButton.textContent = 'Deleting...';
    submitButton.disabled = true;

    try {
      const fingerprintId = await getFingerprint();
      const body = isAdminDelete ? { reason, fingerprint: fingerprintId } : { fingerprint: fingerprintId };
      const response = await fetchWithCsrf(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text);
        throw new Error('Invalid server response');
      }

      if (response.ok && result.status === 'success') {
        alert(result.message || 'Post deleted successfully.');
        const postCard = document.querySelector(`.post-card[data-post-id="${postId}"]`);
        if (postCard) postCard.remove();
        // For admin deletions, redirect to creator's profile
        if (isAdminDelete && result.creatorId) {
          window.location.href = `/profile/view/${result.creatorId}?adminView=true`;
        }
      } else {
        if (isDevEnv && response.status === 429) {
          console.log('Rate limit exceeded for post deletion:', result.message);
        }
        alert(result.message || 'Error deleting post.');
      }
    } catch (err) {
      if (isDevEnv) console.error('Error deleting post:', err.message);
      alert(`Error deleting post: ${err.message}`);
    } finally {
      submitButton.textContent = originalText;
      submitButton.disabled = false;
    }
  });
});

  // --- Carousel Navigation for Posts and Media Tabs ---
  function initializeCarousels() {
    document.querySelectorAll('.media-carousel-container').forEach(container => {
      const carousel = container.querySelector('.media-carousel');
      const items = container.querySelectorAll('.carousel-item');
      const prevButton = container.querySelector('.carousel-prev');
      const nextButton = container.querySelector('.carousel-next');
      const dots = container.querySelectorAll('.carousel-dot');
      let currentIndex = 0;

      if (!carousel || items.length === 0) return;

      function updateCarousel() {
        items.forEach((item, index) => {
          item.classList.toggle('active', index === currentIndex);
        });
        if (dots.length > 0) {
          dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === currentIndex);
          });
        }
      }

      if (prevButton) {
        prevButton.addEventListener('click', () => {
          currentIndex = (currentIndex - 1 + items.length) % items.length;
          updateCarousel();
        });
      }

      if (nextButton) {
        nextButton.addEventListener('click', () => {
          currentIndex = (currentIndex + 1) % items.length;
          updateCarousel();
        });
      }

      if (dots.length > 0) {
        dots.forEach((dot, index) => {
          dot.addEventListener('click', () => {
            currentIndex = index;
            updateCarousel();
          });
        });
      }

      updateCarousel();
    });
  }

  // Initialize carousels on page load
  initializeCarousels();

  // --- Sort Modal ---
const sortButton = document.querySelector('.sort-button');
const sortModal = document.querySelector('.sort-modal');
const sortForm = document.querySelector('#sort-form');
const cancelSortButton = document.querySelector('.cancel-sort');

// Show modal when sort button is clicked
if (sortButton) {
  sortButton.addEventListener('click', () => {
    sortModal.classList.remove('hidden');
  });
}

// Hide modal when cancel is clicked
if (cancelSortButton) {
  cancelSortButton.addEventListener('click', () => {
    sortModal.classList.add('hidden');
  });
}

// Handle form submission
if (sortForm) {
  sortForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const sortBy = sortForm.querySelector('input[name="sortBy"]:checked').value;
    const order = sortForm.querySelector('input[name="order"]:checked').value;

    // Update URL with query parameters
    const url = new URL(window.location.href);
    url.searchParams.set('sortBy', sortBy);
    url.searchParams.set('order', order);
    window.location.href = url.toString();
  });
}

// Close modal when clicking outside
if (sortModal) {
  sortModal.addEventListener('click', (e) => {
    if (e.target === sortModal) {
      sortModal.classList.add('hidden');
    }
  });
}

// --- Creator Suggestions ---
const writeUpTextarea = document.getElementById('writeUp');
const suggestionsContainer = document.getElementById('profile-creator-suggestions');

// Position the suggestions pop-up below the current line in the textarea
function positionSuggestions() {
  const computedStyle = getComputedStyle(writeUpTextarea);
  const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
  const lineHeight = parseFloat(computedStyle.lineHeight) || 20;
  const cursorPos = writeUpTextarea.selectionStart;
  const textBefore = writeUpTextarea.value.substring(0, cursorPos);
  const lineNumber = textBefore.split('\n').length - 1;
  const topOffset = paddingTop + (lineNumber + 1) * lineHeight; // Position below the current line

  // Set data attribute for positioning
  suggestionsContainer.dataset.topOffset = topOffset;

  // Apply positioning class
  suggestionsContainer.classList.add('suggestions-positioned');
}

// Fetch creator suggestions from the backend
async function fetchSuggestions(query) {
  try {
    const response = await fetch(`/profile/creator-suggestions?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('Network error');
    return await response.json();
  } catch (error) {
    if (isDevEnv) console.error('Error fetching suggestions:', error);
    return [];
  }
}

// Display suggestions in the pop-up
function displaySuggestions(suggestions) {
  suggestionsContainer.innerHTML = '';
  if (suggestions.length === 0) {
    suggestionsContainer.classList.add('hidden');
    return;
  }

  suggestions.forEach((creator) => {
    const suggestionItem = document.createElement('div');
    suggestionItem.className = 'profile-suggestion-item';
    suggestionItem.innerHTML = `
      <img src="${creator.profilePicture}" alt="${creator.username}" class="profile-suggestion-profile-pic">
      <span class="profile-suggestion-name">${creator.profileName || creator.username}</span>
    `;
    suggestionItem.addEventListener('click', () => {
      // Insert the tagged username into the textarea
      const cursorPos = writeUpTextarea.selectionStart;
      const textBefore = writeUpTextarea.value.substring(0, cursorPos);
      const textAfter = writeUpTextarea.value.substring(cursorPos);
      const lastAt = textBefore.lastIndexOf('@');
      const newText = `${textBefore.substring(0, lastAt)}@${creator.username} ${textAfter}`;
      writeUpTextarea.value = newText;

      // Hide suggestions
      suggestionsContainer.classList.add('hidden');
    });
    suggestionsContainer.appendChild(suggestionItem);
  });

  suggestionsContainer.classList.remove('hidden');
}

// Handle input in the textarea
writeUpTextarea.addEventListener('input', async () => {
  const text = writeUpTextarea.value;
  const cursorPos = writeUpTextarea.selectionStart;
  const textBeforeCursor = text.substring(0, cursorPos);

  // Check if typing a tag (e.g., @username)
  const lastAt = textBeforeCursor.lastIndexOf('@');
  if (lastAt !== -1 && cursorPos > lastAt) {
    const query = textBeforeCursor.substring(lastAt + 1);
    if (query.match(/^[a-zA-Z0-9_]*$/)) { // Only allow valid username characters
      positionSuggestions();
      const suggestions = await fetchSuggestions(query);
      displaySuggestions(suggestions);
    } else {
      suggestionsContainer.classList.add('hidden');
    }
  } else {
    suggestionsContainer.classList.add('hidden');
  }
});

// Hide suggestions when clicking outside
document.addEventListener('click', (e) => {
  if (!writeUpTextarea.contains(e.target) && !suggestionsContainer.contains(e.target)) {
    suggestionsContainer.classList.add('hidden');
  }
});
});