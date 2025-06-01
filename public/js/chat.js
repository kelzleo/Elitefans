document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  const chatId = document.getElementById('chatId').value;
  const sender = document.getElementById('sender').value;
  let lastDate = '<%= lastDateValue %>';
  let userHasScrolled = false;
  const isDevEnv = '<%= process.env.NODE_ENV %>' === 'development';

  // Verify emoji button presence
  const emojiToggle = document.getElementById('emojiToggle');
  if (emojiToggle) {
    if (isDevEnv) console.log('Emoji toggle button found in DOM');
  } else {
    console.error('Emoji toggle button NOT found in DOM');
  }

  // Function to check if the user has scrolled up
  function checkScrollPosition() {
    const chatWindow = document.getElementById('chatWindow');
    const scrollPosition = chatWindow.scrollTop + chatWindow.clientHeight;
    const scrollHeight = chatWindow.scrollHeight;
    return scrollPosition >= scrollHeight - 10;
  }

  socket.on('connect', () => {
    if (isDevEnv) console.log('Connected to Socket.io server');
    socket.emit('joinRoom', { chatId });

    // Send heartbeat every 15 seconds
    setInterval(() => {
      socket.emit('heartbeat');
    }, 15000);

    // Scroll to the bottom after the DOM is fully loaded
    const chatWindow = document.getElementById('chatWindow');
    chatWindow.scrollTop = chatWindow.scrollHeight;

    // Add scroll event listener to detect if the user has scrolled up
    chatWindow.addEventListener('scroll', () => {
      userHasScrolled = !checkScrollPosition();
    });
  });

  socket.on('connect_error', (error) => {
    console.error('Socket.io connection error:', error);
    alert('Failed to connect to the chat server. Please try refreshing the page.');
  });

  // Fetch signed URLs for existing messages on page load and add fullscreen attributes
  document.querySelectorAll('.chat-media').forEach(async (element) => {
    const rawUrl = element.getAttribute('data-url');
    const filename = rawUrl.split('/').pop();
    try {
      const response = await fetch(`/chat/media/${chatId}/${encodeURIComponent(filename)}`);
      if (!response.ok) throw new Error(`Failed to fetch signed URL: ${response.status} ${response.statusText}`);
      const data = await response.json();
      element.src = data.url;
      element.setAttribute('data-fullscreen-url', data.url);
      element.classList.add('fullscreenable');
      element.onerror = () => {
        console.error('Image failed to load:', data.url);
        element.src = '/images/fallback-image.png';
        element.alt = 'Failed to load media';
      };
    } catch (err) {
      console.error('Error fetching signed URL for existing message:', err.message);
      element.src = '/images/fallback-image.png';
      element.alt = 'Failed to load media';
    }
  });

  // Initialize Emoji Picker
  async function initializeEmojiPicker() {
    try {
      const { default: EmojiMart } = await import('https://cdn.jsdelivr.net/npm/@emoji-mart/core@1.2.1/+esm');
      const data = await fetch('https://cdn.jsdelivr.net/npm/@emoji-mart/data@1.2.1/+esm').then(res => {
        if (!res.ok) throw new Error(`Failed to fetch emoji data: ${res.status}`);
        return res.json();
      });
      if (isDevEnv) console.log('EmojiMart v1.2.1 loaded successfully');

      const picker = new EmojiMart.Picker({
        data,
        onEmojiSelect: (emoji) => {
          const messageInput = document.getElementById('messageInput');
          if (messageInput) {
            messageInput.value += emoji.native;
            messageInput.focus();
            if (isDevEnv) console.log('Emoji selected:', emoji.native);
          } else {
            console.error('messageInput not found');
          }
        },
      });

      const emojiPickerContainer = document.getElementById('emojiPicker');
      if (emojiPickerContainer) {
        emojiPickerContainer.innerHTML = ''; // Clear to prevent duplicates
        emojiPickerContainer.appendChild(picker);
        if (isDevEnv) console.log('Emoji picker appended to #emojiPicker');
      } else {
        throw new Error('emojiPicker container not found');
      }
    } catch (err) {
      console.error('Failed to initialize EmojiMart:', err);
      if (emojiToggle) {
        emojiToggle.classList.add('disabled');
        emojiToggle.disabled = true;
        emojiToggle.title = 'Emoji picker unavailable';
        if (isDevEnv) console.log('Emoji button disabled due to initialization failure');
      }
    }
  }

  // Initialize emoji picker
  initializeEmojiPicker();

  // Toggle Emoji Picker
  if (emojiToggle) {
    emojiToggle.addEventListener('click', (e) => {
      if (isDevEnv) console.log('Emoji toggle clicked');
      const picker = document.getElementById('emojiPicker');
      if (picker) {
        picker.classList.toggle('active');
        picker.classList.toggle('hidden');
        if (isDevEnv) console.log('Emoji picker toggled to:', picker.classList.contains('active') ? 'active' : 'hidden');
      } else {
        console.error('emojiPicker element not found during toggle');
      }
    });
    if (isDevEnv) console.log('Emoji toggle listener attached');
  } else {
    console.error('emojiToggle element not found');
  }

  // Show preview of selected media
  document.getElementById('mediaInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    const previewContainer = document.getElementById('mediaPreview');
    previewContainer.innerHTML = '';
    if (file) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = document.createElement('img');
          img.src = e.target.result;
          img.className = 'media-preview-img';
          previewContainer.appendChild(img);
        };
        reader.readAsDataURL(file);
      } else if (file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.className = 'media-preview-video';
        video.muted = true;
        video.autoplay = true;
        video.loop = true;
        previewContainer.appendChild(video);
      }
    }
  });

  // Initialize Tip Modal
  function initializeTipModal() {
    const tipButton = document.querySelector('.tip-chat-button');
    const tipModal = document.getElementById('tipModal');
    const closeTipModal = document.getElementById('closeTipModal');
    const tipForm = document.getElementById('tipForm');

    if (!tipButton || !tipModal || !closeTipModal || !tipForm) {
      if (isDevEnv) console.log('Tip modal elements not found, retrying...');
      setTimeout(initializeTipModal, 500);
      return;
    }

    tipButton.addEventListener('click', () => {
      tipModal.classList.add('active');
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

    tipForm.addEventListener('submit', async (e) => {
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
        if (typeof fetchWithCsrf !== 'function') {
          throw new Error('fetchWithCsrf is not defined');
        }
        const response = await fetchWithCsrf(`/profile/tip-creator/<%= creator._id %>`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipAmount, tipMessage })
        });
        const result = await response.json();
        if (response.ok && result.status === 'success' && result.data.paymentLink) {
          submitButton.textContent = 'Redirecting...';
          window.location.href = result.data.paymentLink;
        } else {
          alert(result.message || `Failed to initialize tip payment (Status: ${response.status})`);
          submitButton.textContent = originalText;
          submitButton.disabled = false;
        }
      } catch (err) {
        if (isDevEnv) console.error('Chat Tip Error:', err);
        alert('Error processing tip.');
        submitButton.textContent = originalText;
        submitButton.disabled = false;
      } finally {
        tipModal.classList.remove('active');
        tipForm.reset();
      }
    });
  }

  initializeTipModal();

  // Function to append a message to the chat window
  async function appendMessage(message, isSender = false) {
    const chatWindow = document.getElementById('chatWindow');
    if (!chatWindow) {
      console.error('chatWindow element not found');
      return;
    }

    if (isDevEnv) console.log('Appending message:', message, 'isSender:', isSender);

    // Check if we need a date divider
    const messageDate = new Date(message.timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    if (lastDate !== messageDate) {
      const dateDivider = document.createElement('div');
      dateDivider.className = 'date-divider';
      dateDivider.textContent = messageDate;
      chatWindow.appendChild(dateDivider);
      lastDate = messageDate;
      if (isDevEnv) console.log('Added date divider:', messageDate);
    }

    // Remove "No messages yet" message if present
    const noMessages = chatWindow.querySelector('p');
    if (noMessages && noMessages.textContent === 'No messages yet. Start the conversation!') {
      noMessages.remove();
      if (isDevEnv) console.log('Removed "No messages yet" placeholder');
    }

    // Create the message container
    const container = document.createElement('div');
    container.className = 'message-container ' + (message.sender === sender ? 'sent' : 'received');

    // Add profile picture for both sent and received messages
    const img = document.createElement('img');
    img.src = message.sender === sender ?
      '<%= currentUser.profilePicture || "/images/default-profile.png" %>' :
      '<%= creator && creator.profilePicture ? creator.profilePicture : "/images/default-profile.png" %>';
    img.alt = 'Profile Picture';
    img.className = 'message-profile-pic';
    container.appendChild(img);

    // Create a wrapper for the message and info
    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'message-wrapper';

    const bubble = document.createElement('div');
    bubble.className = 'message';
    let messageContent = '';
    if (message.media && message.media.type) {
      let mediaUrl = '';
      const filename = message.media.url.split('/').pop();
      try {
        const response = await fetch(`/chat/media/${chatId}/${encodeURIComponent(filename)}`);
        if (!response.ok) throw new Error(`Failed to fetch signed URL: ${response.status} ${response.statusText}`);
        const data = await response.json();
        mediaUrl = data.url;
      } catch (err) {
        console.error('Error fetching signed URL for new message:', err.message);
        try {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const retryResponse = await fetch(`/chat/media/${chatId}/${encodeURIComponent(filename)}`);
          if (!retryResponse.ok) throw new Error(`Retry failed: ${retryResponse.status} ${response.statusText}`);
          const retryData = await retryResponse.json();
          mediaUrl = retryData.url;
        } catch (retryErr) {
          console.error('Retry failed for signed URL:', retryErr.message);
          mediaUrl = '/images/fallback-image.png';
        }
      }
      if (message.media.type === 'image') {
        messageContent += `<img src="${mediaUrl}" alt="Chat Image" class="chat-media fullscreenable" data-fullscreen-url="${mediaUrl}" onerror="this.src='/images/fallback-image.png'; this.alt='Failed to load media';">`;
      } else if (message.media.type === 'video') {
        messageContent += `<video src="${mediaUrl}" class="chat-media fullscreenable" data-fullscreen-url="${mediaUrl}" onerror="this.nextSibling.classList.remove('hidden');"><p class="video-fallback hidden">Failed to load video</p></video>`;
      }
    }
    if (message.text) {
      messageContent += `<span class="text">${message.text}</span>`;
    }
    if (message.isTip) {
      messageContent += `
        <span class="tip-info">
          <i class="fa fa-gift" title="Sent with a tip"></i>
          <span class="tip-amount">₦${message.tipAmount}</span>
        </span>`;
    }
    bubble.innerHTML = messageContent;

    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `<span class="time">${new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}</span>`;
    if (message.sender === sender) {
      info.innerHTML += `<span class="status">${message.readBy && message.readBy.length > 0 ? 'Read' : 'Sent'}</span>`;
    }

    messageWrapper.appendChild(bubble);
    messageWrapper.appendChild(info);
    container.appendChild(messageWrapper);
    chatWindow.appendChild(container);

    // Only auto-scroll to bottom if the user is already at the bottom or hasn't scrolled up
    if (!userHasScrolled) {
      chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    if (isDevEnv) console.log('Message appended to DOM:', message);

    // Force a DOM repaint to ensure visibility
    chatWindow.classList.add('hidden');
    chatWindow.offsetHeight; // Trigger reflow
    chatWindow.classList.remove('hidden');
    chatWindow.classList.add('active');
  }

  // Handle form submission
  document.getElementById('messageForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const messageInput = document.getElementById('messageInput');
    const mediaInput = document.getElementById('mediaInput');
    const text = messageInput.value.trim();
    const file = mediaInput.files[0];

    if (!text && !file) return;

    const message = {
      chatId,
      sender,
      text: text || null,
      media: null,
      timestamp: new Date(),
      isTip: false,
      tipAmount: null,
      read: false,
    };

    if (file) {
      const formData = new FormData();
      formData.append('media', file);

      try {
        if (typeof fetchWithCsrf !== 'function') {
          throw new Error('fetchWithCsrf is not defined');
        }
        const response = await fetchWithCsrf('/chat/upload-media', {
          method: 'POST',
          body: formData,
        });
        const result = await response.json();
        if (result.success) {
          message.media = {
            type: file.type.startsWith('image/') ? 'image' : 'video',
            url: result.url,
          };
          if (isDevEnv) console.log('Media uploaded successfully:', result.url);
        } else {
          alert('Failed to upload media: ' + result.message);
          return;
        }
      } catch (err) {
        if (isDevEnv) console.error('Media upload error:', err);
        alert('Error uploading media.');
        return;
      }
    }

    if (isDevEnv) console.log('Sending message:', message);
    appendMessage(message, true); // Append immediately for sender
    socket.emit('sendMessage', message);
    messageInput.value = '';
    mediaInput.value = '';
    document.getElementById('mediaPreview').innerHTML = '';
  });

  socket.on('newMessage', function(message) {
    if (isDevEnv) console.log('Received new message from server:', message);
    if (message.sender !== sender) {
      appendMessage(message); // Only append if not the sender
    } else {
      if (isDevEnv) console.log('Skipping append for sender’s own message');
    }
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
    progressBar.style.width = `${percentage}%`; // Note: This is inline but necessary for dynamic progress
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
      const src = el.dataset.fullscreenUrl || el.src || el.currentSrc;
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
});