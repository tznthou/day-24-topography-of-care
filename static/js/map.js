/**
 * map.js - Leaflet Map Initialization
 * 關懷地景 The Topography of Care
 */

const MapModule = (() => {
  // Private variables
  let map = null;
  let markers = [];
  let currentTileLayer = null;
  let currentTheme = 'light';  // 'light' or 'dark'

  // Tile configurations
  const TILES = {
    light: {
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      name: 'Positron',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    },
    dark: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      name: 'Dark Matter',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }
  };

  // Configuration
  const CONFIG = {
    // Taipei City Center
    center: [25.033, 121.565],
    zoom: 13,
    minZoom: 10,
    maxZoom: 18,

    // Resource type colors
    typeColors: {
      hospital: '#ef4444',  // red-500
      clinic: '#f97316',    // orange-500
      library: '#3b82f6',   // blue-500
      social: '#a855f7'     // purple-500
    },

    // Resource type weights (for contour generation)
    typeWeights: {
      hospital: { radius: 0.008, amplitude: 1.0 },   // ~800m radius
      clinic: { radius: 0.004, amplitude: 0.6 },     // ~400m radius
      library: { radius: 0.006, amplitude: 0.7 },    // ~600m radius
      social: { radius: 0.005, amplitude: 0.8 }      // ~500m radius
    }
  };

  /**
   * Initialize the Leaflet map
   */
  function init() {
    // Create map instance
    map = L.map('map', {
      center: CONFIG.center,
      zoom: CONFIG.zoom,
      minZoom: CONFIG.minZoom,
      maxZoom: CONFIG.maxZoom,
      zoomControl: true,
      attributionControl: true
    });

    // Add initial tile layer
    const tile = TILES[currentTheme];
    currentTileLayer = L.tileLayer(tile.url, {
      attribution: tile.attribution,
      subdomains: 'abcd',
      maxZoom: CONFIG.maxZoom
    }).addTo(map);

    // Zoom control 保持右下角
    map.zoomControl.setPosition('bottomright');

    // Update zoom display
    updateZoomDisplay();

    // Event listeners
    map.on('zoomend', handleZoomEnd);
    map.on('moveend', handleMoveEnd);

    console.log('[MapModule] Initialized with theme:', currentTheme);

    return map;
  }

  /**
   * Switch between light and dark themes
   * @param {string} theme - 'light' or 'dark'
   */
  function switchTheme(theme) {
    if (!TILES[theme] || theme === currentTheme) return;

    // Remove current tile layer
    if (currentTileLayer) {
      map.removeLayer(currentTileLayer);
    }

    // Add new tile layer
    const tile = TILES[theme];
    currentTileLayer = L.tileLayer(tile.url, {
      attribution: tile.attribution,
      subdomains: 'abcd',
      maxZoom: CONFIG.maxZoom
    }).addTo(map);

    currentTheme = theme;

    // Dispatch theme change event
    document.dispatchEvent(new CustomEvent('map:themechange', {
      detail: { theme }
    }));

    console.log('[MapModule] Switched to theme:', theme);
  }

  /**
   * Get current theme
   * @returns {string}
   */
  function getTheme() {
    return currentTheme;
  }

  /**
   * Handle zoom end event
   */
  function handleZoomEnd() {
    updateZoomDisplay();
    // Trigger custom event for other modules
    document.dispatchEvent(new CustomEvent('map:zoomend', {
      detail: { zoom: map.getZoom(), bounds: map.getBounds() }
    }));
  }

  /**
   * Handle move end event
   */
  function handleMoveEnd() {
    // Trigger custom event for other modules
    document.dispatchEvent(new CustomEvent('map:moveend', {
      detail: { center: map.getCenter(), bounds: map.getBounds() }
    }));
  }

  /**
   * Update zoom level display
   */
  function updateZoomDisplay() {
    const zoomEl = document.getElementById('zoom-level');
    if (zoomEl) {
      zoomEl.textContent = map.getZoom();
    }
  }

  /**
   * Get current map bounds as Overpass bbox string
   * @returns {string} "south,west,north,east"
   */
  function getBboxString() {
    const bounds = map.getBounds();
    const south = bounds.getSouth().toFixed(6);
    const west = bounds.getWest().toFixed(6);
    const north = bounds.getNorth().toFixed(6);
    const east = bounds.getEast().toFixed(6);
    return `${south},${west},${north},${east}`;
  }

  /**
   * Convert lat/lng to container pixel coordinates
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @returns {{x: number, y: number}}
   */
  function latLngToPixel(lat, lng) {
    const point = map.latLngToContainerPoint([lat, lng]);
    return { x: point.x, y: point.y };
  }

  /**
   * Convert container pixel to lat/lng
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {{lat: number, lng: number}}
   */
  function pixelToLatLng(x, y) {
    const latlng = map.containerPointToLatLng([x, y]);
    return { lat: latlng.lat, lng: latlng.lng };
  }

  /**
   * Add markers for resources (optional, for debugging)
   * @param {Array} resources - Array of resource objects
   */
  function addMarkers(resources) {
    // Clear existing markers
    clearMarkers();

    resources.forEach(resource => {
      const color = CONFIG.typeColors[resource.type] || '#fbbf24';

      const marker = L.circleMarker([resource.lat, resource.lng], {
        radius: 4,
        fillColor: color,
        fillOpacity: 0.8,
        color: color,
        weight: 1,
        opacity: 0.9
      });

      // Add tooltip
      if (resource.name) {
        marker.bindTooltip(resource.name, {
          className: 'care-tooltip',
          direction: 'top',
          offset: [0, -5]
        });
      }

      // Store reference and add to map
      marker.resourceData = resource;
      markers.push(marker);
      marker.addTo(map);
    });
  }

  /**
   * Clear all markers from map
   */
  function clearMarkers() {
    markers.forEach(marker => marker.remove());
    markers = [];
  }

  /**
   * Get map size
   * @returns {{width: number, height: number}}
   */
  function getSize() {
    const size = map.getSize();
    return { width: size.x, height: size.y };
  }

  /**
   * Get map instance
   * @returns {L.Map}
   */
  function getMap() {
    return map;
  }

  /**
   * Get configuration
   * @returns {Object}
   */
  function getConfig() {
    return CONFIG;
  }

  // Public API
  return {
    init,
    getMap,
    getConfig,
    getTheme,
    switchTheme,
    getBboxString,
    latLngToPixel,
    pixelToLatLng,
    getSize,
    addMarkers,
    clearMarkers
  };
})();
