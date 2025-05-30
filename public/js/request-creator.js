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

const isDevEnv = process.env.NODE_ENV === 'development';

let stream;

function openCameraModalFunc() {
  cameraModal.style.display = 'flex';
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(function(mediaStream) {
        stream = mediaStream;
        modalVideo.srcObject = stream;
        modalVideo.play();
      })
      .catch(function(err) {
        alert("Unable to access the camera. Please check your browser settings.");
        if (isDevEnv) console.error('Camera access error:', err);
      });
  } else {
    alert("Your browser does not support webcam access.");
    if (isDevEnv) console.warn('Browser does not support getUserMedia');
  }
}

function closeCameraModalFunc() {
  cameraModal.style.display = 'none';
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
}

async function estimateAge(photoData) {
  loadingMessage.style.display = 'block';
  photoMessage.style.display = 'block';
  photoMessage.textContent = 'Processing photo...';

  try {
    if (typeof fetchWithCsrf !== 'function') {
      throw new Error('fetchWithCsrf is not defined');
    }
    if (isDevEnv) console.log('Captured photo data:', photoData.substring(0, 50));
    const response = await fetchWithCsrf('/request-creator/estimate-age', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoData })
    });
    const result = await response.json();
    if (result.success) {
      estimatedAgeInput.value = result.age;
      photoMessage.textContent = 'Photo captured successfully.';
      submitButton.disabled = false;
      submitButton.style.backgroundColor = '#f00';
      submitButton.style.cursor = 'pointer';
    } else {
      estimatedAgeInput.value = '';
      photoMessage.style.color = 'red';
      photoMessage.textContent = result.message || 'Failed to process photo. Please try again with a clear face.';
      submitButton.disabled = true;
      submitButton.style.backgroundColor = '#ccc';
      submitButton.style.cursor = 'not-allowed';
    }
  } catch (err) {
    if (isDevEnv) console.error('Client-side error:', err);
    estimatedAgeInput.value = '';
    photoMessage.style.color = 'red';
    photoMessage.textContent = 'Failed to process photo. Please check your connection and try again.';
    submitButton.disabled = true;
    submitButton.style.backgroundColor = '#ccc';
    submitButton.style.cursor = 'not-allowed';
  }
  loadingMessage.style.display = 'none';
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
  capturedPhotoPreview.style.display = 'block';
  closeCameraModalFunc();
  await estimateAge(dataURL);
});

retakeButton.addEventListener('click', function() {
  openCameraModalFunc();
  capturedPhotoPreview.style.display = 'none';
  photoMessage.style.display = 'none';
  estimatedAgeInput.value = '';
  submitButton.disabled = true;
  submitButton.style.backgroundColor = '#ccc';
  submitButton.style.cursor = 'not-allowed';
});

form.addEventListener('submit', function(e) {
  if (!/^\d{11}$/.test(bvnInput.value)) {
    e.preventDefault();
    bvnError.style.display = 'block';
    return;
  }
  if (!estimatedAgeInput.value) {
    e.preventDefault();
    photoMessage.style.display = 'block';
    photoMessage.style.color = 'red';
    photoMessage.textContent = 'Photo must be processed successfully.';
    return;
  }
  bvnError.style.display = 'none';
  submitButton.disabled = true;
  loadingMessage.style.display = 'block';
});

// --- Debug FetchWithCsrf Availability ---
if (isDevEnv && typeof fetchWithCsrf !== 'function') {
  console.error('fetchWithCsrf is not defined. Ensure utils.js is loaded before request-creator.js');
}