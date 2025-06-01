// js/request-creator.js
const openCameraModalButton = document.getElementById('openCameraModal');
const capturedPhotoPreview = document.getElementById('capturedPhotoPreview');
const capturedPhoto = document.getElementById('capturedPhoto');
const passportPhotoDataInput = document.getElementById('passportPhotoData');
const estimatedAgeInput = document.getElementById('estimatedAge');
const retakeButton = document.getElementById('retakeButton');
const cameraModal = document.getElementById('cameraModal');
const modalVideo = document.getElementById('modalVideo');
const captureButtonModal = document.getElementById('captureButtonModal');
const closeCameraModal = document.getElementById('closeCameraModal');
const form = document.getElementById('creatorRequestForm');
const bvnInput = document.getElementById('bvn');
const bvnError = document.getElementById('bvnError');
const submitButton = document.getElementById('submitButton');
const loadingMessage = document.getElementById('loadingMessage');
const photoMessage = document.getElementById('photoMessage');

let stream;

function openCameraModalFunc() {
  cameraModal.classList.add('rc-modal-open');
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(function(mediaStream) {
        stream = mediaStream;
        modalVideo.srcObject = stream;
        modalVideo.play();
      })
      .catch(function(err) {
        alert("Unable to access the camera. Please check your browser settings.");
        console.error('Camera access error:', err);
      });
  } else {
    alert("Your browser does not support webcam access.");
    console.warn('Browser does not support getUserMedia');
  }
}

function closeCameraModalFunc() {
  cameraModal.classList.remove('rc-modal-open');
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
}

async function estimateAge(photoData) {
  loadingMessage.classList.remove('rc-hidden');
  photoMessage.classList.remove('rc-hidden');
  photoMessage.textContent = 'Processing photo...';
  photoMessage.classList.remove('rc-photo-message-error');

  try {
    console.log('Sending photo data to /request-creator/estimate-age');
    const response = await fetchWithCsrf('/request-creator/estimate-age', {
      method: 'POST',
      body: JSON.stringify({ photoData })
    });
    const result = await response.json();
    if (result.success) {
      estimatedAgeInput.value = result.age;
      photoMessage.textContent = 'Photo captured successfully.';
      submitButton.classList.add('rc-submit-button-enabled');
      submitButton.disabled = false;
    } else {
      estimatedAgeInput.value = '';
      photoMessage.classList.add('rc-photo-message-error');
      photoMessage.textContent = result.message || 'Failed to process photo. Please try again with a clear face.';
      submitButton.classList.remove('rc-submit-button-enabled');
      submitButton.disabled = true;
    }
  } catch (err) {
    console.error('Client-side error in estimateAge:', err);
    estimatedAgeInput.value = '';
    photoMessage.classList.add('rc-photo-message-error');
    photoMessage.textContent = 'Failed to process photo. Please check your connection and try again.';
    submitButton.classList.remove('rc-submit-button-enabled');
    submitButton.disabled = true;
  }
  loadingMessage.classList.add('rc-hidden');
}

openCameraModalButton.addEventListener('click', openCameraModalFunc);
closeCameraModal.addEventListener('click', closeCameraModalFunc);

captureButtonModal.addEventListener('click', async function() {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  context.drawImage(modalVideo, 0, 0, 480, 360);
  const dataURL = canvas.toDataURL('image/jpeg', 0.6);
  passportPhotoDataInput.value = dataURL;
  capturedPhoto.src = dataURL;
  capturedPhotoPreview.classList.remove('rc-hidden');
  closeCameraModalFunc();
  await estimateAge(dataURL);
});

retakeButton.addEventListener('click', function() {
  openCameraModalFunc();
  capturedPhotoPreview.classList.add('rc-hidden');
  photoMessage.classList.add('rc-hidden');
  estimatedAgeInput.value = '';
  submitButton.classList.remove('rc-submit-button-enabled');
  submitButton.disabled = true;
});

form.addEventListener('submit', async function(e) {
  e.preventDefault(); // Prevent default HTML form submission
  console.log('Form submission triggered');
  console.log('BVN:', bvnInput.value);
  console.log('First Name:', form.querySelector('#firstName').value);
  console.log('Last Name:', form.querySelector('#lastName').value);
  console.log('Passport Photo Data:', passportPhotoDataInput.value);
  console.log('Estimated Age:', estimatedAgeInput.value);

  if (!/^\d{11}$/.test(bvnInput.value)) {
    bvnError.classList.remove('rc-hidden');
    return;
  }
  if (!passportPhotoDataInput.value || !estimatedAgeInput.value) {
    photoMessage.classList.remove('rc-hidden');
    photoMessage.classList.add('rc-photo-message-error');
    photoMessage.textContent = 'Photo must be captured and processed successfully.';
    return;
  }
  bvnError.classList.add('rc-hidden');
  submitButton.disabled = true;
  loadingMessage.classList.remove('rc-hidden');

  try {
    const formData = new FormData(form);
    console.log('Submitting form to /request-creator with CSRF token');
    const response = await fetchWithCsrf('/request-creator', {
      method: 'POST',
      body: formData
    });
    const result = await response.json();
    if (result.success) {
      alert('Creator request submitted successfully!');
      window.location.href = '/'; // Changed from '/success' to '/'
    } else {
      alert(`Submission failed: ${result.message || 'Unknown error'}`);
      submitButton.disabled = false;
      loadingMessage.classList.add('rc-hidden');
    }
  } catch (err) {
    console.error('Form submission error:', err);
    alert(`Submission failed: ${err.message || 'Network or server error'}`);
    submitButton.disabled = false;
    loadingMessage.classList.add('rc-hidden');
  }
});