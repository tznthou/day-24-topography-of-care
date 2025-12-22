/**
 * app.js - Main Application
 * 關懷地景 The Topography of Care
 *
 * Coordinates all modules and handles user interactions.
 */

const App = (() => {
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
  const UPDATE_DEBOUNCE = 500;  // ms

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
      updateTimer = setTimeout(fetchAndRender, UPDATE_DEBOUNCE);
    });

    document.addEventListener('map:zoomend', () => {
      clearTimeout(updateTimer);
      updateTimer = setTimeout(fetchAndRender, UPDATE_DEBOUNCE);
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
      // Save preference if checkbox is checked
      if (noShowCheckbox?.checked) {
        localStorage.setItem(GUIDE_STORAGE_KEY, 'true');
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

    // Auto-show for first-time visitors
    const hasSeenGuide = localStorage.getItem(GUIDE_STORAGE_KEY);
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
   * Update UI elements based on theme
   * @param {string} theme - 'light' or 'dark'
   */
  function updateUITheme(theme) {
    const body = document.body;
    const themeToggle = document.getElementById('theme-toggle');
    const canvas = document.getElementById('contour-canvas');

    if (theme === 'dark') {
      // Dark theme styles
      body.classList.remove('bg-gray-100', 'text-gray-800');
      body.classList.add('bg-gray-900', 'text-gray-100');

      // Update toggle icon
      if (themeToggle) themeToggle.querySelector('span').textContent = '☀️';

      // Update canvas blend mode for dark background
      if (canvas) {
        canvas.style.mixBlendMode = 'screen';
        canvas.style.opacity = '0.85';
      }

      // Update UI panels
      document.querySelectorAll('.theme-toggle, #side-panel, [class*="bg-white"]').forEach(el => {
        el.classList.remove('bg-white/90', 'bg-white/95', 'border-gray-200', 'shadow-sm', 'shadow-lg');
        el.classList.add('bg-gray-800/90', 'border-gray-700', 'shadow-xl');
      });

      document.querySelectorAll('.text-gray-600, .text-gray-500').forEach(el => {
        el.classList.remove('text-gray-600', 'text-gray-500');
        el.classList.add('text-gray-300');
      });

    } else {
      // Light theme styles
      body.classList.remove('bg-gray-900', 'text-gray-100');
      body.classList.add('bg-gray-100', 'text-gray-800');

      // Update toggle icon
      if (themeToggle) themeToggle.querySelector('span').textContent = '🌙';

      // Update canvas blend mode for light background
      if (canvas) {
        canvas.style.mixBlendMode = 'multiply';
        canvas.style.opacity = '0.7';
      }
    }

    // Re-render contours (colors may need adjustment)
    if (state.filteredResources.length > 0) {
      renderContours();
    }
  }

  /**
   * Fetch resources and render contours
   */
  async function fetchAndRender() {
    const map = MapModule.getMap();
    const zoom = map.getZoom();

    // Skip if zoom is too low (too much data)
    if (zoom < 11) {
      showMessage('請放大地圖以查看關懷地景');
      RendererModule.clear();
      updateStats([], 0);
      return;
    }

    const bbox = MapModule.getBboxString();

    // Skip if bbox hasn't changed significantly
    if (bbox === state.lastBbox) {
      return;
    }
    state.lastBbox = bbox;

    // Show loading state
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
      showMessage('載入資源時發生錯誤，請稍後再試');
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
   * Show message (for low zoom, errors, etc.)
   */
  function showMessage(message) {
    // Could add a message display element
    console.log('[App] Message:', message);
  }

  /**
   * Hide message
   */
  function hideMessage() {
    // Hide message element if exists
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
