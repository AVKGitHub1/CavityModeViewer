"use strict";

(() => {
  const DEFAULT_CAVITY_STATE = Object.freeze({
    r1Mm: 50,
    r2Mm: 50,
    lMm: 40,
    wavelengthNm: 780,
    nCenter: 1.0,
  });

  const CAVITY_LIMITS = Object.freeze({
    r1Mm: { min: 1, max: 1000 },
    r2Mm: { min: 1, max: 1000 },
    lMm: { min: 1, max: 1000 },
    wavelengthNm: { min: 400, max: 2000 },
    nCenter: { min: 1.0, max: 3.0 },
  });

  const EXACT_TOL = 1e-3;
  const NEAR_TOL = 0.08;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function formatNumber(value, digits = 2) {
    return Number(value).toFixed(digits);
  }

  function sanitizeNumber(value, fallback, limits) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return clamp(parsed, limits.min, limits.max);
  }

  function sanitizeCavityState(source = {}) {
    return {
      r1Mm: sanitizeNumber(source.r1Mm, DEFAULT_CAVITY_STATE.r1Mm, CAVITY_LIMITS.r1Mm),
      r2Mm: sanitizeNumber(source.r2Mm, DEFAULT_CAVITY_STATE.r2Mm, CAVITY_LIMITS.r2Mm),
      lMm: sanitizeNumber(source.lMm, DEFAULT_CAVITY_STATE.lMm, CAVITY_LIMITS.lMm),
      wavelengthNm: sanitizeNumber(source.wavelengthNm, DEFAULT_CAVITY_STATE.wavelengthNm, CAVITY_LIMITS.wavelengthNm),
      nCenter: sanitizeNumber(source.nCenter, DEFAULT_CAVITY_STATE.nCenter, CAVITY_LIMITS.nCenter),
    };
  }

  function readCavityStateFromSearch(search) {
    const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
    return sanitizeCavityState({
      r1Mm: params.get("r1Mm"),
      r2Mm: params.get("r2Mm"),
      lMm: params.get("lMm"),
      wavelengthNm: params.get("wavelengthNm"),
      nCenter: params.get("nCenter"),
    });
  }

  function buildModeScanUrl(baseHref, cavityState) {
    const url = new URL("mode-scan.html", baseHref);
    const cleanState = sanitizeCavityState(cavityState);
    Object.entries(cleanState).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  function buildViewerUrl(baseHref, cavityState) {
    const url = new URL("index.html", baseHref);
    const cleanState = sanitizeCavityState(cavityState);
    Object.entries(cleanState).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  function computeCavityMode(r1, r2, length, wavelength, nCenter) {
    if (r1 <= 0 || r2 <= 0) {
      throw new Error("Mirror ROC must be positive.");
    }
    if (length <= 0) {
      throw new Error("Cavity length must be positive.");
    }
    if (nCenter <= 0) {
      throw new Error("Center refractive index must be positive.");
    }

    const lambdaMedium = wavelength / nCenter;

    const prop = (distance) => [
      [1, distance],
      [0, 1],
    ];

    const mirror = (radius) => [
      [1, 0],
      [-2 / radius, 1],
    ];

    const matMul = (m1, m2) => [
      [
        m1[0][0] * m2[0][0] + m1[0][1] * m2[1][0],
        m1[0][0] * m2[0][1] + m1[0][1] * m2[1][1],
      ],
      [
        m1[1][0] * m2[0][0] + m1[1][1] * m2[1][0],
        m1[1][0] * m2[0][1] + m1[1][1] * m2[1][1],
      ],
    ];

    const M = matMul(matMul(matMul(mirror(r1), prop(length)), mirror(r2)), prop(length));
    const A = M[0][0];
    const C = M[1][0];
    const D = M[1][1];

    const g1 = 1 - length / r1;
    const g2 = 1 - length / r2;

    if (Math.abs((A + D) / 2) > 1 + 1e-9) {
      throw new Error(`Unstable cavity: g1=${g1.toFixed(4)}, g2=${g2.toFixed(4)}, g1*g2=${(g1 * g2).toFixed(4)}.`);
    }
    if (Math.abs(C) < 1e-14) {
      throw new Error("Near-planar cavity (C ~ 0): Gaussian mode is not confined.");
    }

    const disc = Math.max(0, 4 - (A + D) ** 2);
    const qReal = (A - D) / (2 * C);
    const qImag = Math.sqrt(disc) / (2 * Math.abs(C));
    const sampleCount = 1000;
    const z = [];
    const w = [];
    let minIndex = 0;
    let minW = Number.POSITIVE_INFINITY;

    for (let i = 0; i < sampleCount; i += 1) {
      const zi = (length * i) / (sampleCount - 1);
      const re = qReal + zi;
      const denom = re * re + qImag * qImag;
      const invImag = -qImag / denom;
      const wi = Math.sqrt(-lambdaMedium / (Math.PI * invImag));
      z.push(zi);
      w.push(wi);
      if (wi < minW) {
        minW = wi;
        minIndex = i;
      }
    }

    return {
      z,
      w,
      w0: w[minIndex],
      zWaist: z[minIndex],
      zR: Math.PI * w[minIndex] ** 2 / lambdaMedium,
      wM1: w[0],
      wM2: w[w.length - 1],
      g1,
      g2,
    };
  }

  function stabilityLabel(g1, g2) {
    const special = [
      ["CONFOCAL", 0, 0, "#267246"],
      ["CONCENTRIC", -1, -1, "#8a5a00"],
      ["PLANAR", 1, 1, "#8a5a00"],
    ];

    for (const [label, g1Target, g2Target, color] of special) {
      if (Math.abs(g1 - g1Target) <= EXACT_TOL && Math.abs(g2 - g2Target) <= EXACT_TOL) {
        return [label, color];
      }
    }
    for (const [label, g1Target, g2Target, color] of special) {
      if (Math.abs(g1 - g1Target) <= NEAR_TOL && Math.abs(g2 - g2Target) <= NEAR_TOL) {
        return [`NEAR-${label}`, color];
      }
    }

    return (g1 * g2 >= 0 && g1 * g2 <= 1)
      ? ["STABLE", "#267246"]
      : ["UNSTABLE", "#b33f3f"];
  }

  window.CavityCore = Object.freeze({
    CAVITY_LIMITS,
    DEFAULT_CAVITY_STATE,
    clamp,
    formatNumber,
    sanitizeCavityState,
    readCavityStateFromSearch,
    buildViewerUrl,
    buildModeScanUrl,
    computeCavityMode,
    stabilityLabel,
  });
})();
