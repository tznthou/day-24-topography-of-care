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
    cacheExpiry: 5 * 60 * 1000,  // 5 minutes
    minRequestInterval: 1000,    // Rate limiting: 1 request per second (H04)

    // Taiwan bounding box for coordinate validation (H05)
    taiwanBounds: {
      minLat: 21.0,
      maxLat: 26.5,
      minLng: 119.0,
      maxLng: 122.5
    },
    maxNameLength: 200  // Truncate long names
  };

  // Cache storage
  const cache = new Map();

  // Current endpoint index
  let endpointIndex = 0;

  // Rate limiting state (H04)
  let lastRequestTime = 0;

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
   * Fetch resources from Overpass API with rate limiting (H04)
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

    // Rate limiting (H04): enforce minimum interval between requests
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < CONFIG.minRequestInterval) {
      const waitTime = CONFIG.minRequestInterval - timeSinceLastRequest;
      console.log(`[OverpassModule] Rate limiting: waiting ${waitTime}ms`);
      await sleep(waitTime);
    }
    lastRequestTime = Date.now();

    // Build query
    const query = buildQuery(bbox);
    console.log('[OverpassModule] Fetching resources for bbox:', bbox);

    // Try endpoints with retry logic
    let lastError = null;
    for (let retry = 0; retry <= CONFIG.maxRetries; retry++) {
      const endpoint = CONFIG.endpoints[endpointIndex];

      try {
        const response = await fetchWithTimeout(endpoint, query);

        // Handle 429 Too Many Requests (H04)
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
          console.warn(`[OverpassModule] Rate limited (429), waiting ${waitTime}ms`);
          await sleep(waitTime);
          continue;
        }

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
   * Validate coordinate is within Taiwan bounds (H05)
   * @param {number} lat
   * @param {number} lng
   * @returns {boolean}
   */
  function isValidCoordinate(lat, lng) {
    // Check type and finite
    if (typeof lat !== 'number' || typeof lng !== 'number') return false;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

    // Check Taiwan bounds
    const { minLat, maxLat, minLng, maxLng } = CONFIG.taiwanBounds;
    return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
  }

  /**
   * Parse Overpass elements into resource objects with validation (H05)
   * @param {Array} elements
   * @returns {Array}
   */
  function parseElements(elements) {
    // Validate input array
    if (!Array.isArray(elements)) {
      console.error('[OverpassModule] Invalid elements: not an array');
      return [];
    }

    return elements
      .map(el => {
        // Basic type check
        if (!el || typeof el !== 'object') return null;

        // Get coordinates (center for ways)
        const lat = el.lat || (el.center && el.center.lat);
        const lng = el.lon || (el.center && el.center.lon);

        // Validate coordinates (H05)
        if (!isValidCoordinate(lat, lng)) {
          return null;  // Skip silently - out of bounds or invalid
        }

        // Determine resource type
        const type = getResourceType(el.tags);
        if (!type) return null;

        // Validate ID
        const id = parseInt(el.id, 10);
        if (!Number.isFinite(id) || id <= 0) return null;

        // Extract and sanitize name (truncate long names)
        let name = el.tags?.name || el.tags?.['name:zh'] || el.tags?.['name:en'] || null;
        if (name && name.length > CONFIG.maxNameLength) {
          name = name.substring(0, CONFIG.maxNameLength) + '...';
        }

        const address = formatAddress(el.tags);

        return {
          id,
          type,
          lat: parseFloat(lat.toFixed(6)),  // Limit precision
          lng: parseFloat(lng.toFixed(6)),
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
