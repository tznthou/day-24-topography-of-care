/**
 * renderer.js - Canvas Rendering for Contours
 * 關懷地景 The Topography of Care
 *
 * Renders contour lines on a canvas overlay with gradient coloring
 * and optional animation effects.
 */

const RendererModule = (() => {
  // Private variables
  let canvas = null;
  let ctx = null;
  let animationId = null;

  // Configuration
  const CONFIG = {
    // Color gradient from low to high energy
    // care-green (#84cc16) -> care-gold (#fbbf24) -> care-amber (#f59e0b)
    colorStops: [
      { pos: 0.0, color: { r: 132, g: 204, b: 22, a: 0.3 } },   // Green (low)
      { pos: 0.3, color: { r: 132, g: 204, b: 22, a: 0.5 } },   // Green
      { pos: 0.5, color: { r: 251, g: 191, b: 36, a: 0.6 } },   // Gold (mid)
      { pos: 0.7, color: { r: 245, g: 158, b: 11, a: 0.7 } },   // Amber
      { pos: 1.0, color: { r: 239, g: 68, b: 68, a: 0.8 } }     // Red (high)
    ],

    // Line styling
    baseLineWidth: 1.5,
    maxLineWidth: 3,

    // Glow effect
    glowEnabled: true,
    glowBlur: 8,
    glowAlpha: 0.3,

    // Animation (subtle breathing)
    breathingEnabled: false,
    breathingPeriod: 15000,  // 15 seconds
    breathingAmplitude: 0.05  // 5% scale variation
  };

  /**
   * Initialize the renderer
   */
  function init() {
    canvas = document.getElementById('contour-canvas');
    if (!canvas) {
      console.error('[RendererModule] Canvas element not found');
      return false;
    }

    ctx = canvas.getContext('2d');

    // Set initial size
    resize();

    // Listen for window resize
    window.addEventListener('resize', debounce(resize, 150));

    console.log('[RendererModule] Initialized');
    return true;
  }

  /**
   * Sync canvas size to match container (without triggering events)
   * Call this before rendering to ensure correct dimensions
   */
  function syncSize() {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    console.log('[RendererModule] syncSize - CSS rect:', rect.width, 'x', rect.height, 'canvas:', canvas.width, 'x', canvas.height);

    // Only update if size actually changed
    if (Math.round(rect.width) !== canvas.width || Math.round(rect.height) !== canvas.height) {
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
      console.log('[RendererModule] Synced size to', canvas.width, 'x', canvas.height);
    }
  }

  /**
   * Resize canvas to match window (with event dispatch)
   */
  function resize() {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const sizeChanged = canvas.width !== rect.width || canvas.height !== rect.height;

    // Set canvas size to match CSS size
    canvas.width = rect.width;
    canvas.height = rect.height;

    console.log('[RendererModule] Resized to', rect.width, 'x', rect.height);

    // Only dispatch event if size actually changed
    if (sizeChanged) {
      document.dispatchEvent(new CustomEvent('renderer:resize'));
    }
  }

  /**
   * Clear the canvas
   */
  function clear() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Render contours to canvas
   * @param {Array} contours - Array of contour objects with pixelCoordinates
   */
  function render(contours) {
    if (!ctx || !contours || contours.length === 0) {
      clear();
      return;
    }

    clear();

    const rect = canvas.getBoundingClientRect();

    // Sort contours by value (render lower values first)
    const sorted = [...contours].sort((a, b) => a.normalizedValue - b.normalizedValue);

    // Render each contour level
    sorted.forEach((contour, index) => {
      renderContour(contour, index, sorted.length);
    });
  }

  /**
   * Render a single contour level
   * @param {Object} contour - Contour object
   * @param {number} index - Contour index
   * @param {number} total - Total number of contours
   */
  function renderContour(contour, index, total) {
    const { normalizedValue, pixelCoordinates } = contour;

    // Get color for this level
    const color = interpolateColor(normalizedValue);

    // Calculate line width (thicker for higher values)
    const lineWidth = CONFIG.baseLineWidth +
      (CONFIG.maxLineWidth - CONFIG.baseLineWidth) * normalizedValue;

    // Draw glow layer first (if enabled)
    if (CONFIG.glowEnabled && normalizedValue > 0.3) {
      ctx.save();
      ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, ${CONFIG.glowAlpha})`;
      ctx.shadowBlur = CONFIG.glowBlur * normalizedValue;
      drawContourPath(pixelCoordinates, color, lineWidth * 1.5, 0.5);
      ctx.restore();
    }

    // Draw main contour line
    drawContourPath(pixelCoordinates, color, lineWidth, color.a);
  }

  /**
   * Draw contour path on canvas
   * @param {Array} coordinates - Nested array of polygon coordinates
   * @param {Object} color - {r, g, b, a}
   * @param {number} lineWidth
   * @param {number} alpha
   */
  function drawContourPath(coordinates, color, lineWidth, alpha) {
    ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Each contour can have multiple polygons (for disconnected regions)
    coordinates.forEach(polygon => {
      polygon.forEach(ring => {
        if (ring.length < 2) return;

        ctx.beginPath();
        ctx.moveTo(ring[0][0], ring[0][1]);

        for (let i = 1; i < ring.length; i++) {
          ctx.lineTo(ring[i][0], ring[i][1]);
        }

        ctx.stroke();
      });
    });
  }

  /**
   * Interpolate color from gradient based on normalized value
   * @param {number} t - Value between 0 and 1
   * @returns {Object} {r, g, b, a}
   */
  function interpolateColor(t) {
    const stops = CONFIG.colorStops;

    // Find surrounding stops
    let lower = stops[0];
    let upper = stops[stops.length - 1];

    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].pos && t <= stops[i + 1].pos) {
        lower = stops[i];
        upper = stops[i + 1];
        break;
      }
    }

    // Interpolate between stops
    const range = upper.pos - lower.pos;
    const localT = range > 0 ? (t - lower.pos) / range : 0;

    return {
      r: Math.round(lower.color.r + (upper.color.r - lower.color.r) * localT),
      g: Math.round(lower.color.g + (upper.color.g - lower.color.g) * localT),
      b: Math.round(lower.color.b + (upper.color.b - lower.color.b) * localT),
      a: lower.color.a + (upper.color.a - lower.color.a) * localT
    };
  }

  /**
   * Start breathing animation
   * @param {Function} getContours - Function that returns current contours
   */
  function startBreathing(getContours) {
    if (!CONFIG.breathingEnabled) return;

    const startTime = performance.now();

    function animate() {
      const elapsed = performance.now() - startTime;
      const phase = (elapsed % CONFIG.breathingPeriod) / CONFIG.breathingPeriod;
      const scale = 1 + Math.sin(phase * Math.PI * 2) * CONFIG.breathingAmplitude;

      // Apply scale transform to canvas
      const rect = canvas.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      clear();
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.scale(scale, scale);
      ctx.translate(-centerX, -centerY);

      const contours = getContours();
      if (contours) {
        const sorted = [...contours].sort((a, b) => a.normalizedValue - b.normalizedValue);
        sorted.forEach((contour, index) => {
          renderContour(contour, index, sorted.length);
        });
      }

      ctx.restore();

      animationId = requestAnimationFrame(animate);
    }

    animate();
  }

  /**
   * Stop breathing animation
   */
  function stopBreathing() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  /**
   * Get canvas dimensions
   * @returns {{width: number, height: number}}
   */
  function getDimensions() {
    if (!canvas) return { width: 0, height: 0 };
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  /**
   * Debounce helper
   */
  function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /**
   * Update configuration
   * @param {Object} newConfig
   */
  function updateConfig(newConfig) {
    Object.assign(CONFIG, newConfig);
  }

  /**
   * Get configuration
   */
  function getConfig() {
    return { ...CONFIG };
  }

  // Public API
  return {
    init,
    syncSize,
    resize,
    clear,
    render,
    startBreathing,
    stopBreathing,
    getDimensions,
    updateConfig,
    getConfig
  };
})();
