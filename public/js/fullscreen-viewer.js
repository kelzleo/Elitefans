// Custom Fullscreen Viewer to replace browser's native fullscreen options

document.addEventListener('DOMContentLoaded', function() {
    // Find all fullscreenable images
    const fullscreenableImages = document.querySelectorAll('.fullscreenable');
  
    // Add click event to each image
    fullscreenableImages.forEach(img => {
      img.addEventListener('click', function() {
        openFullscreenView(this.getAttribute('data-fullscreen-src') || this.src);
      });
    });
  
    // Handle custom fullscreen for videos
    const videos = document.querySelectorAll('.post-video');
    videos.forEach(video => {
      // Replace native fullscreen with custom implementation
      video.addEventListener('webkitfullscreenchange', preventFullscreen);
      video.addEventListener('mozfullscreenchange', preventFullscreen);
      video.addEventListener('fullscreenchange', preventFullscreen);
      
      // Override double-click which often triggers fullscreen
      video.addEventListener('dblclick', function(e) {
        e.preventDefault();
        return false;
      });
    });
  
    // Create a MutationObserver to handle dynamically added content
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.addedNodes.length) {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === 1) { // Element node
              // Apply fullscreen listeners to new images
              const newImages = node.querySelectorAll('.fullscreenable');
              newImages.forEach(img => {
                img.addEventListener('click', function() {
                  openFullscreenView(this.getAttribute('data-fullscreen-src') || this.src);
                });
              });
              
              // Apply fullscreen prevention to new videos
              const newVideos = node.querySelectorAll('.post-video');
              newVideos.forEach(video => {
                video.addEventListener('webkitfullscreenchange', preventFullscreen);
                video.addEventListener('mozfullscreenchange', preventFullscreen);
                video.addEventListener('fullscreenchange', preventFullscreen);
                
                video.addEventListener('dblclick', function(e) {
                  e.preventDefault();
                  return false;
                });
              });
            }
          });
        }
      });
    });
  
    // Start observing the document with the configured parameters
    observer.observe(document.body, { childList: true, subtree: true });
  });
  
  // Function to prevent native fullscreen
  function preventFullscreen(e) {
    if (document.fullscreenElement || 
        document.webkitFullscreenElement || 
        document.mozFullScreenElement || 
        document.msFullscreenElement) {
      
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
      
      // If it's a video, show our custom fullscreen instead
      if (e.target.tagName === 'VIDEO') {
        // Get a frame from the video as an image
        const video = e.target;
        
        // Create a canvas to capture the current frame
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to data URL and open in our secure viewer
        try {
          const dataUrl = canvas.toDataURL('image/jpeg');
          openFullscreenView(dataUrl);
        } catch(error) {
          console.error('Could not create image from video frame:', error);
        }
      }
    }
  }
  
  // Function to open our custom fullscreen view
  function openFullscreenView(src) {
    // Create fullscreen container
    const fullscreenView = document.createElement('div');
    fullscreenView.className = 'fullscreen-view';
    
    // Create image element
    const img = document.createElement('img');
    img.src = src;
    img.style = '-webkit-user-select: none; user-select: none;';
    
    // Prevent right-click
    img.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      return false;
    });
    
    // Prevent drag
    img.setAttribute('draggable', 'false');
    
    // Create close button
    const closeBtn = document.createElement('div');
    closeBtn.className = 'fullscreen-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function() {
      document.body.removeChild(fullscreenView);
    });
    
    // Add watermark to the fullscreen view
    const watermark = document.createElement('div');
    watermark.className = 'content-watermark';
    
    // Try to get username from the page
    let username = '';
    try {
      const usernameElement = document.querySelector('.profile-username');
      if (usernameElement) {
        username = usernameElement.textContent.trim();
      }
    } catch (e) {
      console.error('Could not get username:', e);
      username = 'Protected Content';
    }
    
    watermark.textContent = username;
    watermark.style.fontSize = '24px'; // Make it larger for fullscreen view
    
    // Append all elements
    fullscreenView.appendChild(img);
    fullscreenView.appendChild(closeBtn);
    fullscreenView.appendChild(watermark);
    
    // Add to body
    document.body.appendChild(fullscreenView);
    
    // Add close on click outside image
    fullscreenView.addEventListener('click', function(e) {
      if (e.target === fullscreenView) {
        document.body.removeChild(fullscreenView);
      }
    });
    
    // Add close on escape key
    document.addEventListener('keydown', function closeOnEsc(e) {
      if (e.key === 'Escape') {
        if (document.body.contains(fullscreenView)) {
          document.body.removeChild(fullscreenView);
        }
        document.removeEventListener('keydown', closeOnEsc);
      }
    });
  }