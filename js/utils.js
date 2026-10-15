/**
 * SmartTrip Utility Functions
 * Sanitization, image compression to Blob, currency & distance formatting,
 * JSON export/import serialization, and geocoding helpers.
 */

// 1. HTML Escaping for XSS prevention
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 2. Debounce function
function debounce(func, wait = 1000) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 3. Format Currency in INR (₹)
function formatCurrency(amount) {
  const val = Number(amount) || 0;
  return '₹ ' + val.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  });
}

// 4. Format Distance
function formatDistance(meters) {
  if (!meters || isNaN(meters)) return '0 km';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = (meters / 1000).toFixed(1);
  return `${km} km`;
}

// 5. Format Duration in seconds to readable string
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0 min';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  
  if (hours === 0) {
    return `${mins} min${mins !== 1 ? 's' : ''}`;
  }
  if (mins === 0) {
    return `${hours} hr${hours !== 1 ? 's' : ''}`;
  }
  return `${hours} hr${hours !== 1 ? 's' : ''} ${mins} min${mins !== 1 ? 's' : ''}`;
}

// 6. Format Date and Time
function formatDateTime(isoString) {
  if (!isoString) return 'Not scheduled';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } catch {
    return isoString;
  }
}

// 7. Image Resizing: Resize to max ~1024px JPEG using Canvas and return a Blob
function resizeImageToBlob(file, maxDimension = 1024, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      return reject(new Error('Invalid image file'));
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas to Blob conversion failed'));
          }
        }, 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 8. Safe Image rendering with URL.createObjectURL and immediate revoke
function renderBlobToImgElement(blob, imgElement) {
  if (!(blob instanceof Blob)) {
    if (typeof blob === 'string') {
      imgElement.src = blob;
    }
    return;
  }
  const objUrl = URL.createObjectURL(blob);
  imgElement.onload = () => {
    URL.revokeObjectURL(objUrl);
  };
  imgElement.src = objUrl;
}

// 9. Convert Blob to Base64 (Used exclusively for JSON export)
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    if (!(blob instanceof Blob)) {
      if (typeof blob === 'string') return resolve(blob);
      return resolve(null);
    }
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 10. Convert Base64 back to Blob (Used for JSON import)
function base64ToBlob(base64Data) {
  if (!base64Data || typeof base64Data !== 'string') return null;
  try {
    const parts = base64Data.split(';base64,');
    const contentType = parts[0].split(':')[1] || 'image/jpeg';
    const raw = window.atob(parts[1] || parts[0]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: contentType });
  } catch (err) {
    console.error('Failed to convert base64 to blob:', err);
    return null;
  }
}

// 11. Haversine Distance between two GPS points in kilometers
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// 12. Generate curved flight arc points for flight visualization
function generateFlightArc(start, dest, numPoints = 60) {
  const points = [];
  const lat1 = start.lat;
  const lon1 = start.lng;
  const lat2 = dest.lat;
  const lon2 = dest.lng;

  // Arc bulge perpendicular factor
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const dist = Math.sqrt(dLat * dLat + dLon * dLon);
  const arcHeight = Math.min(dist * 0.22, 12); // subtle curve

  // Perpendicular vector
  const normalLat = -dLon / (dist || 1);
  const normalLon = dLat / (dist || 1);

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    // Linear base
    const baseLat = lat1 + t * dLat;
    const baseLon = lon1 + t * dLon;
    // Parabolic arc displacement
    const displacement = Math.sin(t * Math.PI) * arcHeight;

    points.push([
      baseLat + normalLat * displacement,
      baseLon + normalLon * displacement
    ]);
  }
  return points;
}

// 13. Toast Notification helper
function showToast(message, type = 'info', duration = 3500) {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '⚠️';
  if (type === 'warning') icon = '🔔';

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-body">${esc(message)}</div>
  `;

  toastContainer.appendChild(toast);

  // Trigger entrance
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove());
  }, duration);
}

// Export utilities to window
window.AppUtils = {
  esc,
  debounce,
  formatCurrency,
  formatDistance,
  formatDuration,
  formatDateTime,
  resizeImageToBlob,
  renderBlobToImgElement,
  blobToBase64,
  base64ToBlob,
  haversineDistanceKm,
  generateFlightArc,
  showToast
};
