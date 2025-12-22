/**
 * app.js - Main Application
 * 關懷地景 The Topography of Care
 *
 * Coordinates all modules and handles user interactions.
 */

const App = (() => {
  // Configuration constants (L02: avoid magic numbers)
  const CONFIG = {
    UPDATE_DEBOUNCE_MS: 500,
    MIN_ZOOM_LEVEL: 11,
    CLICK_THRESHOLD_DEGREES: 0.002,  // ~200m
    MIN_BBOX_MOVE_THRESHOLD: 0.005,  // ~500m center movement triggers update (H02)
    BBOX_SIZE_CHANGE_THRESHOLD: 0.15, // 15% size change triggers update (H02)
    TOAST_DURATION_MS: 5000
  };

  // SafeStorage wrapper for localStorage (M02)
  const SafeStorage = {
    setItem(key, value) {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          console.warn('[SafeStorage] localStorage quota exceeded');
        } else if (e.name === 'SecurityError') {
          console.warn('[SafeStorage] localStorage unavailable (private mode?)');
        }
        return false;
      }
    },
    getItem(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        console.warn('[SafeStorage] Failed to read localStorage');
        return null;
      }
    }
  };

  // Application state
  const state = {
    resources: [],
    filteredResources: [],
    contours: null,
    isLoading: false,
    lastBbox: null,
    selectedResource: null,
    filters: {
      hospital: true,
      clinic: true,
      library: true,
      social: true,
      pharmacy: true,
      community: true,
      kindergarten: true
    }
  };

  // Debounce timer for map movements
  let updateTimer = null;

  /**
   * Initialize the application
   */
  async function init() {
    console.log('[App] Initializing 關懷地景...');

    // Initialize modules
    const map = MapModule.init();
    RendererModule.init();

    // Setup event listeners
    setupEventListeners();

    // Initial data fetch
    await fetchAndRender();

    console.log('[App] Initialization complete');
  }

  /**
   * Setup all event listeners
   */
  function setupEventListeners() {
    // Map events (debounced)
    document.addEventListener('map:moveend', () => {
      clearTimeout(updateTimer);
      updateTimer = setTimeout(fetchAndRender, CONFIG.UPDATE_DEBOUNCE_MS);
    });

    document.addEventListener('map:zoomend', () => {
      clearTimeout(updateTimer);
      updateTimer = setTimeout(fetchAndRender, CONFIG.UPDATE_DEBOUNCE_MS);
    });

    // Renderer resize event
    document.addEventListener('renderer:resize', () => {
      if (state.filteredResources.length > 0) {
        renderContours();
      }
    });

    // Filter checkboxes
    document.querySelectorAll('.resource-filter').forEach(checkbox => {
      checkbox.addEventListener('change', handleFilterChange);
    });

    // Theme toggle button
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', handleThemeToggle);
    }

    // Theme change event (update UI)
    document.addEventListener('map:themechange', (e) => {
      updateUITheme(e.detail.theme);
    });

    // Map click for selecting resources
    const map = MapModule.getMap();
    map.on('click', handleMapClick);

    // Setup guide modal
    setupGuideModal();
  }

  // =====================================================
  // Guide Modal
  // =====================================================

  const GUIDE_STORAGE_KEY = 'topography-care-guide-seen';

  /**
   * Setup guide modal event listeners and auto-show
   */
  function setupGuideModal() {
    const modal = document.getElementById('guide-modal');
    const closeBtn = document.getElementById('guide-close');
    const startBtn = document.getElementById('guide-start');
    const backdrop = modal?.querySelector('.guide-backdrop');
    const noShowCheckbox = document.getElementById('guide-no-show');
    const helpBtn = document.getElementById('help-btn');

    if (!modal) return;

    // Close button
    closeBtn?.addEventListener('click', hideGuide);

    // Start button
    startBtn?.addEventListener('click', () => {
      // Save preference if checkbox is checked (M02: use SafeStorage)
      if (noShowCheckbox?.checked) {
        SafeStorage.setItem(GUIDE_STORAGE_KEY, 'true');
      }
      hideGuide();
    });

    // Backdrop click
    backdrop?.addEventListener('click', hideGuide);

    // ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        hideGuide();
      }
    });

    // Help button
    helpBtn?.addEventListener('click', showGuide);

    // Auto-show for first-time visitors (M02: use SafeStorage)
    const hasSeenGuide = SafeStorage.getItem(GUIDE_STORAGE_KEY);
    if (!hasSeenGuide) {
      // Show after a short delay to let the map load
      setTimeout(() => {
        showGuide();
        // Add pulse effect to help button after closing
      }, 1500);
    }
  }

  /**
   * Show guide modal
   */
  function showGuide() {
    const modal = document.getElementById('guide-modal');
    const helpBtn = document.getElementById('help-btn');

    if (modal) {
      modal.classList.remove('hidden');
      // Remove pulse from help button
      helpBtn?.classList.remove('pulse');
    }
  }

  /**
   * Hide guide modal
   */
  function hideGuide() {
    const modal = document.getElementById('guide-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  /**
   * Handle theme toggle button click
   */
  function handleThemeToggle() {
    const currentTheme = MapModule.getTheme();
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    MapModule.switchTheme(newTheme);
  }

  /**
   * Update UI elements based on theme (M09: simplified with CSS class)
   * @param {string} theme - 'light' or 'dark'
   */
  function updateUITheme(theme) {
    const body = document.body;
    const themeToggle = document.getElementById('theme-toggle');
    const canvas = document.getElementById('contour-canvas');

    if (theme === 'dark') {
      // Dark theme: add class, update canvas blend mode
      body.classList.add('theme-dark');
      body.classList.remove('bg-gray-100', 'text-gray-800');
      body.classList.add('bg-gray-900', 'text-gray-100');

      if (themeToggle) themeToggle.querySelector('span').textContent = '☀️';

      if (canvas) {
        canvas.style.mixBlendMode = 'screen';
        canvas.style.opacity = '0.85';
      }
    } else {
      // Light theme: remove class, reset canvas
      body.classList.remove('theme-dark');
      body.classList.remove('bg-gray-900', 'text-gray-100');
      body.classList.add('bg-gray-100', 'text-gray-800');

      if (themeToggle) themeToggle.querySelector('span').textContent = '🌙';

      if (canvas) {
        canvas.style.mixBlendMode = 'multiply';
        canvas.style.opacity = '0.7';
      }
    }

    // Re-render contours
    if (state.filteredResources.length > 0) {
      renderContours();
    }
  }

  /**
   * Check if two bboxes are significantly different (H02)
   * Reduces unnecessary API calls when user makes small map movements
   */
  function isBboxSignificantlyDifferent(bbox1, bbox2) {
    if (!bbox1 || !bbox2) return true;

    const parse = (str) => str.split(',').map(parseFloat);
    const [s1, w1, n1, e1] = parse(bbox1);
    const [s2, w2, n2, e2] = parse(bbox2);

    // Calculate center point movement
    const centerLat1 = (s1 + n1) / 2;
    const centerLng1 = (w1 + e1) / 2;
    const centerLat2 = (s2 + n2) / 2;
    const centerLng2 = (w2 + e2) / 2;

    const latDiff = Math.abs(centerLat1 - centerLat2);
    const lngDiff = Math.abs(centerLng1 - centerLng2);

    // Calculate viewport size change
    const height1 = n1 - s1;
    const width1 = e1 - w1;
    const height2 = n2 - s2;
    const width2 = e2 - w2;

    const sizeChange = Math.max(
      Math.abs(height1 - height2) / (height1 || 1),
      Math.abs(width1 - width2) / (width1 || 1)
    );

    // Trigger update if center moved enough OR viewport size changed enough
    return (latDiff > CONFIG.MIN_BBOX_MOVE_THRESHOLD) ||
           (lngDiff > CONFIG.MIN_BBOX_MOVE_THRESHOLD) ||
           (sizeChange > CONFIG.BBOX_SIZE_CHANGE_THRESHOLD);
  }

  /**
   * Fetch resources and render contours
   */
  async function fetchAndRender() {
    const map = MapModule.getMap();
    const zoom = map.getZoom();

    // Skip if zoom is too low (too much data)
    if (zoom < CONFIG.MIN_ZOOM_LEVEL) {
      showMessage('請放大地圖以查看關懷地景', 'info');
      RendererModule.clear();
      updateStats([], 0);
      return;
    }

    const bbox = MapModule.getBboxString();

    // Skip if bbox hasn't changed significantly (H02)
    if (!isBboxSignificantlyDifferent(bbox, state.lastBbox)) {
      return;
    }

    // Prevent concurrent requests (H02)
    if (state.isLoading) {
      console.log('[App] Already loading, skipping request');
      return;
    }

    state.lastBbox = bbox;
    setLoading(true);

    try {
      // Fetch resources from Overpass
      const resources = await OverpassModule.fetchResources(bbox);
      state.resources = resources;

      // Apply filters
      applyFilters();

      // Render contours
      renderContours();

      // Update UI
      updateResourceCounts();
      hideMessage();

    } catch (error) {
      console.error('[App] Error fetching resources:', error);

      // Provide user-friendly error messages (H01)
      let userMessage = '載入資源時發生錯誤';
      if (error.name === 'AbortError') {
        userMessage = '請求逾時，請稍後再試';
      } else if (error.message?.includes('429')) {
        userMessage = 'API 請求過於頻繁，請稍後再試';
      } else if (!navigator.onLine) {
        userMessage = '網路連線中斷，請檢查網路';
      }
      showMessage(userMessage, 'error');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Apply filters to resources
   */
  function applyFilters() {
    state.filteredResources = state.resources.filter(r => state.filters[r.type]);
  }

  /**
   * Render contours from current filtered resources
   */
  function renderContours() {
    const resources = state.filteredResources;

    if (resources.length === 0) {
      RendererModule.clear();
      updateStats([], 0);
      return;
    }

    // Ensure canvas is properly sized before rendering (without triggering events)
    RendererModule.syncSize();

    // Get map bounds
    const map = MapModule.getMap();
    const mapBounds = map.getBounds();
    const bounds = {
      south: mapBounds.getSouth(),
      west: mapBounds.getWest(),
      north: mapBounds.getNorth(),
      east: mapBounds.getEast()
    };

    // Get pixel bounds
    const { width, height } = RendererModule.getDimensions();
    const pixelBounds = {
      left: 0,
      top: 0,
      width,
      height
    };

    // Generate and render contours
    const result = ContourModule.process(resources, bounds, pixelBounds);
    state.contours = result.contours;

    RendererModule.render(result.contours);

    // Update stats
    updateStats(resources, result.stats.contourLevels);

    // Optionally show markers for debugging
    // MapModule.addMarkers(resources);
  }

  /**
   * Handle filter checkbox change
   */
  function handleFilterChange(event) {
    const type = event.target.dataset.type;
    state.filters[type] = event.target.checked;

    applyFilters();
    renderContours();
    updateResourceCounts();
  }

  /**
   * Handle map click to select nearest resource
   */
  function handleMapClick(event) {
    const clickLat = event.latlng.lat;
    const clickLng = event.latlng.lng;

    // Find nearest resource within threshold
    const threshold = 0.002;  // roughly 200m
    let nearest = null;
    let nearestDist = Infinity;

    for (const resource of state.filteredResources) {
      const dist = Math.sqrt(
        Math.pow(resource.lat - clickLat, 2) +
        Math.pow(resource.lng - clickLng, 2)
      );

      if (dist < nearestDist && dist < threshold) {
        nearest = resource;
        nearestDist = dist;
      }
    }

    if (nearest) {
      selectResource(nearest);
    } else {
      deselectResource();
    }
  }

  /**
   * Select and display resource info
   */
  function selectResource(resource) {
    state.selectedResource = resource;

    const panel = document.getElementById('selected-info');
    const content = document.getElementById('selected-content');

    // Get type label
    const typeLabels = {
      hospital: '醫院',
      clinic: '診所',
      library: '圖書館',
      social: '社福機構',
      pharmacy: '藥局',
      community: '社區活動中心',
      kindergarten: '幼兒園'
    };

    // Build content HTML (all dynamic values escaped for XSS protection)
    const typeLabel = typeLabels[resource.type] || escapeHtml(resource.type);
    const osmId = Number.isInteger(resource.id) ? resource.id : encodeURIComponent(resource.id);

    const html = `
      <div class="facility-card">
        <div class="facility-type">${typeLabel}</div>
        <div class="facility-name">${escapeHtml(resource.name || '未命名設施')}</div>
        ${resource.address ? `<div class="facility-address">${escapeHtml(resource.address)}</div>` : ''}
        <div class="mt-2 text-xs text-gray-500">
          <a href="https://www.openstreetmap.org/node/${osmId}" target="_blank"
             rel="noopener noreferrer"
             class="text-care-gold hover:underline">
            在 OSM 查看
          </a>
        </div>
      </div>
    `;

    content.innerHTML = html;
    panel.classList.remove('hidden');

    // Center map on resource
    const map = MapModule.getMap();
    map.panTo([resource.lat, resource.lng]);
  }

  /**
   * Deselect current resource
   */
  function deselectResource() {
    state.selectedResource = null;
    document.getElementById('selected-info').classList.add('hidden');
  }

  /**
   * Update resource counts in sidebar
   */
  function updateResourceCounts() {
    const counts = {
      hospital: 0,
      clinic: 0,
      library: 0,
      social: 0,
      pharmacy: 0,
      community: 0,
      kindergarten: 0
    };

    state.resources.forEach(r => {
      if (counts.hasOwnProperty(r.type)) {
        counts[r.type]++;
      }
    });

    // Update DOM
    Object.entries(counts).forEach(([type, count]) => {
      const el = document.getElementById(`count-${type}`);
      if (el) el.textContent = count;
    });
  }

  /**
   * Update statistics display
   */
  function updateStats(resources, contourLevels) {
    const totalEl = document.getElementById('stat-total');
    const densityEl = document.getElementById('stat-density');

    if (totalEl) {
      totalEl.textContent = resources.length;
    }

    if (densityEl) {
      // Calculate density index (resources per visible area)
      // Simple metric: resources count normalized
      const density = resources.length > 0
        ? Math.min(100, Math.round(resources.length / 10))
        : 0;
      densityEl.textContent = density;
    }
  }

  /**
   * Show/hide loading state
   */
  function setLoading(loading) {
    state.isLoading = loading;
    const loadingEl = document.getElementById('loading-state');
    if (loadingEl) {
      loadingEl.classList.toggle('hidden', !loading);
    }
  }

  /**
   * Show toast message (H01: user-friendly notifications)
   * @param {string} message - Message text
   * @param {string} type - 'info', 'error', or 'success'
   */
  function showMessage(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) {
      console.log('[App] Message:', message);
      return;
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast-item px-4 py-3 rounded-lg shadow-lg backdrop-blur-sm pointer-events-auto
      ${type === 'error' ? 'bg-red-500/90 text-white' :
        type === 'success' ? 'bg-emerald-500/90 text-white' :
        'bg-gray-800/90 text-white'}
      transform transition-all duration-300 opacity-0 translate-y-2`;
    toast.textContent = message;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.remove('opacity-0', 'translate-y-2');
    });

    // Auto-dismiss
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, CONFIG.TOAST_DURATION_MS);
  }

  /**
   * Hide all toast messages
   */
  function hideMessage() {
    const container = document.getElementById('toast-container');
    if (container) {
      container.innerHTML = '';
    }
  }

  /**
   * Escape HTML for safe display
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Get current state (for debugging)
   */
  function getState() {
    return { ...state };
  }

  // Public API
  return {
    init,
    getState,
    fetchAndRender,
    applyFilters,
    renderContours
  };
})();

// Start application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
