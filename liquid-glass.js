/*
 * Liquid Glass engine for AETHER OS
 * Adapted from the iOS 26-style liquid-glass demo (SVG feDisplacementMap version).
 * Generates physics-based refraction displacement maps per element size and
 * applies them via backdrop-filter: url(#...) on a ::after layer.
 * Chromium only — other browsers keep the frosted blur fallback defined in CSS.
 */
(function () {
  'use strict';

  // backdrop-filter: url(#svg-filter) only renders in Chromium.
  var isChromium = !!window.chrome && !/Edg?e?OS/i.test(navigator.userAgent);
  if (!isChromium) return;

  var CONFIG = {
    thickness: 36, // glass thickness (px of virtual depth)
    bezel: 15, // bezel width in px around the edge
    ior: 1.52, // index of refraction
    scaleRatio: 1.0,
    blur: 2.2, // gaussian blur inside the filter
    specOpacity: 0.4,
    specSat: 3,
  };

  var SELECTOR = [
    '.gc',
    '#sidebar',
    '#bnav',
    '.note-inner',
    '#ach-popup',
    '#secret-popup',
    '.upz',
  ].join(',');

  /* ---------- SVG defs container ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('color-interpolation-filters', 'sRGB');
  svg.style.cssText = 'position:absolute;overflow:hidden;pointer-events:none';
  var defs = document.createElementNS(NS, 'defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);

  /* ---------- Physics: refraction profile ---------- */
  var surfaceFn = function (x) {
    // convex squircle
    return Math.pow(1 - Math.pow(1 - x, 4), 0.25);
  };

  function calculateRefractionProfile(glassThickness, bezelWidth, ior, samples) {
    samples = samples || 128;
    var eta = 1 / ior;
    function refract(nx, ny) {
      var dot = ny;
      var k = 1 - eta * eta * (1 - dot * dot);
      if (k < 0) return null;
      var sq = Math.sqrt(k);
      return [-(eta * dot + sq) * nx, eta - (eta * dot + sq) * ny];
    }
    var profile = new Float64Array(samples);
    for (var i = 0; i < samples; i++) {
      var x = i / samples;
      var y = surfaceFn(x);
      var dx = x < 1 ? 0.0001 : -0.0001;
      var y2 = surfaceFn(x + dx);
      var deriv = (y2 - y) / dx;
      var mag = Math.sqrt(deriv * deriv + 1);
      var ref = refract(-deriv / mag, -1 / mag);
      if (!ref) {
        profile[i] = 0;
        continue;
      }
      profile[i] = ref[0] * ((y * bezelWidth + glassThickness) / ref[1]);
    }
    return profile;
  }

  /* ---------- Displacement map ---------- */
  function generateDisplacementMap(w, h, radius, bezelWidth, profile, maxDisp) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(w, h);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      d[i] = 128;
      d[i + 1] = 128;
      d[i + 2] = 0;
      d[i + 3] = 255;
    }

    var r = radius;
    var rSq = r * r;
    var r1Sq = (r + 1) * (r + 1);
    var rBSq = Math.max(r - bezelWidth, 0) * Math.max(r - bezelWidth, 0);
    var wB = w - r * 2;
    var hB = h - r * 2;
    var S = profile.length;

    for (var y1 = 0; y1 < h; y1++) {
      for (var x1 = 0; x1 < w; x1++) {
        var x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - wB : 0;
        var y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - hB : 0;
        var dSq = x * x + y * y;
        if (dSq > r1Sq || dSq < rBSq) continue;
        var dist = Math.sqrt(dSq);
        var fromSide = r - dist;
        var op = dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
        if (op <= 0 || dist === 0) continue;
        var cos = x / dist;
        var sin = y / dist;
        var bi = Math.min(((fromSide / bezelWidth) * S) | 0, S - 1);
        var disp = profile[bi] || 0;
        var dX = (-cos * disp) / maxDisp;
        var dY = (-sin * disp) / maxDisp;
        var idx = (y1 * w + x1) * 4;
        d[idx] = (128 + dX * 127 * op + 0.5) | 0;
        d[idx + 1] = (128 + dY * 127 * op + 0.5) | 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  /* ---------- Specular highlight map ---------- */
  function generateSpecularMap(w, h, radius, bezelWidth, angle) {
    angle = angle != null ? angle : Math.PI / 3;
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(w, h);
    var d = img.data;
    d.fill(0);

    var r = radius;
    var rSq = r * r;
    var r1Sq = (r + 1) * (r + 1);
    var rBSq = Math.max(r - bezelWidth, 0) * Math.max(r - bezelWidth, 0);
    var wB = w - r * 2;
    var hB = h - r * 2;
    var sv = [Math.cos(angle), Math.sin(angle)];

    for (var y1 = 0; y1 < h; y1++) {
      for (var x1 = 0; x1 < w; x1++) {
        var x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - wB : 0;
        var y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - hB : 0;
        var dSq = x * x + y * y;
        if (dSq > r1Sq || dSq < rBSq) continue;
        var dist = Math.sqrt(dSq);
        var fromSide = r - dist;
        var op = dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
        if (op <= 0 || dist === 0) continue;
        var cos = x / dist;
        var sin = -y / dist;
        var dot = Math.abs(cos * sv[0] + sin * sv[1]);
        var edge = Math.sqrt(Math.max(0, 1 - (1 - fromSide) * (1 - fromSide)));
        var coeff = dot * edge;
        var col = (255 * coeff) | 0;
        var alpha = (col * coeff * op) | 0;
        var idx = (y1 * w + x1) * 4;
        d[idx] = col;
        d[idx + 1] = col;
        d[idx + 2] = col;
        d[idx + 3] = alpha;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  /* ---------- Filter cache ---------- */
  var cache = new Map();
  var uid = 0;

  function filterFor(w, h, radius) {
    var key = w + 'x' + h + 'x' + radius;
    var hit = cache.get(key);
    if (hit) return hit;

    var bezel = Math.max(2, Math.min(CONFIG.bezel, radius - 1, Math.min(w, h) / 2 - 1));
    var profile = calculateRefractionProfile(CONFIG.thickness, bezel, CONFIG.ior, 128);
    var maxDisp = 1;
    for (var i = 0; i < profile.length; i++) {
      var a = Math.abs(profile[i]);
      if (a > maxDisp) maxDisp = a;
    }
    var dispUrl = generateDisplacementMap(w, h, radius, bezel, profile, maxDisp);
    var specUrl = generateSpecularMap(w, h, radius, Math.min(bezel * 2.5, radius));
    var scale = maxDisp * CONFIG.scaleRatio;
    var id = 'lg-' + ++uid;

    var filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '0%');
    filter.setAttribute('y', '0%');
    filter.setAttribute('width', '100%');
    filter.setAttribute('height', '100%');
    filter.innerHTML =
      '<feGaussianBlur in="SourceGraphic" stdDeviation="' + CONFIG.blur + '" result="blurred_source" />' +
      '<feImage href="' + dispUrl + '" x="0" y="0" width="' + w + '" height="' + h + '" result="disp_map" />' +
      '<feDisplacementMap in="blurred_source" in2="disp_map" scale="' + scale + '" xChannelSelector="R" yChannelSelector="G" result="displaced" />' +
      '<feColorMatrix in="displaced" type="saturate" values="' + CONFIG.specSat + '" result="displaced_sat" />' +
      '<feImage href="' + specUrl + '" x="0" y="0" width="' + w + '" height="' + h + '" result="spec_layer" />' +
      '<feComposite in="displaced_sat" in2="spec_layer" operator="in" result="spec_masked" />' +
      '<feComponentTransfer in="spec_layer" result="spec_faded"><feFuncA type="linear" slope="' + CONFIG.specOpacity + '" /></feComponentTransfer>' +
      '<feBlend in="spec_masked" in2="displaced" mode="normal" result="with_sat" />' +
      '<feBlend in="spec_faded" in2="with_sat" mode="normal" />';
    defs.appendChild(filter);
    cache.set(key, id);
    return id;
  }

  /* ---------- Apply to elements ---------- */
  function snap(v) {
    return Math.max(2, Math.round(v / 4) * 4);
  }

  function apply(el) {
    var w = el.offsetWidth;
    var h = el.offsetHeight;
    if (w < 48 || h < 28) {
      el.style.removeProperty('--lg-filter');
      return;
    }
    var cs = getComputedStyle(el);
    var radius = parseFloat(cs.borderTopLeftRadius) || 20;
    radius = Math.min(radius, Math.min(w, h) / 2);
    var id = filterFor(snap(w), snap(h), Math.round(radius));
    el.style.setProperty('--lg-filter', 'url(#' + id + ')');
  }

  var pending = new Set();
  var raf = 0;
  function schedule(el) {
    pending.add(el);
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      pending.forEach(apply);
      pending.clear();
    });
  }

  var ro = new ResizeObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) schedule(entries[i].target);
  });

  var tracked = new WeakSet();
  function scan() {
    var els = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (tracked.has(el)) continue;
      tracked.add(el);
      el.classList.add('lg');
      ro.observe(el);
    }
  }

  var mo = new MutationObserver(function () {
    scan();
  });

  function init() {
    scan();
    mo.observe(document.body, { childList: true, subtree: true });
    document.documentElement.classList.add('lg-on');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
