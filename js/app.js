/**
 * SmartTrip Main Application Logic
 * Orchestrates Trip Form, Autocomplete, IndexedDB Persistence,
 * Leaflet Routing, Live Expenses, Stops, Records, and Feedback.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const { esc, debounce, formatCurrency, formatDistance, formatDuration, formatDateTime, resizeImageToBlob, renderBlobToImgElement, blobToBase64, base64ToBlob, showToast } = window.AppUtils;

  // Initialize DB and Map
  await window.smartTripDB.open();
  const tripMap = new SmartTripMap('map');
  tripMap.init();

  // Active state for current trip
  let currentTrip = {
    id: null,
    name: '',
    datetime: '',
    mode: 'driving',
    purpose: 'Vacation',
    notes: '',
    photos: [], // Array of Blobs
    start: { label: '', lat: null, lng: null },
    dest: { label: '', lat: null, lng: null },
    stops: [],
    expenses: [
      { label: 'Fuel / Transport', amount: 0 },
      { label: 'Food & Snacks', amount: 0 }
    ],
    route: null
  };

  // ----------------------------------------------------
  // 1. Online / Offline Status Badge
  // ----------------------------------------------------
  const statusBadge = document.getElementById('connection-status-badge');
  const statusText = document.getElementById('status-text');

  function updateOnlineStatus() {
    if (navigator.onLine) {
      statusBadge.classList.remove('offline');
      statusText.textContent = 'Online';
    } else {
      statusBadge.classList.add('offline');
      statusText.textContent = 'Offline';
      showToast('You are offline. Live maps and geocoding need internet.', 'warning');
    }
  }

  window.addEventListener('online', () => {
    updateOnlineStatus();
    showToast('Back online! Live routing enabled.', 'success');
  });
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // ----------------------------------------------------
  // 2. Navigation Tabs
  // ----------------------------------------------------
  const tabButtons = document.querySelectorAll('.nav-tab-btn');
  const viewSections = document.querySelectorAll('.view-section');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      tabButtons.forEach((b) => b.classList.remove('active'));
      viewSections.forEach((s) => s.classList.remove('active'));

      btn.classList.add('active');
      const activeSection = document.getElementById(targetView);
      if (activeSection) {
        activeSection.classList.add('active');
      }

      if (targetView === 'capture-view') {
        tripMap.invalidateSize();
      } else if (targetView === 'records-view') {
        loadAndRenderRecords();
      }
    });
  });

  // ----------------------------------------------------
  // 3. Travel Mode Selector
  // ----------------------------------------------------
  const modeButtons = document.querySelectorAll('.mode-btn');
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      modeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentTrip.mode = btn.dataset.mode;
      triggerRouteCalculation();
    });
  });

  // ----------------------------------------------------
  // 4. Geocoding & Autocomplete (Nominatim with 1s Debounce)
  // ----------------------------------------------------
  async function searchNominatim(query) {
    if (!query || query.trim().length < 2) return [];
    if (!navigator.onLine) {
      showToast('Offline: Address search requires an internet connection.', 'warning');
      return [];
    }

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en' }
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.map((item) => ({
        label: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon)
      }));
    } catch (e) {
      console.warn('Nominatim search failed:', e);
      return [];
    }
  }

  async function reverseGeocode(lat, lng) {
    if (!navigator.onLine) return `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const data = await res.json();
      return data.display_name || `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    } catch {
      return `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    }
  }

  // Setup location input helper with dropdown and debounce
  function setupLocationInput(inputEl, dropdownEl, indicatorEl, onSelectCoord) {
    const debouncedSearch = debounce(async (query) => {
      const results = await searchNominatim(query);
      if (results.length === 0) {
        dropdownEl.innerHTML = '<div class="autocomplete-item text-dim">No locations found</div>';
        dropdownEl.classList.add('show');
        return;
      }

      dropdownEl.innerHTML = results
        .map(
          (item, idx) => `
        <div class="autocomplete-item" data-index="${idx}">
          <span class="autocomplete-item-icon">📍</span>
          <span>${esc(item.label)}</span>
        </div>
      `
        )
        .join('');
      dropdownEl.classList.add('show');

      dropdownEl.querySelectorAll('.autocomplete-item').forEach((itemEl, idx) => {
        itemEl.addEventListener('click', () => {
          const selected = results[idx];
          inputEl.value = selected.label;
          dropdownEl.classList.remove('show');
          updateIndicator(indicatorEl, true, selected.lat, selected.lng);
          onSelectCoord(selected);
          triggerRouteCalculation();
        });
      });
    }, 1100);

    inputEl.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      updateIndicator(indicatorEl, false);
      if (val.length >= 3) {
        debouncedSearch(val);
      } else {
        dropdownEl.classList.remove('show');
      }
    });

    // Manual typing with geocode on blur
    inputEl.addEventListener('blur', async () => {
      setTimeout(async () => {
        dropdownEl.classList.remove('show');
        const text = inputEl.value.trim();
        if (text && (!indicatorEl.dataset.lat || !indicatorEl.dataset.lng)) {
          const results = await searchNominatim(text);
          if (results.length > 0) {
            const first = results[0];
            updateIndicator(indicatorEl, true, first.lat, first.lng);
            onSelectCoord(first);
            triggerRouteCalculation();
          }
        }
      }, 300);
    });
  }

  function updateIndicator(indicatorEl, hasCoords, lat = null, lng = null) {
    if (hasCoords && lat && lng) {
      indicatorEl.className = 'coord-indicator';
      indicatorEl.innerHTML = `✓ Coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      indicatorEl.dataset.lat = lat;
      indicatorEl.dataset.lng = lng;
    } else {
      indicatorEl.className = 'coord-indicator missing';
      indicatorEl.innerHTML = `⚠️ No coordinates set (search or click GPS)`;
      delete indicatorEl.dataset.lat;
      delete indicatorEl.dataset.lng;
    }
  }

  // ----------------------------------------------------
  // Origin & Destination Inputs Setup
  // ----------------------------------------------------
  const startInput = document.getElementById('start-location-input');
  const startDropdown = document.getElementById('start-autocomplete');
  const startIndicator = document.getElementById('start-coord-indicator');
  const startGpsBtn = document.getElementById('start-gps-btn');

  const destInput = document.getElementById('dest-location-input');
  const destDropdown = document.getElementById('dest-autocomplete');
  const destIndicator = document.getElementById('dest-coord-indicator');
  const destGpsBtn = document.getElementById('dest-gps-btn');

  setupLocationInput(startInput, startDropdown, startIndicator, (item) => {
    currentTrip.start = { label: item.label, lat: item.lat, lng: item.lng };
  });

  setupLocationInput(destInput, destDropdown, destIndicator, (item) => {
    currentTrip.dest = { label: item.label, lat: item.lat, lng: item.lng };
  });

  // GPS Click Handlers (Only triggered on user click)
  startGpsBtn.addEventListener('click', () => {
    handleGpsClick(startGpsBtn, async (lat, lng) => {
      const label = await reverseGeocode(lat, lng);
      startInput.value = label;
      currentTrip.start = { label, lat, lng };
      updateIndicator(startIndicator, true, lat, lng);
      triggerRouteCalculation();
    });
  });

  destGpsBtn.addEventListener('click', () => {
    handleGpsClick(destGpsBtn, async (lat, lng) => {
      const label = await reverseGeocode(lat, lng);
      destInput.value = label;
      currentTrip.dest = { label, lat, lng };
      updateIndicator(destIndicator, true, lat, lng);
      triggerRouteCalculation();
    });
  });

  function handleGpsClick(btnEl, callback) {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported by your browser.', 'error');
      return;
    }
    btnEl.classList.add('loading');
    btnEl.textContent = 'Locating...';

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btnEl.classList.remove('loading');
        btnEl.innerHTML = '<span>📍 GPS</span>';
        callback(pos.coords.latitude, pos.coords.longitude);
        showToast('GPS location acquired!', 'success');
      },
      (err) => {
        btnEl.classList.remove('loading');
        btnEl.innerHTML = '<span>📍 GPS</span>';
        showToast(`GPS Error: ${err.message || 'Unable to retrieve location'}`, 'error');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  // ----------------------------------------------------
  // 5. Stops Management (Phase 5)
  // ----------------------------------------------------
  const stopsListContainer = document.getElementById('stops-list');
  const btnAddStop = document.getElementById('btn-add-stop');

  btnAddStop.addEventListener('click', () => {
    addStopItem();
  });

  function addStopItem(initialData = null) {
    const stopId = initialData?.id || `stop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const stopObj = initialData || {
      id: stopId,
      name: '',
      lat: null,
      lng: null,
      notes: '',
      photos: [],
      expenses: [{ label: 'Stop Food / Entry', amount: 0 }]
    };

    if (!initialData) {
      currentTrip.stops.push(stopObj);
    }

    renderStopCards();
    triggerRouteCalculation();
  }

  function renderStopCards() {
    stopsListContainer.innerHTML = '';

    currentTrip.stops.forEach((stop, index) => {
      const stopCard = document.createElement('div');
      stopCard.className = 'stop-card';
      stopCard.dataset.stopId = stop.id;

      const hasCoords = stop.lat && stop.lng;
      const warningBadge = !hasCoords
        ? `<span class="stop-warning-badge" id="warning-${stop.id}">⚠️ No coordinates (not routed)</span>`
        : `<span class="stop-warning-badge" style="color:#10b981; border-color:rgba(16,185,129,0.3); background:rgba(16,185,129,0.15);" id="warning-${stop.id}">✓ ${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}</span>`;

      stopCard.innerHTML = `
        <div class="stop-card-header">
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span class="stop-badge">Stop ${index + 1}</span>
            ${warningBadge}
          </div>
          <button type="button" class="btn-remove-stop" title="Remove Stop" data-remove-id="${stop.id}">✕</button>
        </div>

        <div class="form-group">
          <label class="form-label">Stop Location / Landmark</label>
          <div class="location-input-wrap">
            <div class="location-input-field">
              <input type="text" class="form-control stop-location-input" placeholder="Search town, hotel, landmark..." value="${esc(stop.name)}">
              <div class="autocomplete-dropdown stop-autocomplete"></div>
            </div>
            <button type="button" class="btn-gps stop-gps-btn"><span>📍 GPS</span></button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Stop Notes</label>
          <input type="text" class="form-control stop-notes-input" placeholder="Activities, parking, dining recommendations..." value="${esc(stop.notes || '')}">
        </div>

        <!-- Stop Expenses -->
        <div class="form-group">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.35rem;">
            <label class="form-label" style="margin-bottom:0;">Stop Expenses</label>
            <button type="button" class="btn btn-secondary btn-add-stop-expense" style="padding:0.2rem 0.5rem; font-size:0.75rem;">+ Add Expense</button>
          </div>
          <div class="stop-expenses-list"></div>
        </div>

        <!-- Stop Photos -->
        <div class="form-group" style="margin-bottom:0;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.35rem;">
            <label class="form-label" style="margin-bottom:0;">Stop Photos</label>
            <label class="btn btn-secondary" style="padding:0.2rem 0.5rem; font-size:0.75rem; cursor:pointer;">
              📷 Add Photo
              <input type="file" accept="image/*" multiple class="stop-photo-input" style="display:none;">
            </label>
          </div>
          <div class="photo-preview-grid stop-photo-preview-grid"></div>
        </div>
      `;

      stopsListContainer.appendChild(stopCard);

      // Bind Stop Elements
      const inputEl = stopCard.querySelector('.stop-location-input');
      const dropdownEl = stopCard.querySelector('.stop-autocomplete');
      const gpsBtn = stopCard.querySelector('.stop-gps-btn');
      const warningEl = stopCard.querySelector(`#warning-${stop.id}`);
      const removeBtn = stopCard.querySelector(`[data-remove-id="${stop.id}"]`);
      const notesInput = stopCard.querySelector('.stop-notes-input');

      // Notes change
      notesInput.addEventListener('input', (e) => {
        stop.notes = e.target.value;
      });

      // Remove stop
      removeBtn.addEventListener('click', () => {
        currentTrip.stops = currentTrip.stops.filter((s) => s.id !== stop.id);
        renderStopCards();
        triggerRouteCalculation();
        updateExpensesLive();
      });

      // Location search & geocoding for stop
      const debouncedStopSearch = debounce(async (query) => {
        const results = await searchNominatim(query);
        if (results.length === 0) {
          dropdownEl.innerHTML = '<div class="autocomplete-item text-dim">No locations found</div>';
          dropdownEl.classList.add('show');
          return;
        }

        dropdownEl.innerHTML = results
          .map(
            (item, idx) => `
          <div class="autocomplete-item" data-index="${idx}">
            <span class="autocomplete-item-icon">📍</span>
            <span>${esc(item.label)}</span>
          </div>
        `
          )
          .join('');
        dropdownEl.classList.add('show');

        dropdownEl.querySelectorAll('.autocomplete-item').forEach((itemEl, idx) => {
          itemEl.addEventListener('click', () => {
            const selected = results[idx];
            inputEl.value = selected.label;
            stop.name = selected.label;
            stop.lat = selected.lat;
            stop.lng = selected.lng;
            dropdownEl.classList.remove('show');
            warningEl.style.color = '#10b981';
            warningEl.style.borderColor = 'rgba(16,185,129,0.3)';
            warningEl.style.background = 'rgba(16,185,129,0.15)';
            warningEl.innerHTML = `✓ ${selected.lat.toFixed(4)}, ${selected.lng.toFixed(4)}`;
            triggerRouteCalculation();
          });
        });
      }, 1100);

      inputEl.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        stop.name = val;
        if (val.length >= 3) {
          debouncedStopSearch(val);
        } else {
          dropdownEl.classList.remove('show');
        }
      });

      inputEl.addEventListener('blur', () => {
        setTimeout(async () => {
          dropdownEl.classList.remove('show');
          if (stop.name && (!stop.lat || !stop.lng)) {
            const results = await searchNominatim(stop.name);
            if (results.length > 0) {
              stop.lat = results[0].lat;
              stop.lng = results[0].lng;
              warningEl.style.color = '#10b981';
              warningEl.style.borderColor = 'rgba(16,185,129,0.3)';
              warningEl.style.background = 'rgba(16,185,129,0.15)';
              warningEl.innerHTML = `✓ ${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`;
              triggerRouteCalculation();
            } else {
              warningEl.style.color = '#fbbf24';
              warningEl.innerHTML = `⚠️ No coordinates (not routed)`;
            }
          }
        }, 300);
      });

      // Stop GPS
      gpsBtn.addEventListener('click', () => {
        handleGpsClick(gpsBtn, async (lat, lng) => {
          const label = await reverseGeocode(lat, lng);
          inputEl.value = label;
          stop.name = label;
          stop.lat = lat;
          stop.lng = lng;
          warningEl.style.color = '#10b981';
          warningEl.style.borderColor = 'rgba(16,185,129,0.3)';
          warningEl.style.background = 'rgba(16,185,129,0.15)';
          warningEl.innerHTML = `✓ ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          triggerRouteCalculation();
        });
      });

      // Stop Photos
      const stopPhotoInput = stopCard.querySelector('.stop-photo-input');
      const stopPhotoGrid = stopCard.querySelector('.stop-photo-preview-grid');

      function renderStopPhotos() {
        stopPhotoGrid.innerHTML = '';
        (stop.photos || []).forEach((photoBlob, pIdx) => {
          const thumbWrap = document.createElement('div');
          thumbWrap.className = 'photo-thumb-wrap';
          const img = document.createElement('img');
          img.className = 'photo-thumb-img';
          renderBlobToImgElement(photoBlob, img);

          const delBtn = document.createElement('button');
          delBtn.className = 'btn-remove-thumb';
          delBtn.innerHTML = '✕';
          delBtn.onclick = () => {
            stop.photos.splice(pIdx, 1);
            renderStopPhotos();
          };

          thumbWrap.appendChild(img);
          thumbWrap.appendChild(delBtn);
          stopPhotoGrid.appendChild(thumbWrap);
        });
      }
      renderStopPhotos();

      stopPhotoInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
          try {
            const blob = await resizeImageToBlob(file, 1024);
            if (!stop.photos) stop.photos = [];
            stop.photos.push(blob);
          } catch (err) {
            console.error('Error resizing stop photo:', err);
          }
        }
        renderStopPhotos();
        stopPhotoInput.value = '';
      });

      // Stop Expenses
      const stopExpensesList = stopCard.querySelector('.stop-expenses-list');
      const btnAddStopExpense = stopCard.querySelector('.btn-add-stop-expense');

      function renderStopExpenses() {
        stopExpensesList.innerHTML = '';
        (stop.expenses || []).forEach((exp, expIdx) => {
          const row = document.createElement('div');
          row.className = 'expense-row';
          row.style.marginBottom = '0.4rem';
          row.innerHTML = `
            <input type="text" class="form-control" placeholder="Expense description" value="${esc(exp.label)}">
            <input type="number" class="form-control" placeholder="₹ Amount" min="0" value="${exp.amount || ''}">
            <button type="button" class="btn-icon-danger" title="Delete">✕</button>
          `;

          const inputs = row.querySelectorAll('input');
          inputs[0].addEventListener('input', (e) => {
            exp.label = e.target.value;
          });
          inputs[1].addEventListener('input', (e) => {
            exp.amount = parseFloat(e.target.value) || 0;
            updateExpensesLive();
          });
          row.querySelector('button').addEventListener('click', () => {
            stop.expenses.splice(expIdx, 1);
            renderStopExpenses();
            updateExpensesLive();
          });

          stopExpensesList.appendChild(row);
        });
      }
      renderStopExpenses();

      btnAddStopExpense.addEventListener('click', () => {
        if (!stop.expenses) stop.expenses = [];
        stop.expenses.push({ label: '', amount: 0 });
        renderStopExpenses();
      });
    });
  }

  // ----------------------------------------------------
  // 6. Trip-level Expenses Live Calculation (Phase 6)
  // ----------------------------------------------------
  const tripExpensesContainer = document.getElementById('trip-expense-rows');
  const btnAddTripExpense = document.getElementById('btn-add-trip-expense');
  const liveTotalExpenseEl = document.getElementById('live-total-expense');
  const summaryExpensesEl = document.getElementById('summary-total-expense');

  function renderTripExpenses() {
    tripExpensesContainer.innerHTML = '';
    currentTrip.expenses.forEach((exp, idx) => {
      const row = document.createElement('div');
      row.className = 'expense-row';
      row.innerHTML = `
        <input type="text" class="form-control" placeholder="e.g. Fuel, Toll, Hotel, Food" value="${esc(exp.label)}">
        <input type="number" class="form-control" placeholder="₹ Amount" min="0" value="${exp.amount || ''}">
        <button type="button" class="btn-icon-danger" title="Remove">✕</button>
      `;

      const inputs = row.querySelectorAll('input');
      inputs[0].addEventListener('input', (e) => {
        exp.label = e.target.value;
      });
      inputs[1].addEventListener('input', (e) => {
        exp.amount = parseFloat(e.target.value) || 0;
        updateExpensesLive();
      });
      row.querySelector('button').addEventListener('click', () => {
        currentTrip.expenses.splice(idx, 1);
        renderTripExpenses();
        updateExpensesLive();
      });

      tripExpensesContainer.appendChild(row);
    });
    updateExpensesLive();
  }

  btnAddTripExpense.addEventListener('click', () => {
    currentTrip.expenses.push({ label: '', amount: 0 });
    renderTripExpenses();
  });

  function updateExpensesLive() {
    let total = 0;
    // Trip-level expenses
    currentTrip.expenses.forEach((e) => {
      total += parseFloat(e.amount) || 0;
    });
    // Stop-level expenses
    currentTrip.stops.forEach((s) => {
      (s.expenses || []).forEach((e) => {
        total += parseFloat(e.amount) || 0;
      });
    });

    const formatted = formatCurrency(total);
    liveTotalExpenseEl.textContent = formatted;
    summaryExpensesEl.textContent = formatted;
  }
  renderTripExpenses();

  // ----------------------------------------------------
  // 7. Trip Photo Uploader with Canvas 1024px Resize (Phase 2)
  // ----------------------------------------------------
  const tripPhotoInput = document.getElementById('trip-photo-input');
  const tripPhotoGrid = document.getElementById('trip-photo-preview-grid');

  function renderTripPhotos() {
    tripPhotoGrid.innerHTML = '';
    currentTrip.photos.forEach((blob, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'photo-thumb-wrap';
      const img = document.createElement('img');
      img.className = 'photo-thumb-img';
      renderBlobToImgElement(blob, img);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-remove-thumb';
      delBtn.innerHTML = '✕';
      delBtn.onclick = () => {
        currentTrip.photos.splice(idx, 1);
        renderTripPhotos();
      };

      wrap.appendChild(img);
      wrap.appendChild(delBtn);
      tripPhotoGrid.appendChild(wrap);
    });
  }

  tripPhotoInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      try {
        const resizedBlob = await resizeImageToBlob(file, 1024);
        currentTrip.photos.push(resizedBlob);
      } catch (err) {
        console.error('Failed to resize photo:', err);
      }
    }
    renderTripPhotos();
    tripPhotoInput.value = '';
  });

  // ----------------------------------------------------
  // 8. Route Calculation & Alternatives Handler (Phase 4)
  // ----------------------------------------------------
  const summaryDistanceEl = document.getElementById('summary-distance');
  const summaryDurationEl = document.getElementById('summary-duration');
  const summaryStopsCountEl = document.getElementById('summary-stops-count');
  const routeAlternativesStrip = document.getElementById('route-alternatives-strip');

  tripMap.onRouteCalculated = (routes, activeIndex) => {
    if (!routes || routes.length === 0) {
      summaryDistanceEl.textContent = '0 km';
      summaryDurationEl.textContent = '0 min';
      routeAlternativesStrip.innerHTML = '';
      return;
    }

    const activeRoute = routes[activeIndex];
    currentTrip.route = activeRoute;

    summaryDistanceEl.textContent = formatDistance(activeRoute.distance);
    summaryDurationEl.textContent = formatDuration(activeRoute.duration);
    summaryStopsCountEl.textContent = currentTrip.stops.length;

    // Render route alternative pills if multiple routes returned
    if (routes.length > 1) {
      routeAlternativesStrip.innerHTML = routes
        .map((r, i) => {
          const isAct = i === activeIndex ? 'active' : '';
          const label = i === 0 ? 'Fastest' : `Alt ${i + 1}`;
          return `
          <button type="button" class="alt-route-pill ${isAct}" data-route-index="${i}">
            ${label}: ${formatDuration(r.duration)} (${formatDistance(r.distance)})
          </button>
        `;
        })
        .join('');

      routeAlternativesStrip.querySelectorAll('.alt-route-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
          const rIdx = parseInt(pill.dataset.routeIndex, 10);
          tripMap.selectRoute(rIdx);
        });
      });
    } else {
      routeAlternativesStrip.innerHTML = '';
    }
  };

  async function triggerRouteCalculation() {
    summaryStopsCountEl.textContent = currentTrip.stops.length;
    if (currentTrip.start?.lat && currentTrip.dest?.lat) {
      await tripMap.calculateRoute(currentTrip.start, currentTrip.stops, currentTrip.dest, currentTrip.mode);
    } else {
      tripMap.updateMarkers(currentTrip.start, currentTrip.stops, currentTrip.dest);
    }
  }

  // ----------------------------------------------------
  // 9. Save Trip to IndexedDB (Phase 2)
  // ----------------------------------------------------
  const tripForm = document.getElementById('trip-form');
  const tripNameInput = document.getElementById('trip-name-input');
  const tripDatetimeInput = document.getElementById('trip-datetime-input');
  const tripPurposeInput = document.getElementById('trip-purpose-input');
  const tripNotesInput = document.getElementById('trip-notes-input');
  const btnResetTrip = document.getElementById('btn-reset-trip');

  // Set default datetime to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  tripDatetimeInput.value = now.toISOString().slice(0, 16);

  tripForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = tripNameInput.value.trim();
    if (!name) {
      showToast('Please enter a trip name.', 'warning');
      tripNameInput.focus();
      return;
    }

    if (!currentTrip.start || !currentTrip.start.lat || !currentTrip.start.lng) {
      showToast('Please provide a valid start location with coordinates.', 'warning');
      startInput.focus();
      return;
    }

    if (!currentTrip.dest || !currentTrip.dest.lat || !currentTrip.dest.lng) {
      showToast('Please provide a valid destination location with coordinates.', 'warning');
      destInput.focus();
      return;
    }

    // Prepare full trip record
    const tripToSave = {
      id: currentTrip.id || `trip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: name,
      datetime: tripDatetimeInput.value || new Date().toISOString(),
      mode: currentTrip.mode,
      purpose: tripPurposeInput.value,
      notes: tripNotesInput.value.trim(),
      photos: currentTrip.photos, // Array of Blobs in IndexedDB
      start: currentTrip.start,
      dest: currentTrip.dest,
      stops: currentTrip.stops,
      expenses: currentTrip.expenses,
      route: currentTrip.route || {
        distance: 0,
        duration: 0,
        geometry: null
      }
    };

    try {
      await window.smartTripDB.saveTrip(tripToSave);
      showToast(`Trip "${tripToSave.name}" saved successfully!`, 'success');

      // Update badge count
      updateTripCountBadge();

      // Clear & switch to records view
      resetTripForm();
      const recordsTabBtn = document.querySelector('[data-view="records-view"]');
      if (recordsTabBtn) recordsTabBtn.click();
    } catch (err) {
      console.error('Failed to save trip to IndexedDB:', err);
      showToast('Failed to save trip to database.', 'error');
    }
  });

  btnResetTrip.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear this trip form?')) {
      resetTripForm();
      showToast('Form cleared.', 'info');
    }
  });

  function resetTripForm() {
    currentTrip = {
      id: null,
      name: '',
      datetime: new Date().toISOString().slice(0, 16),
      mode: 'driving',
      purpose: 'Vacation',
      notes: '',
      photos: [],
      start: { label: '', lat: null, lng: null },
      dest: { label: '', lat: null, lng: null },
      stops: [],
      expenses: [
        { label: 'Fuel / Transport', amount: 0 },
        { label: 'Food & Snacks', amount: 0 }
      ],
      route: null
    };

    tripNameInput.value = '';
    tripDatetimeInput.value = new Date().toISOString().slice(0, 16);
    tripPurposeInput.value = 'Vacation';
    tripNotesInput.value = '';

    modeButtons.forEach((b) => b.classList.remove('active'));
    document.querySelector('[data-mode="driving"]').classList.add('active');

    startInput.value = '';
    updateIndicator(startIndicator, false);

    destInput.value = '';
    updateIndicator(destIndicator, false);

    renderStopCards();
    renderTripExpenses();
    renderTripPhotos();

    tripMap.updateMarkers(null, [], null);
    if (tripMap.routesGroup) tripMap.routesGroup.clearLayers();
    summaryDistanceEl.textContent = '0 km';
    summaryDurationEl.textContent = '0 min';
    summaryStopsCountEl.textContent = '0';
    routeAlternativesStrip.innerHTML = '';
  }

  // ----------------------------------------------------
  // 10. Records View (Search, Details, Edit, Delete, Export, Import) (Phase 7)
  // ----------------------------------------------------
  const recordsGrid = document.getElementById('records-cards-grid');
  const recordsSearchInput = document.getElementById('records-search-input');
  const recordsModeFilter = document.getElementById('records-mode-filter');
  const recordsSortSelect = document.getElementById('records-sort-select');
  const tripCountBadge = document.getElementById('records-count-badge');
  const btnExportAll = document.getElementById('btn-export-all');
  const importFileInput = document.getElementById('import-file-input');

  let allSavedTrips = [];

  async function updateTripCountBadge() {
    const trips = await window.smartTripDB.getAllTrips();
    tripCountBadge.textContent = trips.length;
  }
  updateTripCountBadge();

  async function loadAndRenderRecords() {
    allSavedTrips = await window.smartTripDB.getAllTrips();
    updateTripCountBadge();
    filterAndRenderRecords();
  }

  function filterAndRenderRecords() {
    const query = recordsSearchInput.value.toLowerCase().trim();
    const modeFilter = recordsModeFilter.value;
    const sortVal = recordsSortSelect.value;

    let filtered = allSavedTrips.filter((t) => {
      // Mode filter
      if (modeFilter !== 'all' && t.mode !== modeFilter) return false;

      // Search query across name, dest, notes, stops
      if (query) {
        const inName = (t.name || '').toLowerCase().includes(query);
        const inDest = (t.dest?.label || '').toLowerCase().includes(query);
        const inNotes = (t.notes || '').toLowerCase().includes(query);
        const inStops = (t.stops || []).some((s) => (s.name || '').toLowerCase().includes(query));
        return inName || inDest || inNotes || inStops;
      }
      return true;
    });

    // Sorting
    filtered.sort((a, b) => {
      if (sortVal === 'newest') return new Date(b.datetime || 0) - new Date(a.datetime || 0);
      if (sortVal === 'oldest') return new Date(a.datetime || 0) - new Date(b.datetime || 0);
      if (sortVal === 'expense') {
        const totalA = calculateTotalExpense(a);
        const totalB = calculateTotalExpense(b);
        return totalB - totalA;
      }
      if (sortVal === 'distance') {
        const distA = a.route?.distance || 0;
        const distB = b.route?.distance || 0;
        return distB - distA;
      }
      return 0;
    });

    renderRecordCards(filtered);
  }

  function calculateTotalExpense(trip) {
    let sum = 0;
    (trip.expenses || []).forEach((e) => (sum += parseFloat(e.amount) || 0));
    (trip.stops || []).forEach((s) => {
      (s.expenses || []).forEach((e) => (sum += parseFloat(e.amount) || 0));
    });
    return sum;
  }

  function renderRecordCards(trips) {
    if (trips.length === 0) {
      recordsGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <span class="empty-state-icon">🗺️</span>
          <h3>No Trips Found</h3>
          <p>You haven't recorded any trips matching your criteria yet. Plan a new itinerary to get started!</p>
          <button class="btn btn-primary" onclick="document.querySelector('[data-view=\\'capture-view\\']').click()">Plan New Trip</button>
        </div>
      `;
      return;
    }

    recordsGrid.innerHTML = '';
    trips.forEach((trip) => {
      const card = document.createElement('div');
      card.className = 'saved-trip-card';

      const totalExp = calculateTotalExpense(trip);
      const dist = formatDistance(trip.route?.distance);
      const dur = formatDuration(trip.route?.duration);
      const stopCount = trip.stops?.length || 0;

      // Mode icon
      let modeIcon = '🚗';
      if (trip.mode === 'bus') modeIcon = '🚌';
      if (trip.mode === 'train') modeIcon = '🚆';
      if (trip.mode === 'flight') modeIcon = '✈️';

      card.innerHTML = `
        <div>
          <div class="trip-card-top">
            <div>
              <h3 class="trip-card-title">${esc(trip.name)}</h3>
              <span class="trip-card-date">📅 ${formatDateTime(trip.datetime)}</span>
            </div>
            <span class="trip-mode-pill">${modeIcon} ${esc(trip.mode)}</span>
          </div>

          <div class="trip-route-flow">
            <span>📍 ${esc(trip.start?.label ? trip.start.label.split(',')[0] : 'Origin')}</span>
            <span class="arrow">➔</span>
            <span>🏁 ${esc(trip.dest?.label ? trip.dest.label.split(',')[0] : 'Destination')}</span>
          </div>

          <div class="trip-stats-strip">
            <div class="stat-item">
              <span>Dist / Time</span>
              <strong>${dist} • ${dur}</strong>
            </div>
            <div class="stat-item">
              <span>Stops</span>
              <strong>${stopCount} stop${stopCount !== 1 ? 's' : ''}</strong>
            </div>
            <div class="stat-item">
              <span>Total Cost</span>
              <strong style="color:var(--accent-emerald);">${formatCurrency(totalExp)}</strong>
            </div>
          </div>

          <!-- Mini photos preview strip -->
          <div class="trip-photos-strip" id="thumbs-${trip.id}"></div>
        </div>

        <div class="trip-card-actions">
          <button class="btn btn-secondary btn-card-action" data-action="view" data-id="${trip.id}">🔍 View</button>
          <button class="btn btn-secondary btn-card-action" data-action="edit" data-id="${trip.id}">✏️ Edit</button>
          <button class="btn btn-secondary btn-card-action" data-action="export" data-id="${trip.id}">💾 Export</button>
          <button class="btn btn-secondary btn-card-action" style="color:#fb7185;" data-action="delete" data-id="${trip.id}">🗑️</button>
        </div>
      `;

      recordsGrid.appendChild(card);

      // Render thumbnail images asynchronously
      const thumbsContainer = card.querySelector(`#thumbs-${trip.id}`);
      const allPhotos = [...(trip.photos || [])];
      (trip.stops || []).forEach((s) => allPhotos.push(...(s.photos || [])));

      allPhotos.slice(0, 5).forEach((blob) => {
        const img = document.createElement('img');
        img.className = 'trip-mini-photo';
        renderBlobToImgElement(blob, img);
        thumbsContainer.appendChild(img);
      });

      // Actions
      card.querySelectorAll('.btn-card-action').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          const id = btn.dataset.id;
          if (action === 'view') openTripDetailModal(trip);
          if (action === 'edit') editTrip(trip);
          if (action === 'export') exportSingleTrip(trip);
          if (action === 'delete') confirmDeleteTrip(trip);
        });
      });
    });
  }

  recordsSearchInput.addEventListener('input', filterAndRenderRecords);
  recordsModeFilter.addEventListener('change', filterAndRenderRecords);
  recordsSortSelect.addEventListener('change', filterAndRenderRecords);

  // Edit Trip: Load saved trip data and photos into Form
  function editTrip(trip) {
    currentTrip = {
      id: trip.id,
      name: trip.name,
      datetime: trip.datetime,
      mode: trip.mode,
      purpose: trip.purpose,
      notes: trip.notes || '',
      photos: [...(trip.photos || [])], // preserves Blobs directly!
      start: { ...trip.start },
      dest: { ...trip.dest },
      stops: JSON.parse(JSON.stringify(trip.stops || [])),
      expenses: JSON.parse(JSON.stringify(trip.expenses || [])),
      route: trip.route
    };

    // Reattach Blobs for stops photos if any
    (trip.stops || []).forEach((origStop, sIdx) => {
      if (currentTrip.stops[sIdx]) {
        currentTrip.stops[sIdx].photos = [...(origStop.photos || [])];
      }
    });

    // Populate inputs
    tripNameInput.value = currentTrip.name;
    tripDatetimeInput.value = currentTrip.datetime;
    tripPurposeInput.value = currentTrip.purpose || 'Vacation';
    tripNotesInput.value = currentTrip.notes || '';

    modeButtons.forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === currentTrip.mode);
    });

    startInput.value = currentTrip.start?.label || '';
    updateIndicator(startIndicator, !!(currentTrip.start?.lat), currentTrip.start?.lat, currentTrip.start?.lng);

    destInput.value = currentTrip.dest?.label || '';
    updateIndicator(destIndicator, !!(currentTrip.dest?.lat), currentTrip.dest?.lat, currentTrip.dest?.lng);

    renderStopCards();
    renderTripExpenses();
    renderTripPhotos();

    // Switch to Capture View
    document.querySelector('[data-view="capture-view"]').click();
    triggerRouteCalculation();

    showToast(`Trip "${trip.name}" loaded for editing.`, 'info');
  }

  // Delete Trip with confirmation
  async function confirmDeleteTrip(trip) {
    if (confirm(`Are you sure you want to permanently delete "${trip.name}"?`)) {
      await window.smartTripDB.deleteTrip(trip.id);
      showToast('Trip deleted successfully.', 'info');
      loadAndRenderRecords();
    }
  }

  // Export Single Trip to JSON (Converts Blobs to Base64)
  async function exportSingleTrip(trip) {
    showToast('Exporting trip...', 'info');
    const exportedObj = await serializeTripForExport(trip);
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportedObj, null, 2));
    const downloadAnchor = document.createElement('a');
    const safeName = (trip.name || 'trip').replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `smarttrip_${safeName}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Export downloaded successfully!', 'success');
  }

  // Export All Trips
  btnExportAll.addEventListener('click', async () => {
    const trips = await window.smartTripDB.getAllTrips();
    if (trips.length === 0) {
      showToast('No trips to export.', 'warning');
      return;
    }
    showToast('Exporting all trips...', 'info');
    const serialized = [];
    for (const t of trips) {
      serialized.push(await serializeTripForExport(t));
    }
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(serialized, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `smarttrip_all_trips_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('All trips exported successfully!', 'success');
  });

  // Helper to convert Blobs to Base64 for JSON serialization
  async function serializeTripForExport(trip) {
    const clone = { ...trip };
    // Convert trip photos
    clone.photos = [];
    for (const b of trip.photos || []) {
      const b64 = await blobToBase64(b);
      if (b64) clone.photos.push(b64);
    }
    // Convert stop photos
    clone.stops = [];
    for (const stop of trip.stops || []) {
      const stopClone = { ...stop, photos: [] };
      for (const sb of stop.photos || []) {
        const sb64 = await blobToBase64(sb);
        if (sb64) stopClone.photos.push(sb64);
      }
      clone.stops.push(stopClone);
    }
    return clone;
  }

  // Import JSON file
  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importedData = JSON.parse(text);
      const tripList = Array.isArray(importedData) ? importedData : [importedData];

      let count = 0;
      for (const item of tripList) {
        if (!item.name || !item.start || !item.dest) continue;

        // Restore trip photos from Base64 to Blobs
        const restoredPhotos = [];
        for (const p of item.photos || []) {
          const blob = base64ToBlob(p);
          if (blob) restoredPhotos.push(blob);
        }
        item.photos = restoredPhotos;

        // Restore stop photos from Base64 to Blobs
        for (const s of item.stops || []) {
          const stopBlobs = [];
          for (const sp of s.photos || []) {
            const sb = base64ToBlob(sp);
            if (sb) stopBlobs.push(sb);
          }
          s.photos = stopBlobs;
        }

        if (!item.id) {
          item.id = `trip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        }

        await window.smartTripDB.saveTrip(item);
        count++;
      }

      showToast(`Successfully imported ${count} trip${count !== 1 ? 's' : ''}!`, 'success');
      loadAndRenderRecords();
    } catch (err) {
      console.error('Import failed:', err);
      showToast('Error importing JSON file. Please check file format.', 'error');
    }
    importFileInput.value = '';
  });

  // ----------------------------------------------------
  // Trip Detail Modal
  // ----------------------------------------------------
  const detailModalOverlay = document.getElementById('detail-modal-overlay');
  const detailModalContent = document.getElementById('detail-modal-body');
  const btnCloseDetailModal = document.getElementById('btn-close-detail-modal');

  btnCloseDetailModal.addEventListener('click', () => {
    detailModalOverlay.classList.remove('open');
  });

  detailModalOverlay.addEventListener('click', (e) => {
    if (e.target === detailModalOverlay) {
      detailModalOverlay.classList.remove('open');
    }
  });

  function openTripDetailModal(trip) {
    const totalExp = calculateTotalExpense(trip);
    const dist = formatDistance(trip.route?.distance);
    const dur = formatDuration(trip.route?.duration);

    let stopsHtml = '';
    if (trip.stops && trip.stops.length > 0) {
      stopsHtml = `
        <div style="margin-top:1.25rem;">
          <h4 style="font-family:var(--font-heading); color:var(--text-main); font-size:1.05rem; margin-bottom:0.6rem;">Intermediate Stops (${trip.stops.length})</h4>
          ${trip.stops
            .map(
              (s, i) => `
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:0.85rem; margin-bottom:0.6rem;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:var(--accent-amber);">Stop ${i + 1}: ${esc(s.name || 'Unnamed Stop')}</strong>
                <span style="font-size:0.75rem; color:var(--text-dim);">${s.lat && s.lng ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : 'No coords'}</span>
              </div>
              ${s.notes ? `<p style="font-size:0.82rem; color:var(--text-muted); margin-top:0.3rem;">📝 ${esc(s.notes)}</p>` : ''}
              ${
                s.expenses && s.expenses.length > 0
                  ? `<div style="font-size:0.78rem; color:var(--accent-emerald); margin-top:0.3rem;">Expenses: ${s.expenses.map((e) => `${esc(e.label)} (${formatCurrency(e.amount)})`).join(', ')}</div>`
                  : ''
              }
              <div class="photo-preview-grid" id="modal-stop-photos-${trip.id}-${i}" style="margin-top:0.4rem;"></div>
            </div>
          `
            )
            .join('')}
        </div>
      `;
    }

    let expensesHtml = '';
    const allExpenses = [...(trip.expenses || [])];
    if (allExpenses.length > 0) {
      expensesHtml = `
        <div style="margin-top:1.25rem;">
          <h4 style="font-family:var(--font-heading); color:var(--text-main); font-size:1.05rem; margin-bottom:0.6rem;">Trip Expenses Breakdown</h4>
          <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
            ${allExpenses
              .map(
                (e) => `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:0.4rem 0; color:var(--text-muted);">${esc(e.label || 'Expense')}</td>
                <td style="padding:0.4rem 0; text-align:right; font-weight:600; color:#ffffff;">${formatCurrency(e.amount)}</td>
              </tr>
            `
              )
              .join('')}
            <tr style="border-top:1px solid var(--border-hover);">
              <td style="padding:0.6rem 0; font-weight:700; color:var(--accent-emerald);">Grand Total</td>
              <td style="padding:0.6rem 0; text-align:right; font-weight:700; color:var(--accent-emerald); font-size:1.05rem;">${formatCurrency(totalExp)}</td>
            </tr>
          </table>
        </div>
      `;
    }

    detailModalContent.innerHTML = `
      <div style="margin-bottom:1rem;">
        <span class="trip-mode-pill" style="margin-bottom:0.5rem; display:inline-block;">${esc(trip.mode).toUpperCase()} • ${esc(trip.purpose || 'Travel')}</span>
        <h2 style="font-family:var(--font-heading); color:#ffffff; font-size:1.45rem;">${esc(trip.name)}</h2>
        <span style="font-size:0.82rem; color:var(--text-dim);">📅 Scheduled: ${formatDateTime(trip.datetime)}</span>
      </div>

      <div style="background:rgba(15,23,42,0.6); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:0.85rem; margin-bottom:1rem;">
        <div style="display:flex; flex-direction:column; gap:0.4rem; font-size:0.88rem;">
          <div><strong style="color:var(--accent-emerald);">Origin:</strong> ${esc(trip.start?.label || 'Not set')}</div>
          <div><strong style="color:var(--accent-rose);">Destination:</strong> ${esc(trip.dest?.label || 'Not set')}</div>
          <div style="display:flex; gap:1.25rem; margin-top:0.4rem; border-top:1px solid rgba(255,255,255,0.05); padding-top:0.4rem;">
            <span>Distance: <strong>${dist}</strong></span>
            <span>Est. Duration: <strong>${dur}</strong></span>
            <span>Total Expense: <strong style="color:var(--accent-emerald);">${formatCurrency(totalExp)}</strong></span>
          </div>
        </div>
      </div>

      ${trip.notes ? `<div style="font-size:0.88rem; color:var(--text-muted); background:rgba(255,255,255,0.02); padding:0.75rem; border-radius:var(--radius-md); margin-bottom:1rem;"><strong>Notes:</strong><br>${esc(trip.notes)}</div>` : ''}

      <div>
        <h4 style="font-family:var(--font-heading); color:var(--text-main); font-size:1.05rem; margin-bottom:0.6rem;">Trip Photos</h4>
        <div class="photo-preview-grid" id="modal-trip-photos"></div>
      </div>

      ${stopsHtml}
      ${expensesHtml}
    `;

    // Render modal photos
    const modalTripPhotosGrid = detailModalContent.querySelector('#modal-trip-photos');
    (trip.photos || []).forEach((blob) => {
      const wrap = document.createElement('div');
      wrap.className = 'photo-thumb-wrap';
      const img = document.createElement('img');
      img.className = 'photo-thumb-img';
      renderBlobToImgElement(blob, img);
      wrap.appendChild(img);
      modalTripPhotosGrid.appendChild(wrap);
    });

    // Render stop photos in modal
    (trip.stops || []).forEach((s, i) => {
      const stopGrid = detailModalContent.querySelector(`#modal-stop-photos-${trip.id}-${i}`);
      if (stopGrid) {
        (s.photos || []).forEach((blob) => {
          const wrap = document.createElement('div');
          wrap.className = 'photo-thumb-wrap';
          const img = document.createElement('img');
          img.className = 'photo-thumb-img';
          renderBlobToImgElement(blob, img);
          wrap.appendChild(img);
          stopGrid.appendChild(wrap);
        });
      }
    });

    detailModalOverlay.classList.add('open');
  }

  // ----------------------------------------------------
  // 11. Feedback Form & Contact Section (Phase 8)
  // ----------------------------------------------------
  const feedbackForm = document.getElementById('feedback-form');
  const fbNameInput = document.getElementById('fb-name');
  const fbEmailInput = document.getElementById('fb-email');
  const fbMessageInput = document.getElementById('fb-message');
  const fbCharCount = document.getElementById('fb-char-count');
  const starButtons = document.querySelectorAll('.star-btn');
  const categoryPills = document.querySelectorAll('.category-pill');

  let selectedRating = 5;
  let selectedCategory = 'Bug';

  // Star Rating Selection
  starButtons.forEach((star) => {
    star.addEventListener('click', () => {
      selectedRating = parseInt(star.dataset.rating, 10);
      updateStarsUI();
    });
  });

  function updateStarsUI() {
    starButtons.forEach((s) => {
      const val = parseInt(s.dataset.rating, 10);
      s.classList.toggle('active', val <= selectedRating);
    });
  }
  updateStarsUI();

  // Category Selection
  categoryPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      categoryPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      selectedCategory = pill.dataset.category;
    });
  });

  // Live Character Counter
  fbMessageInput.addEventListener('input', () => {
    const len = fbMessageInput.value.length;
    fbCharCount.textContent = `${len} / 1000`;
  });

  // On Submit:
  // 1. Validate & escape
  // 2. Save to 'feedback' store in IndexedDB
  // 3. Open prefilled mailto:mdanishb03@gmail.com
  // 4. Show thank-you message
  feedbackForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = fbNameInput.value.trim();
    const email = fbEmailInput.value.trim();
    const message = fbMessageInput.value.trim();

    if (!message) {
      showToast('Please enter your feedback message.', 'warning');
      fbMessageInput.focus();
      return;
    }

    const feedbackItem = {
      name: esc(name),
      email: esc(email),
      rating: selectedRating,
      category: selectedCategory,
      message: esc(message),
      timestamp: new Date().toISOString()
    };

    try {
      // Step 2: Save to IndexedDB feedback store
      await window.smartTripDB.saveFeedback(feedbackItem);

      // Step 3: Open prefilled mailto link with encoded params
      const subject = encodeURIComponent(`Smart Trip Feedback: [${selectedCategory}] from ${name || 'User'}`);
      const body = encodeURIComponent(
        `Name: ${name || 'Anonymous'}\n` +
          `Email: ${email || 'Not provided'}\n` +
          `Rating: ${selectedRating} / 5 Stars\n` +
          `Category: ${selectedCategory}\n` +
          `Date: ${new Date().toLocaleString()}\n\n` +
          `Feedback:\n${message}\n`
      );

      const mailtoUrl = `mailto:mdanishb03@gmail.com?subject=${subject}&body=${body}`;
      window.open(mailtoUrl, '_blank');

      // Step 4: Show thank-you message
      showToast('Thank you for your feedback! Opening your email app...', 'success');

      // Reset form
      feedbackForm.reset();
      selectedRating = 5;
      updateStarsUI();
      fbCharCount.textContent = '0 / 1000';
    } catch (err) {
      console.error('Error saving feedback:', err);
      showToast('Error saving feedback to database.', 'error');
    }
  });

  // ----------------------------------------------------
  // 12. Register Service Worker (Phase 9)
  // ----------------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          console.log('SmartTrip Service Worker registered:', reg.scope);
        })
        .catch((err) => {
          console.warn('Service Worker registration failed:', err);
        });
    });
  }
});
