document.addEventListener('DOMContentLoaded', function() {
  console.log("Profile page script loaded.");

  // Unlock special content functionality
  document.querySelectorAll('.unlock-button').forEach(button => {
    button.addEventListener('click', async function() {
      const contentId = this.dataset.contentId;
      const creatorId = this.dataset.creatorId;
      const originalText = this.textContent;
      this.textContent = 'Processing...';
      this.disabled = true;
      try {
        const response = await fetch('/profile/unlock-special-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentId, creatorId })
        });
        const result = await response.json();
        console.log('Unlock Payment Response:', result);
        if (response.ok && result.status === 'success' && result.data.paymentLink) {
          window.location.href = result.data.paymentLink;
        } else {
          alert(result.message || 'Failed to initialize payment');
          this.textContent = originalText;
          this.disabled = false;
        }
      } catch (error) {
        console.error('Error:', error);
        alert('An error occurred while processing your request');
        this.textContent = originalText;
        this.disabled = false;
      }
    });
  });

  // Like button functionality
  document.querySelectorAll('.like-button').forEach(button => {
    button.addEventListener('click', async function () {
      const postId = this.dataset.postId;
      try {
        const res = await fetch('/profile/posts/' + postId + '/like', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          this.querySelector('.like-count').textContent = data.likes;
        } else {
          alert(data.message);
        }
      } catch (error) {
        console.error('Error:', error);
        alert('An error occurred while liking the post.');
      }
    });
  });

  // Toggle comment form visibility
  document.querySelectorAll('.comment-icon').forEach(button => {
    button.addEventListener('click', function() {
      const postId = this.dataset.postId;
      console.log("Comment icon clicked for post:", postId);
      const postCard = this.closest('.post-card');
      if (!postCard) {
        console.error("Could not find closest .post-card for post:", postId);
        return;
      }
      const commentContainer = postCard.querySelector('.comment-form-container');
      if (!commentContainer) {
        console.error("No comment-form-container found in post-card for post:", postId);
        return;
      }
      commentContainer.style.display = commentContainer.style.display === 'block' ? 'none' : 'block';
      if (commentContainer.style.display === 'block') {
        const input = commentContainer.querySelector('input[name="comment"]');
        if (input) input.focus();
      }
    });
  });

  // Comment form submission
  document.querySelectorAll('.comment-form').forEach(form => {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const postId = this.dataset.postId;
      const commentText = this.comment.value.trim();
      if (!commentText) return;
      try {
        const res = await fetch('/profile/posts/' + postId + '/comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: commentText })
        });
        if (res.ok) {
          location.reload();
        } else {
          const data = await res.json();
          alert(data.message);
        }
      } catch (error) {
        console.error('Error:', error);
        alert('An error occurred while submitting your comment.');
      }
    });
  });

  // Subscription button functionality using AJAX
  const subscriptionForms = document.querySelectorAll('form[action="/profile/subscribe"]');
  subscriptionForms.forEach(form => {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const submitButton = form.querySelector('button[type="submit"]');
      const originalText = submitButton.textContent;
      submitButton.textContent = 'Processing...';
      submitButton.disabled = true;
      try {
        const formData = new FormData(form);
        const data = {
          creatorId: formData.get('creatorId'),
          bundleId: formData.get('bundleId')
        };
        const response = await fetch('/profile/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await response.json();
        if (response.ok && result.status === 'success' && result.data.paymentLink) {
          submitButton.textContent = 'Redirecting...';
          window.location.href = result.data.paymentLink;
        } else {
          submitButton.textContent = originalText;
          submitButton.disabled = false;
          alert(result.message || 'Failed to initialize payment');
        }
      } catch (error) {
        console.error('Error:', error);
        submitButton.textContent = originalText;
        submitButton.disabled = false;
        alert('An error occurred while processing your subscription');
      }
    });
  });

  // Tip button functionality
  document.querySelectorAll('.tip-button').forEach(button => {
    button.addEventListener('click', async function() {
      const tipAmount = prompt("Enter tip amount in NGN:");
      if (!tipAmount) return;
      const postId = this.dataset.postId;
      const creatorId = this.dataset.creatorId;
      const originalText = this.textContent;
      this.textContent = 'Processing...';
      this.disabled = true;
      try {
        const response = await fetch('/profile/posts/' + postId + '/tip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipAmount })
        });
        const result = await response.json();
        console.log('Tip Payment Response:', result);
        if (response.ok && result.status === 'success' && result.data.paymentLink) {
          window.location.href = result.data.paymentLink;
        } else {
          alert(result.message || 'Failed to initialize tip payment');
          this.textContent = originalText;
          this.disabled = false;
        }
      } catch (error) {
        console.error('Error:', error);
        alert('An error occurred while processing your tip');
        this.textContent = originalText;
        this.disabled = false;
      }
    });
  });
});