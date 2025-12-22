/**
 * contour.js - Contour Generation using d3-contour
 * 關懷地景 The Topography of Care
 *
 * Generates topographic contours from resource points using
 * Gaussian energy field superposition.
 */

const ContourModule = (() => {
  // Configuration
  const CONFIG = {
    // Grid resolution (higher = smoother but slower)
    gridWidth: 150,
    gridHeight: 150,

    // Number of contour levels
    contourLevels: 12,

    // Gaussian parameters for each resource type
    // sigma is in degrees (roughly: 0.001 ≈ 100m)
    // cutoffMultiplier: distance beyond which energy is negligible (3σ = 1.1% of amplitude)
    typeParams: {
      hospital: { sigma: 0.006, amplitude: 1.0 },      // ~600m spread
      clinic: { sigma: 0.003, amplitude: 0.5 },        // ~300m spread
      library: { sigma: 0.005, amplitude: 0.7 },       // ~500m spread
      social: { sigma: 0.004, amplitude: 0.8 },        // ~400m spread
      pharmacy: { sigma: 0.002, amplitude: 0.3 },      // ~200m spread (new)
      community: { sigma: 0.003, amplitude: 0.5 },     // ~300m spread (new)
      kindergarten: { sigma: 0.002, amplitude: 0.4 }   // ~200m spread (new)
    },

    // Default parameters for unknown types
    defaultParams: { sigma: 0.003, amplitude: 0.5 },

    // Cutoff multiplier for distance truncation optimization
    // At 3σ, Gaussian value is ~1.1% of amplitude (negligible)
    cutoffMultiplier: 3
  };

  /**
   * Generate scalar field from resource points (optimized with distance truncation)
   * Uses "reverse update" approach: each resource updates only nearby grid cells
   * @param {Array} resources - Array of resource objects with lat, lng, type
   * @param {Object} bounds - {south, west, north, east}
   * @returns {Float32Array} Flattened 2D array of energy values
   */
  function generateScalarField(resources, bounds) {
    const { gridWidth, gridHeight, cutoffMultiplier } = CONFIG;
    const field = new Float32Array(gridWidth * gridHeight);

    // Calculate cell size in degrees
    const cellWidth = (bounds.east - bounds.west) / gridWidth;
    const cellHeight = (bounds.north - bounds.south) / gridHeight;

    // For each resource, update only the grid cells within its influence radius
    for (const resource of resources) {
      const params = CONFIG.typeParams[resource.type] || CONFIG.defaultParams;
      const { sigma, amplitude } = params;
      const sigmaSq = sigma * sigma;

      // Cutoff distance (beyond this, contribution is negligible)
      const cutoff = cutoffMultiplier * sigma;

      // Calculate the grid cell range this resource affects
      const minX = Math.max(0, Math.floor((resource.lng - cutoff - bounds.west) / cellWidth));
      const maxX = Math.min(gridWidth - 1, Math.ceil((resource.lng + cutoff - bounds.west) / cellWidth));
      const minY = Math.max(0, Math.floor((resource.lat - cutoff - bounds.south) / cellHeight));
      const maxY = Math.min(gridHeight - 1, Math.ceil((resource.lat + cutoff - bounds.south) / cellHeight));

      // Update only affected grid cells
      for (let y = minY; y <= maxY; y++) {
        const cellLat = bounds.south + (y + 0.5) * cellHeight;
        const dLat = cellLat - resource.lat;
        const dLatSq = dLat * dLat;

        for (let x = minX; x <= maxX; x++) {
          const cellLng = bounds.west + (x + 0.5) * cellWidth;
          const dLng = cellLng - resource.lng;
          const distSq = dLatSq + dLng * dLng;

          // Gaussian energy: A × exp(-d² / 2σ²)
          const energy = amplitude * Math.exp(-distSq / (2 * sigmaSq));
          field[y * gridWidth + x] += energy;
        }
      }
    }

    return field;
  }

  /**
   * Generate contours from scalar field using d3-contour
   * @param {Float32Array} field - Scalar field data
   * @param {Object} options - {width, height, levels}
   * @returns {Array} Array of contour objects
   */
  function generateContours(field, options = {}) {
    const width = options.width || CONFIG.gridWidth;
    const height = options.height || CONFIG.gridHeight;
    const numLevels = options.levels || CONFIG.contourLevels;

    // Find field min/max for threshold calculation
    let min = Infinity, max = -Infinity;
    for (const val of field) {
      if (val < min) min = val;
      if (val > max) max = val;
    }

    // Skip if no significant data
    if (max < 0.01) {
      console.log('[ContourModule] No significant energy in field');
      return [];
    }

    // Generate threshold values (skip the lowest level for cleaner visuals)
    const thresholds = [];
    const step = (max - min) / (numLevels + 1);
    for (let i = 1; i <= numLevels; i++) {
      thresholds.push(min + step * i);
    }

    // Create contour generator
    const contourGenerator = d3.contours()
      .size([width, height])
      .thresholds(thresholds);

    // Generate contours
    const contours = contourGenerator(field);

    // Add normalized value to each contour (0-1 range)
    contours.forEach(contour => {
      contour.normalizedValue = (contour.value - min) / (max - min);
    });

    console.log(`[ContourModule] Generated ${contours.length} contour levels`);
    return contours;
  }

  /**
   * Transform contour coordinates from grid space to geographic coordinates
   * @param {Array} contours - Array of d3 contour objects
   * @param {Object} bounds - {south, west, north, east}
   * @returns {Array} Transformed contours
   */
  function transformToGeo(contours, bounds) {
    const { gridWidth, gridHeight } = CONFIG;
    const cellWidth = (bounds.east - bounds.west) / gridWidth;
    const cellHeight = (bounds.north - bounds.south) / gridHeight;

    return contours.map(contour => ({
      ...contour,
      coordinates: contour.coordinates.map(polygon =>
        polygon.map(ring =>
          ring.map(([x, y]) => [
            bounds.west + x * cellWidth,  // longitude
            bounds.south + y * cellHeight  // latitude
          ])
        )
      )
    }));
  }

  /**
   * Transform contour coordinates from grid space to pixel coordinates
   * @param {Array} contours - Array of d3 contour objects
   * @param {Object} pixelBounds - {left, top, width, height}
   * @returns {Array} Transformed contours with pixel coordinates
   */
  function transformToPixels(contours, pixelBounds) {
    const { gridWidth, gridHeight } = CONFIG;
    const scaleX = pixelBounds.width / gridWidth;
    const scaleY = pixelBounds.height / gridHeight;

    return contours.map(contour => ({
      ...contour,
      pixelCoordinates: contour.coordinates.map(polygon =>
        polygon.map(ring =>
          ring.map(([x, y]) => [
            pixelBounds.left + x * scaleX,
            pixelBounds.top + (gridHeight - y) * scaleY  // Flip Y axis
          ])
        )
      )
    }));
  }

  /**
   * Main entry point: generate contours from resources
   * @param {Array} resources - Resource objects
   * @param {Object} bounds - Geographic bounds {south, west, north, east}
   * @param {Object} pixelBounds - Pixel bounds {left, top, width, height}
   * @returns {Object} {contours, field, stats}
   */
  function process(resources, bounds, pixelBounds) {
    console.log(`[ContourModule] Processing ${resources.length} resources`);

    const startTime = performance.now();

    // Step 1: Generate scalar field
    const field = generateScalarField(resources, bounds);

    // Step 2: Generate contours
    const contours = generateContours(field);

    // Step 3: Transform to pixel coordinates
    const pixelContours = transformToPixels(contours, pixelBounds);

    const elapsed = performance.now() - startTime;
    console.log(`[ContourModule] Processing completed in ${elapsed.toFixed(1)}ms`);

    return {
      contours: pixelContours,
      field,
      stats: {
        resourceCount: resources.length,
        contourLevels: contours.length,
        processingTime: elapsed
      }
    };
  }

  /**
   * Get configuration (for debugging)
   */
  function getConfig() {
    return CONFIG;
  }

  /**
   * Update configuration
   * @param {Object} newConfig - Partial config to merge
   */
  function updateConfig(newConfig) {
    Object.assign(CONFIG, newConfig);
  }

  // Public API
  return {
    process,
    generateScalarField,
    generateContours,
    transformToGeo,
    transformToPixels,
    getConfig,
    updateConfig
  };
})();
