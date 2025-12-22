/**
 * overpass.js - Overpass API Client with Caching
 * 關懷地景 The Topography of Care
 */

const OverpassModule = (() => {
  // Configuration
  const CONFIG = {
    // Use Kumi mirror as primary (more reliable)
    endpoints: [
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass-api.de/api/interpreter'
    ],
    timeout: 30000,
    retryDelay: 2000,
    maxRetries: 2,
    cacheExpiry: 5 * 60 * 1000  // 5 minutes
  };

  // Cache storage
  const cache = new Map();

  // Current endpoint index
  let endpointIndex = 0;

  /**
   * Build Overpass QL query for social care resources
   * @param {string} bbox - Bounding box "south,west,north,east"
   * @returns {string} Overpass QL query
   */
  function buildQuery(bbox) {
    return `
[out:json][timeout:25];
(
  // Hospitals (nodes and ways)
  node["amenity"="hospital"](${bbox});
  way["amenity"="hospital"](${bbox});

  // Clinics
  node["amenity"="clinic"](${bbox});

  // Libraries
  node["amenity"="library"](${bbox});
  way["amenity"="library"](${bbox});

  // Social facilities
  node["social_facility"](${bbox});
  way["social_facility"](${bbox});

  // Pharmacies
  node["amenity"="pharmacy"](${bbox});

  // Community centres
  node["amenity"="community_centre"](${bbox});
  way["amenity"="community_centre"](${bbox});

  // Kindergartens
  node["amenity"="kindergarten"](${bbox});
  way["amenity"="kindergarten"](${bbox});
);
out center tags;
`.trim();
  }

  /**
   * Generate cache key from bbox
   * @param {string} bbox
   * @returns {string}
   */
  function getCacheKey(bbox) {
    // Round to 3 decimal places for cache efficiency
    const parts = bbox.split(',').map(n => parseFloat(n).toFixed(3));
    return parts.join(',');
  }

  /**
   * Check if cache entry is still valid
   * @param {Object} entry
   * @returns {boolean}
   */
  function isCacheValid(entry) {
    return entry && (Date.now() - entry.timestamp) < CONFIG.cacheExpiry;
  }

  /**
   * Fetch resources from Overpass API
   * @param {string} bbox - Bounding box string
   * @returns {Promise<Array>} Array of resource objects
   */
  async function fetchResources(bbox) {
    const cacheKey = getCacheKey(bbox);

    // Check cache first
    const cached = cache.get(cacheKey);
    if (isCacheValid(cached)) {
      console.log('[OverpassModule] Cache hit:', cacheKey);
      return cached.data;
    }

    // Build query
    const query = buildQuery(bbox);
    console.log('[OverpassModule] Fetching resources for bbox:', bbox);

    // Try endpoints with retry logic
    let lastError = null;
    for (let retry = 0; retry <= CONFIG.maxRetries; retry++) {
      const endpoint = CONFIG.endpoints[endpointIndex];

      try {
        const response = await fetchWithTimeout(endpoint, query);
        const data = await response.json();

        if (data.elements) {
          const resources = parseElements(data.elements);

          // Update cache
          cache.set(cacheKey, {
            data: resources,
            timestamp: Date.now()
          });

          console.log(`[OverpassModule] Fetched ${resources.length} resources`);
          return resources;
        }
      } catch (error) {
        console.warn(`[OverpassModule] Endpoint ${endpointIndex} failed:`, error.message);
        lastError = error;

        // Try next endpoint
        endpointIndex = (endpointIndex + 1) % CONFIG.endpoints.length;

        if (retry < CONFIG.maxRetries) {
          await sleep(CONFIG.retryDelay);
        }
      }
    }

    // All retries failed, return cached data if available (even if expired)
    if (cached) {
      console.warn('[OverpassModule] Using expired cache due to API failure');
      return cached.data;
    }

    throw lastError || new Error('Failed to fetch resources');
  }

  /**
   * Fetch with timeout
   * @param {string} endpoint
   * @param {string} query
   * @returns {Promise<Response>}
   */
  async function fetchWithTimeout(endpoint, query) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse Overpass elements into resource objects
   * @param {Array} elements
   * @returns {Array}
   */
  function parseElements(elements) {
    return elements
      .map(el => {
        // Get coordinates (center for ways)
        const lat = el.lat || (el.center && el.center.lat);
        const lng = el.lon || (el.center && el.center.lon);

        if (!lat || !lng) return null;

        // Determine resource type
        const type = getResourceType(el.tags);
        if (!type) return null;

        // Extract name and other info
        const name = el.tags?.name || el.tags?.['name:zh'] || el.tags?.['name:en'] || null;
        const address = formatAddress(el.tags);

        return {
          id: el.id,
          type,
          lat,
          lng,
          name,
          address,
          tags: el.tags || {}
        };
      })
      .filter(Boolean);
  }

  /**
   * Determine resource type from OSM tags
   * @param {Object} tags
   * @returns {string|null}
   */
  function getResourceType(tags) {
    if (!tags) return null;

    if (tags.amenity === 'hospital') return 'hospital';
    if (tags.amenity === 'clinic') return 'clinic';
    if (tags.amenity === 'library') return 'library';
    if (tags.social_facility) return 'social';
    if (tags.amenity === 'pharmacy') return 'pharmacy';
    if (tags.amenity === 'community_centre') return 'community';
    if (tags.amenity === 'kindergarten') return 'kindergarten';

    return null;
  }

  /**
   * Format address from OSM tags
   * @param {Object} tags
   * @returns {string|null}
   */
  function formatAddress(tags) {
    if (!tags) return null;

    // Try full address first
    if (tags['addr:full']) return tags['addr:full'];

    // Build from components
    const parts = [];
    if (tags['addr:city']) parts.push(tags['addr:city']);
    if (tags['addr:district']) parts.push(tags['addr:district']);
    if (tags['addr:street']) parts.push(tags['addr:street']);
    if (tags['addr:housenumber']) parts.push(tags['addr:housenumber']);

    return parts.length > 0 ? parts.join('') : null;
  }

  /**
   * Sleep helper
   * @param {number} ms
   * @returns {Promise}
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear cache
   */
  function clearCache() {
    cache.clear();
    console.log('[OverpassModule] Cache cleared');
  }

  /**
   * Get cache statistics
   * @returns {Object}
   */
  function getCacheStats() {
    return {
      size: cache.size,
      entries: Array.from(cache.keys())
    };
  }

  // Public API
  return {
    fetchResources,
    clearCache,
    getCacheStats
  };
})();
