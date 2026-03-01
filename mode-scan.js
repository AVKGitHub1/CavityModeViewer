"use strict";

const {
  clamp,
  formatNumber,
  computeCavityMode,
  stabilityLabel,
  readCavityStateFromSearch,
  buildViewerUrl,
} = window.CavityCore;

const SIM_DEFS = [
  { key: "xOffUm", label: "x offset", min: 0, max: 1000, step: 1, digits: 0, unit: "um" },
  { key: "yOffUm", label: "y offset", min: 0, max: 1000, step: 1, digits: 0, unit: "um" },
  { key: "scanRangeFsr", label: "Scan range", min: 1, max: 5, step: 1, digits: 0, unit: "FSR" },
  { key: "nMax", label: "Max HG order", min: 1, max: 15, step: 1, digits: 0, unit: "" },
  { key: "beamWaistMm", label: "Input waist", min: 0.005, max: 5.0, step: 0.001, digits: 3, unit: "mm" },
  { key: "beamRocMm", label: "Input ROC", min: 1, max: 2000, step: 1, digits: 0, unit: "mm" },
];

const FIXED_SETTINGS = Object.freeze({
  mirrorReflectivity: 0.995,
  nPix: 96,
  // Keep the scan point count odd so zero detuning is sampled exactly.
  nScan: 481,
  fovFactor: 4,
});

const PI_QUARTER = Math.PI ** 0.25;
const FACTORIALS = (() => {
  const values = [1];
  for (let i = 1; i <= 30; i += 1) {
    values.push(values[i - 1] * i);
  }
  return values;
})();

const cavityState = readCavityStateFromSearch(window.location.search);
const controlState = new Map();
const basisCache = new Map();

let cavityMode = null;
let cavityError = null;

try {
  cavityMode = computeCavityMode(
    cavityState.r1Mm * 1e-3,
    cavityState.r2Mm * 1e-3,
    cavityState.lMm * 1e-3,
    cavityState.wavelengthNm * 1e-9,
    cavityState.nCenter,
  );
} catch (error) {
  cavityError = error.message;
}

function matchedBeamDefaults() {
  if (!cavityMode) {
    return {
      beamWaistMm: 0.3,
      beamRocMm: cavityState.r1Mm,
    };
  }

  return {
    beamWaistMm: cavityMode.wM1 * 1e3,
    beamRocMm: cavityState.r1Mm,
  };
}

const state = {
  xOffUm: 0,
  yOffUm: 0,
  scanRangeFsr: 2,
  nMax: 10,
  ...matchedBeamDefaults(),
};

const controlsRoot = document.getElementById("simControls");
const matchBeamButton = document.getElementById("matchBeamButton");
const backToViewerLink = document.getElementById("backToViewerLink");
const simSummary = document.getElementById("simSummary");
const modeSimStatus = document.getElementById("modeSimStatus");
const cameraStatus = document.getElementById("cameraStatus");
const scanStatus = document.getElementById("scanStatus");
const cameraCanvas = document.getElementById("cameraCanvas");
const scanCanvas = document.getElementById("scanCanvas");

let renderPending = false;

function maxValue(values) {
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > max) {
      max = values[i];
    }
  }
  return max;
}

function linspace(start, end, count) {
  const values = new Float64Array(count);
  if (count === 1) {
    values[0] = start;
    return values;
  }

  const step = (end - start) / (count - 1);
  for (let i = 0; i < count; i += 1) {
    values[i] = start + i * step;
  }
  return values;
}

function hermiteTable(xValues, maxOrder) {
  const table = Array.from({ length: maxOrder + 1 }, () => new Float64Array(xValues.length));
  if (table.length === 0) {
    return table;
  }

  for (let i = 0; i < xValues.length; i += 1) {
    table[0][i] = 1;
  }
  if (maxOrder >= 1) {
    for (let i = 0; i < xValues.length; i += 1) {
      table[1][i] = 2 * xValues[i];
    }
  }
  for (let n = 2; n <= maxOrder; n += 1) {
    const previous = table[n - 1];
    const previousPrevious = table[n - 2];
    const current = table[n];
    for (let i = 0; i < xValues.length; i += 1) {
      current[i] = (2 * xValues[i] * previous[i]) - (2 * (n - 1) * previousPrevious[i]);
    }
  }

  return table;
}

function getBasis(wMirror, mirrorRoc, wavelength, beamWaist, nMax) {
  const key = [
    wMirror.toPrecision(9),
    mirrorRoc.toPrecision(9),
    wavelength.toPrecision(9),
    beamWaist.toPrecision(9),
    FIXED_SETTINGS.nPix,
    FIXED_SETTINGS.fovFactor,
    nMax,
  ].join("|");

  if (basisCache.has(key)) {
    return basisCache.get(key);
  }

  const halfSize = FIXED_SETTINGS.fovFactor * Math.max(wMirror, beamWaist);
  const x = linspace(-halfSize, halfSize, FIXED_SETTINGS.nPix);
  const dx = x[1] - x[0];
  const k = (2 * Math.PI) / wavelength;
  const xi = new Float64Array(x.length);
  const hermites = [];
  const phaseRe = new Float64Array(x.length);
  const phaseIm = new Float64Array(x.length);
  const envelope = new Float64Array(x.length);

  for (let i = 0; i < x.length; i += 1) {
    const value = x[i];
    xi[i] = Math.SQRT2 * value / wMirror;
    envelope[i] = Math.exp(-(value * value) / (wMirror * wMirror));
    if (Number.isFinite(mirrorRoc)) {
      const angle = (-k * value * value) / (2 * mirrorRoc);
      phaseRe[i] = Math.cos(angle);
      phaseIm[i] = Math.sin(angle);
    } else {
      phaseRe[i] = 1;
      phaseIm[i] = 0;
    }
  }

  hermites.push(...hermiteTable(xi, nMax));

  const uRe = [];
  const uIm = [];
  for (let n = 0; n <= nMax; n += 1) {
    const prefactor = 1 / (Math.sqrt((2 ** n) * FACTORIALS[n]) * PI_QUARTER * Math.sqrt(wMirror));
    const rowRe = new Float64Array(x.length);
    const rowIm = new Float64Array(x.length);
    for (let i = 0; i < x.length; i += 1) {
      const scaled = prefactor * hermites[n][i] * envelope[i];
      rowRe[i] = scaled * phaseRe[i];
      rowIm[i] = scaled * phaseIm[i];
    }
    uRe.push(rowRe);
    uIm.push(rowIm);
  }

  const basis = { x, dx, uRe, uIm };
  basisCache.set(key, basis);
  return basis;
}

function computeAxisOverlap(basis, beamWaist, beamRoc, wavelength, offsetMeters) {
  const coefficientsRe = new Float64Array(basis.uRe.length);
  const coefficientsIm = new Float64Array(basis.uRe.length);
  const amplitude = 1 / (PI_QUARTER * Math.sqrt(beamWaist));
  const k = (2 * Math.PI) / wavelength;

  for (let i = 0; i < basis.x.length; i += 1) {
    const shifted = basis.x[i] - offsetMeters;
    const envelope = amplitude * Math.exp(-(shifted * shifted) / (beamWaist * beamWaist));
    let fieldRe = envelope;
    let fieldIm = 0;

    if (Number.isFinite(beamRoc)) {
      const angle = (-k * shifted * shifted) / (2 * beamRoc);
      fieldRe = envelope * Math.cos(angle);
      fieldIm = envelope * Math.sin(angle);
    }

    for (let n = 0; n < basis.uRe.length; n += 1) {
      const modeRe = basis.uRe[n][i];
      const modeIm = basis.uIm[n][i];
      coefficientsRe[n] += (modeRe * fieldRe + modeIm * fieldIm) * basis.dx;
      coefficientsIm[n] += (modeRe * fieldIm - modeIm * fieldRe) * basis.dx;
    }
  }

  return { re: coefficientsRe, im: coefficientsIm };
}

function buildOrderImages(basis, alpha, beta, nMax) {
  const orderCount = (2 * nMax) + 1;
  const imageSize = basis.x.length * basis.x.length;
  const orderImages = Array.from({ length: orderCount }, () => ({
    re: new Float64Array(imageSize),
    im: new Float64Array(imageSize),
  }));
  const powerByOrder = new Float64Array(orderCount);

  for (let order = 0; order < orderCount; order += 1) {
    const image = orderImages[order];
    const nStart = Math.max(0, order - nMax);
    const nEnd = Math.min(nMax, order);

    for (let n = nStart; n <= nEnd; n += 1) {
      const m = order - n;
      const alphaRe = alpha.re[n];
      const alphaIm = alpha.im[n];
      const betaRe = beta.re[m];
      const betaIm = beta.im[m];
      const coeffRe = (alphaRe * betaRe) - (alphaIm * betaIm);
      const coeffIm = (alphaRe * betaIm) + (alphaIm * betaRe);

      powerByOrder[order] += ((alphaRe * alphaRe) + (alphaIm * alphaIm))
        * ((betaRe * betaRe) + (betaIm * betaIm));

      for (let yIndex = 0; yIndex < basis.x.length; yIndex += 1) {
        const modeYRe = basis.uRe[m][yIndex];
        const modeYIm = basis.uIm[m][yIndex];
        const rowOffset = yIndex * basis.x.length;

        for (let xIndex = 0; xIndex < basis.x.length; xIndex += 1) {
          const modeXRe = basis.uRe[n][xIndex];
          const modeXIm = basis.uIm[n][xIndex];
          const outerRe = (modeYRe * modeXRe) - (modeYIm * modeXIm);
          const outerIm = (modeYRe * modeXIm) + (modeYIm * modeXRe);
          const pixelIndex = rowOffset + xIndex;

          image.re[pixelIndex] += (coeffRe * outerRe) - (coeffIm * outerIm);
          image.im[pixelIndex] += (coeffRe * outerIm) + (coeffIm * outerRe);
        }
      }
    }
  }

  return { orderImages, powerByOrder };
}

function computeTransfer(orderCount, wavelength, gProduct, scanRangeFsr) {
  const fsrLength = wavelength / 2;
  const dL = linspace(
    -scanRangeFsr * fsrLength,
    scanRangeFsr * fsrLength,
    FIXED_SETTINGS.nScan,
  );
  const transfer = Array.from({ length: orderCount }, () => ({
    re: new Float64Array(FIXED_SETTINGS.nScan),
    im: new Float64Array(FIXED_SETTINGS.nScan),
  }));
  const corrRe = Array.from({ length: orderCount }, () => new Float64Array(orderCount));
  const corrIm = Array.from({ length: orderCount }, () => new Float64Array(orderCount));
  const k = (2 * Math.PI) / wavelength;
  const zeta = Math.acos(Math.sqrt(clamp(gProduct, 0, 1)));
  const rAmp = Math.sqrt(FIXED_SETTINGS.mirrorReflectivity);
  const tAmp = Math.sqrt(1 - FIXED_SETTINGS.mirrorReflectivity);
  const rtAmp = rAmp * rAmp;
  const ttAmp = tAmp * tAmp;

  for (let order = 0; order < orderCount; order += 1) {
    const deltaL = -(order * zeta / k);
    for (let i = 0; i < dL.length; i += 1) {
      const phi = 2 * k * (dL[i] - deltaL);
      const expPhiRe = Math.cos(phi);
      const expPhiIm = Math.sin(phi);
      const denomRe = 1 - (rtAmp * expPhiRe);
      const denomIm = -(rtAmp * expPhiIm);
      const denomMagSq = (denomRe * denomRe) + (denomIm * denomIm);
      const halfPhiRe = Math.cos(phi / 2);
      const halfPhiIm = Math.sin(phi / 2);
      const numRe = ttAmp * halfPhiRe;
      const numIm = ttAmp * halfPhiIm;

      transfer[order].re[i] = ((numRe * denomRe) + (numIm * denomIm)) / denomMagSq;
      transfer[order].im[i] = ((numIm * denomRe) - (numRe * denomIm)) / denomMagSq;
    }
  }

  for (let p = 0; p < orderCount; p += 1) {
    for (let q = 0; q < orderCount; q += 1) {
      let sumRe = 0;
      let sumIm = 0;
      for (let i = 0; i < dL.length; i += 1) {
        const pRe = transfer[p].re[i];
        const pIm = transfer[p].im[i];
        const qRe = transfer[q].re[i];
        const qIm = transfer[q].im[i];
        sumRe += (pRe * qRe) + (pIm * qIm);
        sumIm += (pIm * qRe) - (pRe * qIm);
      }
      corrRe[p][q] = sumRe / dL.length;
      corrIm[p][q] = sumIm / dL.length;
    }
  }

  return { dL, transfer, corrRe, corrIm };
}

function normalize(values) {
  const peak = Math.max(maxValue(values), 1e-18);
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    out[i] = values[i] / peak;
  }
  return { values: out, peak };
}

function simulateModeScan() {
  if (!cavityMode) {
    throw new Error(cavityError || "Cavity mode is unavailable.");
  }

  const wavelength = (cavityState.wavelengthNm * 1e-9) / cavityState.nCenter;
  const r1 = cavityState.r1Mm * 1e-3;
  const beamWaist = state.beamWaistMm * 1e-3;
  const beamRoc = state.beamRocMm * 1e-3;
  const basis = getBasis(cavityMode.wM1, r1, wavelength, beamWaist, state.nMax);
  const alpha = computeAxisOverlap(basis, beamWaist, beamRoc, wavelength, state.xOffUm * 1e-6);
  const beta = computeAxisOverlap(basis, beamWaist, beamRoc, wavelength, state.yOffUm * 1e-6);
  const { orderImages, powerByOrder } = buildOrderImages(basis, alpha, beta, state.nMax);
  const { dL, transfer, corrRe, corrIm } = computeTransfer(
    orderImages.length,
    wavelength,
    cavityMode.g1 * cavityMode.g2,
    state.scanRangeFsr,
  );

  const pdSignal = new Float64Array(dL.length);
  for (let order = 0; order < orderImages.length; order += 1) {
    for (let i = 0; i < dL.length; i += 1) {
      const hRe = transfer[order].re[i];
      const hIm = transfer[order].im[i];
      pdSignal[i] += powerByOrder[order] * ((hRe * hRe) + (hIm * hIm));
    }
  }

  const image = new Float64Array(basis.x.length * basis.x.length);
  for (let p = 0; p < orderImages.length; p += 1) {
    const imageP = orderImages[p];
    for (let q = 0; q < orderImages.length; q += 1) {
      const weightRe = corrRe[p][q];
      const weightIm = corrIm[p][q];
      const imageQ = orderImages[q];

      for (let pixel = 0; pixel < image.length; pixel += 1) {
        const prodRe = (imageP.re[pixel] * imageQ.re[pixel]) + (imageP.im[pixel] * imageQ.im[pixel]);
        const prodIm = (imageP.im[pixel] * imageQ.re[pixel]) - (imageP.re[pixel] * imageQ.im[pixel]);
        image[pixel] += (weightRe * prodRe) - (weightIm * prodIm);
      }
    }
  }

  for (let pixel = 0; pixel < image.length; pixel += 1) {
    image[pixel] = Math.max(0, image[pixel]);
  }

  const pdNorm = normalize(pdSignal);
  const imageNorm = normalize(image);

  let peakIndex = 0;
  for (let i = 1; i < pdNorm.values.length; i += 1) {
    if (pdNorm.values[i] > pdNorm.values[peakIndex]) {
      peakIndex = i;
    }
  }

  return {
    nPix: basis.x.length,
    extentMm: [basis.x[0] * 1e3, basis.x[basis.x.length - 1] * 1e3],
    dLFsr: Float64Array.from(dL, (value) => value / (wavelength / 2)),
    pdSignal: pdNorm.values,
    pdPeak: pdNorm.peak,
    peakDetuningFsr: dL[peakIndex] / (wavelength / 2),
    cameraImage: imageNorm.values,
    cameraPeak: imageNorm.peak,
  };
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(320, Math.round(rect.width));
  const cssHeight = Math.max(280, Math.round(rect.height));
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: cssWidth, height: cssHeight };
}

function drawRoundedLabel(ctx, x, y, text, fill, stroke, color) {
  ctx.save();
  ctx.font = "600 13px Segoe UI";
  const padX = 10;
  const padY = 6;
  const textWidth = ctx.measureText(text).width;
  const boxWidth = textWidth + (padX * 2);
  const boxHeight = 28;
  const left = x - (boxWidth / 2);
  const top = y - (boxHeight / 2);
  const radius = 9;

  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.arcTo(left + boxWidth, top, left + boxWidth, top + boxHeight, radius);
  ctx.arcTo(left + boxWidth, top + boxHeight, left, top + boxHeight, radius);
  ctx.arcTo(left, top + boxHeight, left, top, radius);
  ctx.arcTo(left, top, left + boxWidth, top, radius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

function drawAxisTicks(ctx, config) {
  const {
    xTicks,
    yTicks,
    mapX,
    mapY,
    plotLeft,
    plotTop,
    plotWidth,
    plotHeight,
    xFormatter,
    yFormatter,
  } = config;

  ctx.save();
  ctx.strokeStyle = "#617389";
  ctx.fillStyle = "#5e6d7d";
  ctx.lineWidth = 1;
  ctx.font = "11px Segoe UI";

  xTicks.forEach((tick) => {
    const x = mapX(tick);
    ctx.beginPath();
    ctx.moveTo(x, plotTop + plotHeight);
    ctx.lineTo(x, plotTop + plotHeight + 6);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(xFormatter(tick), x, plotTop + plotHeight + 9);
  });

  yTicks.forEach((tick) => {
    const y = mapY(tick);
    ctx.beginPath();
    ctx.moveTo(plotLeft - 6, y);
    ctx.lineTo(plotLeft, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(yFormatter(tick), plotLeft - 10, y);
  });

  ctx.restore();
}

function colorRamp(t) {
  const stops = [
    [0.0, [16, 34, 61]],
    [0.28, [30, 86, 140]],
    [0.58, [82, 160, 180]],
    [0.8, [250, 215, 111]],
    [1.0, [215, 92, 54]],
  ];

  const clamped = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i += 1) {
    const [rightT, rightColor] = stops[i];
    const [leftT, leftColor] = stops[i - 1];
    if (clamped <= rightT) {
      const local = (clamped - leftT) / (rightT - leftT);
      return [
        Math.round(leftColor[0] + ((rightColor[0] - leftColor[0]) * local)),
        Math.round(leftColor[1] + ((rightColor[1] - leftColor[1]) * local)),
        Math.round(leftColor[2] + ((rightColor[2] - leftColor[2]) * local)),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

function rasterizeHeatmap(image, nPix) {
  const raster = document.createElement("canvas");
  raster.width = nPix;
  raster.height = nPix;
  const ctx = raster.getContext("2d");
  const imageData = ctx.createImageData(nPix, nPix);

  for (let y = 0; y < nPix; y += 1) {
    for (let x = 0; x < nPix; x += 1) {
      const sourceIndex = ((nPix - 1 - y) * nPix) + x;
      const [r, g, b] = colorRamp(image[sourceIndex]);
      const offset = ((y * nPix) + x) * 4;
      imageData.data[offset] = r;
      imageData.data[offset + 1] = g;
      imageData.data[offset + 2] = b;
      imageData.data[offset + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return raster;
}

function drawCameraPlot(result, errorText) {
  const { ctx, width, height } = setupCanvas(cameraCanvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const margin = { left: 64, right: 20, top: 36, bottom: 44 };
  const outerPlotW = width - margin.left - margin.right;
  const outerPlotH = height - margin.top - margin.bottom;
  const plotSize = Math.min(outerPlotW, outerPlotH);
  const plotLeft = margin.left + ((outerPlotW - plotSize) / 2);
  const plotTop = margin.top + ((outerPlotH - plotSize) / 2);

  ctx.fillStyle = "#f5f9ff";
  ctx.fillRect(plotLeft, plotTop, plotSize, plotSize);

  if (result) {
    const [minMm, maxMm] = result.extentMm;
    const raster = rasterizeHeatmap(result.cameraImage, result.nPix);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(raster, plotLeft, plotTop, plotSize, plotSize);

    const mapX = (value) => plotLeft + ((value - minMm) / (maxMm - minMm)) * plotSize;
    const mapY = (value) => plotTop + (1 - ((value - minMm) / (maxMm - minMm))) * plotSize;

    ctx.strokeStyle = "rgba(97, 115, 137, 0.45)";
    ctx.strokeRect(plotLeft, plotTop, plotSize, plotSize);

    drawAxisTicks(ctx, {
      xTicks: [minMm, (minMm + maxMm) / 2, maxMm],
      yTicks: [minMm, (minMm + maxMm) / 2, maxMm],
      mapX,
      mapY,
      plotLeft,
      plotTop,
      plotWidth: plotSize,
      plotHeight: plotSize,
      xFormatter: (tick) => formatNumber(tick, 2),
      yFormatter: (tick) => formatNumber(tick, 2),
    });

    cameraStatus.textContent = "";
  } else {
    ctx.strokeStyle = "rgba(97, 115, 137, 0.45)";
    ctx.strokeRect(plotLeft, plotTop, plotSize, plotSize);
    drawRoundedLabel(
      ctx,
      plotLeft + (plotSize / 2),
      plotTop + (plotSize / 2),
      errorText,
      "rgba(255, 255, 255, 0.95)",
      "#e3b3b3",
      "#b33f3f",
    );
    cameraStatus.textContent = "No camera image";
  }

  ctx.fillStyle = "#1f2933";
  ctx.font = "600 16px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText("Average Camera Intensity", width / 2, 22);
  ctx.font = "12px Segoe UI";
  ctx.fillStyle = "#5e6d7d";
  ctx.fillText("x (mm)", plotLeft + (plotSize / 2), height - 14);

  ctx.save();
  ctx.translate(plotLeft - 38, plotTop + (plotSize / 2));
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("y (mm)", 0, 0);
  ctx.restore();
}

function drawScanPlot(result, errorText) {
  const { ctx, width, height } = setupCanvas(scanCanvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const margin = { left: 58, right: 20, top: 36, bottom: 46 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const xMin = result ? result.dLFsr[0] : -1;
  const xMax = result ? result.dLFsr[result.dLFsr.length - 1] : 1;
  const yMin = 0;
  const yMax = 1.05;

  const mapX = (value) => margin.left + ((value - xMin) / (xMax - xMin)) * plotWidth;
  const mapY = (value) => margin.top + (1 - ((value - yMin) / (yMax - yMin))) * plotHeight;

  ctx.strokeStyle = "rgba(90, 112, 138, 0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i += 1) {
    const gx = margin.left + ((plotWidth * i) / 6);
    const gy = margin.top + ((plotHeight * i) / 6);
    ctx.beginPath();
    ctx.moveTo(gx, margin.top);
    ctx.lineTo(gx, margin.top + plotHeight);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(margin.left, gy);
    ctx.lineTo(margin.left + plotWidth, gy);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(97, 115, 137, 0.45)";
  ctx.strokeRect(margin.left, margin.top, plotWidth, plotHeight);

  if (result) {
    ctx.beginPath();
    ctx.moveTo(mapX(result.dLFsr[0]), mapY(result.pdSignal[0]));
    for (let i = 1; i < result.dLFsr.length; i += 1) {
      ctx.lineTo(mapX(result.dLFsr[i]), mapY(result.pdSignal[i]));
    }
    ctx.strokeStyle = "#1c6bb1";
    ctx.lineWidth = 2;
    ctx.stroke();

    scanStatus.textContent = "";
  } else {
    drawRoundedLabel(
      ctx,
      margin.left + (plotWidth / 2),
      margin.top + (plotHeight / 2),
      errorText,
      "rgba(255, 255, 255, 0.95)",
      "#e3b3b3",
      "#b33f3f",
    );
    scanStatus.textContent = "No scan available";
  }

  drawAxisTicks(ctx, {
    xTicks: [xMin, (xMin + xMax) / 2, xMax],
    yTicks: [0, 0.25, 0.5, 0.75, 1.0],
    mapX,
    mapY,
    plotLeft: margin.left,
    plotTop: margin.top,
    plotWidth,
    plotHeight,
    xFormatter: (tick) => formatNumber(tick, Math.abs(tick) < 10 ? 2 : 1),
    yFormatter: (tick) => formatNumber(tick, 2),
  });

  ctx.fillStyle = "#1f2933";
  ctx.font = "600 16px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText("Cavity Transmission vs Length Scan", width / 2, 22);
  ctx.font = "12px Segoe UI";
  ctx.fillStyle = "#5e6d7d";
  ctx.fillText("dL (FSR)", margin.left + (plotWidth / 2), height - 14);

  ctx.save();
  ctx.translate(margin.left - 38, margin.top + (plotHeight / 2));
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Normalized transmission", 0, 0);
  ctx.restore();
}

function updateSummary(simulationResult) {
  const [statusText] = stabilityLabel(cavityMode ? cavityMode.g1 : NaN, cavityMode ? cavityMode.g2 : NaN);
  const matched = matchedBeamDefaults();
  const rows = [
    ["R1", `${formatNumber(cavityState.r1Mm, 0)} mm`],
    ["R2", `${formatNumber(cavityState.r2Mm, 0)} mm`],
    ["Length", `${formatNumber(cavityState.lMm, 0)} mm`],
    ["Wavelength", `${formatNumber(cavityState.wavelengthNm, 0)} nm`],
    ["n_center", formatNumber(cavityState.nCenter, 2)],
    ["Status", cavityMode ? statusText : "Unavailable"],
    ["Matched waist", `${formatNumber(matched.beamWaistMm, 4)} mm`],
    ["Matched ROC", `${formatNumber(matched.beamRocMm, 0)} mm`],
    ["Beam waist", `${formatNumber(state.beamWaistMm, 4)} mm`],
    ["Beam ROC", `${formatNumber(state.beamRocMm, 0)} mm`],
    ["Offsets x / y um", `${formatNumber(state.xOffUm, 0)} / ${formatNumber(state.yOffUm, 0)}`],
    ["Scan / Max HG order", `${formatNumber(state.scanRangeFsr, 1)} FSR / ${state.nMax}`],
  ];

  if (cavityMode) {
    rows.push(["w(M1)", `${formatNumber(cavityMode.wM1 * 1e3, 4)} mm`]);
    rows.push(["w(M2)", `${formatNumber(cavityMode.wM2 * 1e3, 4)} mm`]);
  }

  if (simulationResult) {
    rows.push(["Peak dL", `${formatNumber(simulationResult.peakDetuningFsr, 3)} FSR`]);
    rows.push(["Image FOV", `${formatNumber(simulationResult.extentMm[1] - simulationResult.extentMm[0], 2)} mm`]);
  }

  simSummary.innerHTML = "";
  rows.forEach(([term, value]) => {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    wrapper.append(dt, dd);
    simSummary.appendChild(wrapper);
  });
}

function syncControl(key) {
  const def = SIM_DEFS.find((item) => item.key === key);
  const control = controlState.get(key);
  const isInteger = def.step === 1 && def.digits === 0;
  const value = isInteger
    ? clamp(Math.round(state[key]), def.min, def.max)
    : clamp(state[key], def.min, def.max);

  state[key] = value;
  control.slider.value = String(value);
  control.number.value = String(value);
}

function createControl(def) {
  const row = document.createElement("div");
  row.className = "control-row";

  const label = document.createElement("label");
  label.className = "control-label";
  label.textContent = def.unit ? `${def.label} [${def.unit}]` : def.label;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(def.min);
  slider.max = String(def.max);
  slider.step = String(def.step);

  const number = document.createElement("input");
  number.type = "number";
  number.step = String(def.step);

  row.append(label, slider, number);
  controlsRoot.appendChild(row);
  controlState.set(def.key, { slider, number });

  slider.addEventListener("input", () => {
    state[def.key] = Number(slider.value);
    number.value = String(state[def.key]);
    scheduleRender();
  });

  const handleNumberEdit = () => {
    if (!Number.isFinite(number.valueAsNumber)) {
      return;
    }
    state[def.key] = number.valueAsNumber;
    syncControl(def.key);
    scheduleRender();
  };

  number.addEventListener("change", handleNumberEdit);

  syncControl(def.key);
}

function scheduleRender() {
  if (renderPending) {
    return;
  }
  renderPending = true;
  window.requestAnimationFrame(() => {
    renderPending = false;
    render();
  });
}

function render() {
  SIM_DEFS.forEach((def) => syncControl(def.key));

  let simulationResult = null;
  let errorText = cavityError;

  if (!errorText) {
    try {
      simulationResult = simulateModeScan();
    } catch (error) {
      errorText = error.message;
    }
  }

  drawCameraPlot(simulationResult, errorText);
  drawScanPlot(simulationResult, errorText);
  updateSummary(simulationResult);

  if (errorText) {
    modeSimStatus.textContent = errorText;
  } else {
    modeSimStatus.textContent = "Beam is initialized to the cavity mode at mirror 1. Use Match cavity mode to restore it.";
  }
}

function resetToMatchedBeam() {
  const matched = matchedBeamDefaults();
  state.beamWaistMm = matched.beamWaistMm;
  state.beamRocMm = matched.beamRocMm;
  syncControl("beamWaistMm");
  syncControl("beamRocMm");
  scheduleRender();
}

function init() {
  SIM_DEFS.forEach(createControl);
  backToViewerLink.href = buildViewerUrl(window.location.href, cavityState);
  matchBeamButton.addEventListener("click", resetToMatchedBeam);
  matchBeamButton.disabled = Boolean(cavityError);
  window.addEventListener("resize", scheduleRender);
  render();
}

init();
