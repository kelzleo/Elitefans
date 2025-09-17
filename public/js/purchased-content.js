document.addEventListener('DOMContentLoaded', function() {
  const isDevEnv = '<%= process.env.NODE_ENV %>' === 'development';
 // --- FingerprintJS Initialization () ---
  let fingerprint = null;
  let fingerprintPromise = null;

  const getFingerprint = async () => {
    if (fingerprint) return fingerprint; // Return cached fingerprint
    if (fingerprintPromise) return await fingerprintPromise; // Wait for ongoing initialization

    fingerprintPromise = (async () => {
      if (typeof FingerprintJS === 'undefined') {
        if (isDevEnv) console.error('FingerprintJS is not loaded. Ensure script is included in home.ejs.');
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

  
// --- Lazy-Loading + Signed URL Batching ---
const batchSize = 3;
let pendingPosts = new Set();
let isProcessing = false;
let lastBatchTime = 0;
const batchThrottle = 1000; // 1s throttle to reduce overlap

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Extend session activity
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

async function processBatch() {
  const now = Date.now();
  if (isProcessing || pendingPosts.size === 0 || now - lastBatchTime < batchThrottle) return;
  console.log(`Starting batch, pendingPosts size: ${pendingPosts.size}`);
  isProcessing = true;
  lastBatchTime = now;

  try {
    const batch = Array.from(pendingPosts).slice(0, batchSize);
    const postData = batch
      .map((post) => {
        const mediaEls = post.querySelectorAll('.lazy-media');
        if (!mediaEls.length) {
          console.log(`No media for post ${post.dataset.postId}`);
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

    const sessions = await fetchWithCsrf('/api/generate-signed-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postData),
    }).then((res) => {
      if (!res.ok) {
        throw new Error(`Fetch failed: ${res.status}`);
      }
      return res.json();
    }).then((data) => data.sessions || {});

    batch.forEach((post) => {
      const postId = post.dataset.postId;
      const postSessions = sessions[postId] || [];
      if (!postSessions.length) {
        console.warn(`No sessions returned for post ${postId}`);
        post.querySelectorAll('.lazy-media').forEach((el) => {
          if (el.tagName === 'IMG') {
            el.src = '/images/error.png';
          } else if (el.tagName === 'VIDEO') {
            el.poster = '/images/error.png';
            const wrapper = el.closest('.video-wrapper');
            const posterImg = wrapper ? wrapper.querySelector('.video-poster-img') : null;
            if (posterImg) posterImg.src = '/images/error.png';
          }
          el.classList.remove('lazy-media');
        });
        pendingPosts.delete(post);
        return;
      }

      post.querySelectorAll('.lazy-media').forEach((el) => {
        const session = postSessions.find((s) => s.elementId === el.id);
        if (!session) {
          console.warn(`No session for element ${el.id} in post ${postId}`);
          if (el.tagName === 'IMG') {
            el.src = '/images/error.png';
          } else if (el.tagName === 'VIDEO') {
            el.poster = '/images/error.png';
            const wrapper = el.closest('.video-wrapper');
            const posterImg = wrapper ? wrapper.querySelector('.video-poster-img') : null;
            if (posterImg) posterImg.src = '/images/error.png';
          }
          el.classList.remove('lazy-media');
          return;
        }

        console.log(`Updating ${el.tagName} ${el.id} with URL: ${session.url}`);
        el.dataset.retryCount = el.dataset.retryCount || '0';

        if (el.tagName === 'IMG') {
          el.src = `${session.url}?t=${Date.now()}`;
          el.dataset.fullscreenSrc = session.url;
          el.addEventListener(
            'error',
            () => {
              if (parseInt(el.dataset.retryCount, 10) < 3) {
                console.warn(`Image error for ${el.id}, retry ${el.dataset.retryCount}`);
                el.dataset.retryCount = (parseInt(el.dataset.retryCount, 10) + 1).toString();
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
          // iOS-friendly poster-first approach + optional overlay image
          if (session.posterUrl && session.posterUrl.trim()) {
            try {
              el.poster = `${session.posterUrl}?t=${Date.now()}`;
            } catch (err) {
              console.warn('Failed to set video.poster:', err);
            }
          } else if (el.dataset.fallbackPoster) {
            el.poster = el.dataset.fallbackPoster;
          }

          const wrapper = el.closest('.video-wrapper');
          const posterImg = wrapper ? wrapper.querySelector('.video-poster-img') : null;
          if (posterImg && session.posterUrl) {
            posterImg.src = `${session.posterUrl}?t=${Date.now()}`;
            posterImg.style.display = ''; // Ensure visible until play
          }

          // Set source AFTER poster is set
          const source = el.querySelector('source') || document.createElement('source');
          source.src = `${session.url}?t=${Date.now()}`;
          source.type = el.querySelector('source')?.type || 'video/mp4';
          if (!el.querySelector('source')) el.appendChild(source);

          // Let browser paint poster, then load
          requestAnimationFrame(() => {
            try {
              el.load();
            } catch (err) {
              console.warn('Video load() threw an error:', err);
            }
          });

          el.dataset.fullscreenSrc = session.url;

          el.addEventListener(
            'error',
            () => {
              if (parseInt(el.dataset.retryCount, 10) < 3) {
                console.warn(`Video error for ${el.id}, retry ${el.dataset.retryCount}`);
                el.dataset.retryCount = (parseInt(el.dataset.retryCount, 10) + 1).toString();
                pendingPosts.add(post);
              } else {
                el.poster = '/images/error.png';
                if (posterImg) posterImg.src = '/images/error.png';
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

          if (posterImg) {
            el.addEventListener(
              'play',
              () => {
                posterImg.style.display = 'none';
              },
              { once: true }
            );
          }
        }

        if (session.sessionId) {
          extendSessionActivity(session.sessionId);
        }
      });

      pendingPosts.delete(post);
    });
  } catch (error) {
    console.error('Batch processing error:', error);
    batch.forEach((post) => {
      if (parseInt(post.dataset.batchRetryCount || '0', 10) < 3) {
        post.dataset.batchRetryCount = (parseInt(post.dataset.batchRetryCount, 10) + 1).toString();
      } else {
        post.querySelectorAll('.lazy-media').forEach((el) => {
          if (el.tagName === 'IMG') {
            el.src = '/images/error.png';
          } else if (el.tagName === 'VIDEO') {
            el.poster = '/images/error.png';
            const wrapper = el.closest('.video-wrapper');
            const posterImg = wrapper ? wrapper.querySelector('.video-poster-img') : null;
            if (posterImg) posterImg.src = '/images/error.png';
          }
          el.classList.remove('lazy-media');
        });
        pendingPosts.delete(post);
      }
    });
  } finally {
    isProcessing = false;
    console.log(`Batch done, remaining: ${pendingPosts.size}`);
    if (pendingPosts.size > 0) setTimeout(processBatch, batchThrottle);
  }
}

// IntersectionObserver for lazy-loading
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      console.log(`Post ${entry.target.dataset.postId} intersecting: ${entry.isIntersecting}`);
      if (entry.isIntersecting && !entry.target.dataset.processed) {
        pendingPosts.add(entry.target);
        entry.target.dataset.processed = 'true';
        observer.unobserve(entry.target);
        processBatch();
      }
    });
  },
  {
    root: null,
    rootMargin: '0px 0px -100px 0px',
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
 // --- Like Button (Updated) ---
document.querySelectorAll('.like-button').forEach(button => {
  button.addEventListener('click', async function() {
    const postId = this.dataset.postId;
    const likeIcon = this.querySelector('i');
    const likeCountSpan = this.querySelector('.like-count');
    try {
      if (typeof fetchWithCsrf !== 'function') {
        throw new Error('fetchWithCsrf is not defined');
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
        alert(data.message || 'Could not like post.');
      }
    } catch (error) {
      if (isDevEnv) console.error('Error liking post:', error.message);
      alert(`Error liking post: ${error.message}`);
    }
  });
});

  // --- Comment Icon ---
  document.querySelectorAll('.comment-icon').forEach(button => {
    button.addEventListener('click', function() {
      const parentElement = this.closest('.post-card');
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

 // --- Comment Form Submit (Updated) ---
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
      if (typeof fetchWithCsrf !== 'function') {
        throw new Error('fetchWithCsrf is not defined');
      }
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
        const parentElement = this.closest('.post-card');
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
        if (commentCountSpan && data.commentCount !== undefined) commentCountSpan.textContent = data.commentCount;
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


   // --- Tip Button ---
  document.querySelectorAll('.tip-button').forEach(button => {
    button.addEventListener('click', async function() {
      const postId = this.dataset.postId;
      const creatorId = this.dataset.creatorId;
      let tipAmountNum = NaN;
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
        if (typeof fetchWithCsrf !== 'function') {
          throw new Error('fetchWithCsrf is not defined');
        }
        const fingerprintId = await getFingerprint();
        const response = await fetchWithCsrf(`/profile/posts/${postId}/tip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tipAmount: tipAmountNum,
            creatorId,
            fingerprint: fingerprintId
          })
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
 // --- Bookmark Button (Updated) ---
document.querySelectorAll('.bookmark-button').forEach(button => {
  button.addEventListener('click', async function() {
    const postId = this.dataset.postId;
    const bookmarkIcon = this.querySelector('i');
    try {
      if (typeof fetchWithCsrf !== 'function') {
        throw new Error('fetchWithCsrf is not defined');
      }
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

 // --- Post Action Modal (Updated Report Form Section) ---
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

postMenuButtons.forEach(button => {
  button.addEventListener('click', (e) => {
    e.preventDefault();
    const postId = button.dataset.postId;
    const username = button.dataset.username;
    sharePostButton.dataset.postId = postId;
    sharePostButton.dataset.username = username;
    reportPostButton.dataset.postId = postId;
    postActionModal.classList.remove('hidden');
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

sharePostButton.addEventListener('click', function() {
  const postId = this.dataset.postId;
  const username = this.dataset.username;
  const shareLink = `${window.location.origin}/profile/${encodeURIComponent(username)}/post/${postId}`;
  copyPostLinkButton.dataset.link = shareLink;
  sharePostTwitter.href = `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareLink)}&text=Check out this post!`;
  sharePostWhatsApp.href = `https://api.whatsapp.com/send?text=Check out this post: ${encodeURIComponent(shareLink)}`;
  sharePostTelegram.href = `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=Check out this post!`;
  sharePostFacebook.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareLink)}`;
  sharePostNativeButton.dataset.link = shareLink;
  postActionModal.classList.add('hidden');
  postShareModal.classList.remove('hidden');
});

closePostShareModal.addEventListener('click', () => {
  postShareModal.classList.add('hidden');
});

postShareModal.addEventListener('click', (e) => {
  if (e.target === postShareModal) {
    postShareModal.classList.add('hidden');
  }
});

copyPostLinkButton.addEventListener('click', function() {
  const link = this.dataset.link;
  navigator.clipboard.writeText(link).then(() => {
    alert('Link copied to clipboard!');
  }).catch(err => {
    if (isDevEnv) console.error('Error copying link:', err);
    alert('Failed to copy link.');
  });
});

sharePostNativeButton.addEventListener('click', async function() {
  const shareData = {
    title: 'Check out this post!',
    url: this.dataset.link
  };
  try {
    await navigator.share(shareData);
  } catch (err) {
    if (isDevEnv) console.error('Error sharing:', err);
  }
});

reportPostButton.addEventListener('click', function() {
  const postId = this.dataset.postId;
  reportForm.dataset.postId = postId;
  postActionModal.classList.add('hidden');
  reportPostModal.classList.remove('hidden');
});

closeReportPostModal.addEventListener('click', () => {
  reportPostModal.classList.add('hidden');
});

reportPostModal.addEventListener('click', (e) => {
  if (e.target === reportPostModal) {
    reportPostModal.classList.add('hidden');
  }
});

reportForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  const postId = this.dataset.postId;
  const reason = document.getElementById('reportReason').value;
  const details = document.getElementById('reportDetails').value;
  const submitButton = this.querySelector('.report-submit-button');
  const originalText = submitButton.textContent;
  submitButton.textContent = 'Submitting...';
  submitButton.disabled = true;
  try {
    if (typeof fetchWithCsrf !== 'function') {
      throw new Error('fetchWithCsrf is not defined');
    }
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
      this.reset();
    } else {
      if (isDevEnv && response.status === 429) {
        console.log('Rate limit exceeded for report:', result.message);
      }
      alert(result.message || 'Failed to submit report.');
    }
  } catch (error) {
    if (isDevEnv) console.error('Error submitting report:', error.message);
    alert(`Error submitting report: ${error.message}`);
  } finally {
    submitButton.textContent = originalText;
    submitButton.disabled = false;
  }
});

  // --- Carousel Navigation ---
  document.querySelectorAll('.media-carousel-container').forEach(container => {
    const postId = container.querySelector('.media-carousel').id.replace('carousel-', '');
    const items = container.querySelectorAll('.carousel-item');
    const prevButton = container.querySelector('.carousel-prev');
    const nextButton = container.querySelector('.carousel-next');
    const dots = container.querySelectorAll('.carousel-dot');
    let currentIndex = 0;

    function updateCarousel() {
      items.forEach((item, index) => {
        item.classList.toggle('active', index === currentIndex);
      });
      dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === currentIndex);
      });
      if (prevButton && nextButton) {
        prevButton.disabled = currentIndex === 0;
        nextButton.disabled = currentIndex === items.length - 1;
      }
    }

    if (prevButton) {
      prevButton.addEventListener('click', () => {
        if (currentIndex > 0) {
          currentIndex--;
          updateCarousel();
        }
      });
    }

    if (nextButton) {
      nextButton.addEventListener('click', () => {
        if (currentIndex < items.length - 1) {
          currentIndex++;
          updateCarousel();
        }
      });
    }

    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        currentIndex = parseInt(dot.dataset.index);
        updateCarousel();
      });
    });

    updateCarousel();
  });

  // --- Debug FetchWithCsrf Availability ---
  if (isDevEnv && typeof fetchWithCsrf !== 'function') {
    console.error('fetchWithCsrf is not defined. Ensure utils.js is loaded before purchased-content.js');
  }
});