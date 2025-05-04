// Main JS file to prevent downloading/saving of media content

document.addEventListener('DOMContentLoaded', function() {
    // 1. Disable right-click on images and videos
    document.addEventListener('contextmenu', function(e) {
      if (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO') {
        e.preventDefault();
        showProtectionMessage();
        return false;
      }
    }, false);
  
    // 2. Disable video download controls
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      // Remove download attribute if present
      video.removeAttribute('download');
      
      // Add protection layer to videos
      video.addEventListener('loadedmetadata', function() {
        applyVideoProtection(video);
      });
      
      // Override the native context menu for videos
      video.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        showProtectionMessage();
        return false;
      });
    });
  
    // 3. Apply protection to all images
    const images = document.querySelectorAll('.post-image, .fullscreenable');
    images.forEach(img => {
      applyImageProtection(img);
    });
  
    // 4. Monitor and handle drag events to prevent drag-saving
    document.addEventListener('dragstart', function(e) {
      if (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO') {
        e.preventDefault();
        return false;
      }
    }, false);
  
    // 5. Handle keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      // Detect Ctrl+S (Windows/Linux) or Command+S (Mac)
      if ((e.ctrlKey || e.metaKey) && e.keyCode === 83) {
        e.preventDefault();
        showProtectionMessage();
        return false;
      }
    });
  
    // Create a MutationObserver to handle dynamically added content
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.addedNodes.length) {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === 1) { // Element node
              // Apply protection to new media elements
              const newImages = node.querySelectorAll('img');
              newImages.forEach(img => applyImageProtection(img));
              
              const newVideos = node.querySelectorAll('video');
              newVideos.forEach(video => applyVideoProtection(video));
            }
          });
        }
      });
    });
  
    // Start observing the document with the configured parameters
    observer.observe(document.body, { childList: true, subtree: true });
  });
  
  // Function to apply image protection
  function applyImageProtection(img) {
    // Prevent dragging
    img.setAttribute('draggable', 'false');
    
    // Add protection layer
    img.style.webkitUserSelect = 'none';
    img.style.userSelect = 'none';
    img.style.webkitTouchCallout = 'none';
    
    // Option: Add a transparent overlay to make right-clicking specifically on the image harder
    if (!img.parentNode.querySelector('.image-protection-overlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'image-protection-overlay';
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.zIndex = '1';
      
      // Make sure the parent has position relative
      if (getComputedStyle(img.parentNode).position === 'static') {
        img.parentNode.style.position = 'relative';
      }
      
      img.parentNode.appendChild(overlay);
    }
  }
  
  // Function to apply video protection
  function applyVideoProtection(video) {
    // Disable controls that allow downloading
    video.controlsList = 'nodownload';
    
    // Remove download attribute if present
    video.removeAttribute('download');
    
    // Prevent dragging
    video.setAttribute('draggable', 'false');
    
    // Add protection layer
    video.style.webkitUserSelect = 'none';
    video.style.userSelect = 'none';
    video.style.webkitTouchCallout = 'none';
    
    // Handle video controls - hide download button in context menu
    video.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      showProtectionMessage();
      return false;
    }, false);
    
    // Optional: Add a transparent overlay to make right-clicking specifically on the video harder
    if (!video.parentNode.querySelector('.video-protection-overlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'video-protection-overlay';
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.zIndex = '1';
      
      // Make sure the parent has position relative
      if (getComputedStyle(video.parentNode).position === 'static') {
        video.parentNode.style.position = 'relative';
      }
      
      // Ensure the overlay doesn't block video controls
      overlay.addEventListener('click', function(e) {
        // Pass the click through to the video
        video.click();
        
        // Toggle play/pause
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
      });
      
      video.parentNode.appendChild(overlay);
    }
  }
  
  // Show a protection message when users try to save content
  function showProtectionMessage() {
    // Create toast notification if it doesn't exist
    if (!document.getElementById('protection-toast')) {
      const toast = document.createElement('div');
      toast.id = 'protection-toast';
      toast.innerHTML = 'Content saving is disabled';
      toast.style.position = 'fixed';
      toast.style.bottom = '20px';
      toast.style.left = '50%';
      toast.style.transform = 'translateX(-50%)';
      toast.style.backgroundColor = '#ff69b4';
      toast.style.color = 'white';
      toast.style.padding = '10px 20px';
      toast.style.borderRadius = '4px';
      toast.style.zIndex = '9999';
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease-in-out';
      document.body.appendChild(toast);
    }
  
    const toast = document.getElementById('protection-toast');
    toast.style.opacity = '1';
    
    // Hide the toast after 2 seconds
    setTimeout(function() {
      toast.style.opacity = '0';
    }, 2000);
  }
  
  // Apply additional protection for carousel items
  function updateCarouselProtection() {
    // This function can be called after carousel navigation
    const activeItems = document.querySelectorAll('.carousel-item.active');
    activeItems.forEach(item => {
      const images = item.querySelectorAll('img');
      images.forEach(img => applyImageProtection(img));
      
      const videos = item.querySelectorAll('video');
      videos.forEach(video => applyVideoProtection(video));
    });
  }
  
  // Function to handle watermarking (optional enhancement)
  function applyWatermark() {
    const contentContainers = document.querySelectorAll('.post-content');
    contentContainers.forEach(container => {
      // Check if watermark already exists
      if (!container.querySelector('.content-watermark')) {
        const watermark = document.createElement('div');
        watermark.className = 'content-watermark';
        watermark.textContent = '@' + document.querySelector('.profile-username').textContent.trim();
        container.appendChild(watermark);
      }
    });
  }