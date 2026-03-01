"use strict";

const {
  DEFAULT_CAVITY_STATE,
  clamp,
  formatNumber,
  computeCavityMode,
  stabilityLabel,
  readCavityStateFromSearch,
  buildModeScanUrl,
} = window.CavityCore;

const DEFAULT_STATE = {
  ...DEFAULT_CAVITY_STATE,
  yMaxMm: 0.5,
};

const geometryDefs = [
  { key: "r1Mm", label: "R1", min: 1, max: 1000, step: 1, unit: "mm" },
  { key: "r2Mm", label: "R2", min: 1, max: 1000, step: 1, unit: "mm" },
  { key: "lMm", label: "Length L", min: 1, max: 1000, step: 1, unit: "mm" },
];

const opticsDefs = [
  { key: "wavelengthNm", label: "Wavelength [nm]", min: 400, max: 2000, step: 1, unit: "nm" },
  { key: "nCenter", label: "n_center", min: 1.0, max: 3.0, step: 0.01, unit: "" },
  { key: "yMaxMm", label: "Y max", min: 0.01, max: 50.0, step: 0.01, unit: "mm" },
];

const state = {
  ...DEFAULT_STATE,
  ...readCavityStateFromSearch(window.location.search),
};
const centeredControlState = new Map();
const linearControls = new Map();

const geometryRoot = document.getElementById("geometryControls");
const opticsRoot = document.getElementById("opticsControls");
const summaryGrid = document.getElementById("summaryGrid");
const profileStatus = document.getElementById("profileStatus");
const stabilityStatus = document.getElementById("stabilityStatus");
const profileCanvas = document.getElementById("profileCanvas");
const stabilityCanvas = document.getElementById("stabilityCanvas");
const resetButton = document.getElementById("resetButton");
const openModeScanButton = document.getElementById("openModeScanButton");

function createCenteredControl(def) {
  const row = document.createElement("div");
  row.className = "control-row";

  const label = document.createElement("label");
  label.className = "control-label";
  label.textContent = def.label;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(def.min);
  slider.max = String(def.max);
  slider.step = String(def.step);

  const number = document.createElement("input");
  number.type = "number";
  number.min = String(def.min);
  number.max = String(def.max);
  number.step = String(def.step);

  row.append(label, slider, number);
  geometryRoot.appendChild(row);

  centeredControlState.set(def.key, { slider, number });

  slider.addEventListener("input", () => {
    state[def.key] = Number(slider.value);
    number.value = String(state[def.key]);
    render();
  });

  const handleNumberEdit = () => {
    if (!Number.isFinite(number.valueAsNumber)) {
      return;
    }
    state[def.key] = clamp(number.valueAsNumber, def.min, def.max);
    syncCenteredControl(def.key);
    render();
  };

  number.addEventListener("input", handleNumberEdit);
  number.addEventListener("change", handleNumberEdit);

  syncCenteredControl(def.key);
}

function createLinearControl(def) {
  const row = document.createElement("div");
  row.className = "control-row";

  const label = document.createElement("label");
  label.className = "control-label";
  label.textContent = def.label;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(def.min);
  slider.max = String(def.max);
  slider.step = String(def.step);

  const number = document.createElement("input");
  number.type = "number";
  number.min = String(def.min);
  number.max = String(def.max);
  number.step = String(def.step);

  row.append(label, slider, number);
  opticsRoot.appendChild(row);

  linearControls.set(def.key, { slider, number });

  slider.addEventListener("input", () => {
    state[def.key] = Number(slider.value);
    number.value = String(state[def.key]);
    render();
  });

  const handleNumberEdit = () => {
    if (!Number.isFinite(number.valueAsNumber)) {
      return;
    }
    state[def.key] = clamp(number.valueAsNumber, def.min, def.max);
    syncLinearControl(def.key);
    render();
  };

  number.addEventListener("input", handleNumberEdit);
  number.addEventListener("change", handleNumberEdit);

  syncLinearControl(def.key);
}

function syncCenteredControl(key) {
  const control = centeredControlState.get(key);
  const def = geometryDefs.find((item) => item.key === key);
  const value = clamp(Math.round(state[key]), def.min, def.max);
  state[key] = value;
  control.slider.min = String(def.min);
  control.slider.max = String(def.max);
  control.slider.value = String(value);
  control.number.value = String(value);
}

function syncLinearControl(key) {
  const control = linearControls.get(key);
  const value = state[key];
  control.slider.value = String(value);
  control.number.value = String(value);
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(320, Math.round(rect.width));
  const cssHeight = Math.max(260, Math.round(rect.height));
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
  const boxWidth = textWidth + padX * 2;
  const boxHeight = 28;
  const left = x - boxWidth / 2;
  const top = y - boxHeight / 2;
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
    margin,
    plotW,
    plotH,
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
    ctx.moveTo(x, margin.top + plotH);
    ctx.lineTo(x, margin.top + plotH + 6);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(xFormatter(tick), x, margin.top + plotH + 9);
  });

  yTicks.forEach((tick) => {
    const y = mapY(tick);
    ctx.beginPath();
    ctx.moveTo(margin.left - 6, y);
    ctx.lineTo(margin.left, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(yFormatter(tick), margin.left - 10, y);
  });

  ctx.restore();
}

function drawProfilePlot(mode, errorText, inputs) {
  const { ctx, width, height } = setupCanvas(profileCanvas);
  ctx.clearRect(0, 0, width, height);

  const margin = { left: 56, right: 20, top: 38, bottom: 44 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const lMm = inputs.length * 1e3;
  const xPadMm = 0.05 * lMm;
  const mirrorW = 0.001 * lMm;
  const yLim = Math.max(0.05, inputs.yMaxMm * 1.1);
  const xMin = -xPadMm;
  const xMax = lMm + xPadMm;
  const yMin = -yLim;
  const yMax = yLim;

  const mapX = (value) => margin.left + ((value - xMin) / (xMax - xMin)) * plotW;
  const mapY = (value) => margin.top + (1 - (value - yMin) / (yMax - yMin)) * plotH;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#eaf4ff";
  ctx.fillRect(mapX(xMin), margin.top, mapX(0) - mapX(xMin), plotH);
  ctx.fillRect(mapX(lMm), margin.top, mapX(xMax) - mapX(lMm), plotH);
  ctx.fillStyle = "#fff6dc";
  ctx.fillRect(mapX(0), margin.top, mapX(lMm) - mapX(0), plotH);

  ctx.strokeStyle = "rgba(90, 112, 138, 0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i += 1) {
    const gx = margin.left + (i / 6) * plotW;
    const gy = margin.top + (i / 6) * plotH;
    ctx.beginPath();
    ctx.moveTo(gx, margin.top);
    ctx.lineTo(gx, margin.top + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(margin.left, gy);
    ctx.lineTo(margin.left + plotW, gy);
    ctx.stroke();
  }

  const zeroY = mapY(0);
  ctx.strokeStyle = "rgba(31, 41, 51, 0.3)";
  ctx.beginPath();
  ctx.moveTo(margin.left, zeroY);
  ctx.lineTo(margin.left + plotW, zeroY);
  ctx.stroke();

  if (mode) {
    const zMm = mode.z.map((value) => value * 1e3);
    const wMm = mode.w.map((value) => value * 1e3);

    ctx.beginPath();
    ctx.moveTo(mapX(zMm[0]), mapY(wMm[0]));
    for (let i = 1; i < zMm.length; i += 1) {
      ctx.lineTo(mapX(zMm[i]), mapY(wMm[i]));
    }
    for (let i = zMm.length - 1; i >= 0; i -= 1) {
      ctx.lineTo(mapX(zMm[i]), mapY(-wMm[i]));
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(70, 130, 180, 0.24)";
    ctx.fill();

    ctx.strokeStyle = "steelblue";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mapX(zMm[0]), mapY(wMm[0]));
    for (let i = 1; i < zMm.length; i += 1) {
      ctx.lineTo(mapX(zMm[i]), mapY(wMm[i]));
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(mapX(zMm[0]), mapY(-wMm[0]));
    for (let i = 1; i < zMm.length; i += 1) {
      ctx.lineTo(mapX(zMm[i]), mapY(-wMm[i]));
    }
    ctx.stroke();

    const zWaistMm = mode.zWaist * 1e3;
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = "crimson";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(mapX(zWaistMm), margin.top);
    ctx.lineTo(mapX(zWaistMm), margin.top + plotH);
    ctx.stroke();
    ctx.restore();

    drawRoundedLabel(
      ctx,
      margin.left + plotW / 2,
      margin.top + 16,
      `Waist position: ${formatNumber(zWaistMm, 2)} mm    Waist radius: ${formatNumber(mode.w0 * 1e3, 4)} mm`,
      "rgba(255, 255, 255, 0.95)",
      "#d3dbe6",
      "#1f2933",
    );
  } else if (errorText) {
    drawRoundedLabel(
      ctx,
      margin.left + plotW / 2,
      margin.top + 16,
      errorText,
      "rgba(255, 255, 255, 0.95)",
      "#e3b3b3",
      "#b33f3f",
    );
  }

  const mirrorH = Math.max(0.05, inputs.yMaxMm);
  const leftX = mapX(-mirrorW);
  const cavityLeft = mapX(0);
  const cavityRight = mapX(lMm);
  const rightX = mapX(lMm + mirrorW);
  const mirrorTop = mapY(mirrorH);
  const mirrorBottom = mapY(-mirrorH);
  const mirrorHeight = mirrorBottom - mirrorTop;

  ctx.fillStyle = "#4f5d6b";
  ctx.strokeStyle = "#3c4854";
  ctx.lineWidth = 1;
  ctx.fillRect(leftX, mirrorTop, cavityLeft - leftX, mirrorHeight);
  ctx.strokeRect(leftX, mirrorTop, cavityLeft - leftX, mirrorHeight);
  ctx.fillRect(cavityRight, mirrorTop, rightX - cavityRight, mirrorHeight);
  ctx.strokeRect(cavityRight, mirrorTop, rightX - cavityRight, mirrorHeight);

  ctx.strokeStyle = "rgba(97, 115, 137, 0.45)";
  ctx.strokeRect(margin.left, margin.top, plotW, plotH);

  const xTicks = [];
  for (let i = 0; i <= 4; i += 1) {
    xTicks.push(xMin + ((xMax - xMin) * i) / 4);
  }
  const yTicks = [];
  for (let i = 0; i <= 4; i += 1) {
    yTicks.push(yMin + ((yMax - yMin) * i) / 4);
  }
  drawAxisTicks(ctx, {
    xTicks,
    yTicks,
    mapX,
    mapY,
    margin,
    plotW,
    plotH,
    xFormatter: (tick) => formatNumber(tick, Math.abs(tick) < 10 ? 1 : 0),
    yFormatter: (tick) => formatNumber(tick, 2),
  });

  ctx.fillStyle = "#1f2933";
  ctx.font = "600 16px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText("Cavity Mode Profile (side view)", width / 2, 22);
  ctx.font = "12px Segoe UI";
  ctx.fillStyle = "#5e6d7d";
  ctx.fillText("z (mm)", margin.left + plotW / 2, height - 14);

  ctx.save();
  ctx.translate(margin.left - 38, margin.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("y (mm)", 0, 0);
  ctx.restore();

  const modeText = mode
    ? `w(M1) ${formatNumber(mode.wM1 * 1e3, 4)} mm, w(M2) ${formatNumber(mode.wM2 * 1e3, 4)} mm`
    : "Mode not defined for this geometry";
  profileStatus.textContent = modeText;
}

function drawStar(ctx, cx, cy, radius, color) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function traceHyperbolaBranch(ctx, mapX, mapY, xStart, xEnd, samples) {
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const x = xStart + (xEnd - xStart) * t;
    const y = 1 / x;
    ctx.lineTo(mapX(x), mapY(y));
  }
}

function fillStabilityRegions(ctx, mapX, mapY, bounds, colors, samples) {
  const { xMin, xMax, yMin, yMax } = bounds;
  const { unstable, stable } = colors;
  const positiveTurn = Math.min(xMax, Math.max(0, 1 / yMax));
  const negativeTurn = Math.max(xMin, Math.min(0, 1 / yMin));

  ctx.save();
  ctx.beginPath();
  ctx.rect(mapX(xMin), mapY(yMax), mapX(xMax) - mapX(xMin), mapY(yMin) - mapY(yMax));
  ctx.clip();

  ctx.fillStyle = unstable;
  ctx.fillRect(mapX(xMin), mapY(yMax), mapX(xMax) - mapX(xMin), mapY(yMin) - mapY(yMax));

  ctx.fillStyle = stable;

  ctx.beginPath();
  ctx.moveTo(mapX(0), mapY(0));
  ctx.lineTo(mapX(0), mapY(yMax));
  if (positiveTurn >= xMax) {
    ctx.lineTo(mapX(xMax), mapY(yMax));
  } else {
    ctx.lineTo(mapX(positiveTurn), mapY(yMax));
    traceHyperbolaBranch(ctx, mapX, mapY, positiveTurn, xMax, samples);
  }
  ctx.lineTo(mapX(xMax), mapY(0));
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(mapX(0), mapY(0));
  ctx.lineTo(mapX(0), mapY(yMin));
  if (negativeTurn <= xMin) {
    ctx.lineTo(mapX(xMin), mapY(yMin));
  } else {
    ctx.lineTo(mapX(negativeTurn), mapY(yMin));
    traceHyperbolaBranch(ctx, mapX, mapY, negativeTurn, xMin, samples);
  }
  ctx.lineTo(mapX(xMin), mapY(0));
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawStabilityPlot(g1, g2) {
  const { ctx, width, height } = setupCanvas(stabilityCanvas);
  ctx.clearRect(0, 0, width, height);

  const margin = { left: 58, right: 18, top: 34, bottom: 48 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const xMin = -1.6;
  const xMax = 1.6;
  const yMin = -1.6;
  const yMax = 1.6;

  const mapX = (value) => margin.left + ((value - xMin) / (xMax - xMin)) * plotW;
  const mapY = (value) => margin.top + (1 - (value - yMin) / (yMax - yMin)) * plotH;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  fillStabilityRegions(
    ctx,
    mapX,
    mapY,
    { xMin, xMax, yMin, yMax },
    { unstable: "#ffd6d6", stable: "#d5efd5" },
    Math.max(120, Math.round(plotW * 0.6)),
  );

  ctx.strokeStyle = "rgba(90, 112, 138, 0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i += 1) {
    const gx = margin.left + (i / 8) * plotW;
    const gy = margin.top + (i / 8) * plotH;
    ctx.beginPath();
    ctx.moveTo(gx, margin.top);
    ctx.lineTo(gx, margin.top + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(margin.left, gy);
    ctx.lineTo(margin.left + plotW, gy);
    ctx.stroke();
  }

  ctx.strokeStyle = "darkgreen";
  ctx.lineWidth = 2;
  for (const direction of [1, -1]) {
    let started = false;
    ctx.beginPath();
    for (let x = 0.05; x <= 1.6; x += 0.01) {
      const gx = direction * x;
      const gy = 1 / gx;
      if (gy < yMin || gy > yMax) {
        continue;
      }
      const px = mapX(gx);
      const py = mapY(gy);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }

  ctx.strokeStyle = "#1f2933";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(mapX(0), margin.top);
  ctx.lineTo(mapX(0), margin.top + plotH);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(margin.left, mapY(0));
  ctx.lineTo(margin.left + plotW, mapY(0));
  ctx.stroke();

  drawStar(ctx, mapX(g1), mapY(g2), 10, "#c62828");

  const [statusText, statusColor] = stabilityLabel(g1, g2);
  drawRoundedLabel(
    ctx,
    margin.left + plotW / 2,
    margin.top + plotH - 20,
    statusText,
    "rgba(255, 255, 255, 0.95)",
    "#d3dbe6",
    statusColor,
  );

  ctx.strokeStyle = "rgba(97, 115, 137, 0.45)";
  ctx.strokeRect(margin.left, margin.top, plotW, plotH);

  const xTicks = [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5];
  const yTicks = [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5];
  drawAxisTicks(ctx, {
    xTicks,
    yTicks,
    mapX,
    mapY,
    margin,
    plotW,
    plotH,
    xFormatter: (tick) => formatNumber(tick, 1),
    yFormatter: (tick) => formatNumber(tick, 1),
  });

  ctx.fillStyle = "#1f2933";
  ctx.font = "600 16px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText("Cavity Stability Diagram", width / 2, 22);
  ctx.font = "12px Segoe UI";
  ctx.fillStyle = "#5e6d7d";
  ctx.fillText("g1 = 1 - L/R1", margin.left + plotW / 2, height - 14);

  ctx.save();
  ctx.translate(margin.left - 38, margin.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("g2 = 1 - L/R2", 0, 0);
  ctx.restore();

  stabilityStatus.textContent = `Current (${formatNumber(g1, 3)}, ${formatNumber(g2, 3)})`;
}

function updateSummary(mode, errorText, g1, g2) {
  const rows = [
    ["R1", `${state.r1Mm.toFixed(0)} mm`],
    ["R2", `${state.r2Mm.toFixed(0)} mm`],
    ["Length", `${state.lMm.toFixed(0)} mm`],
    ["Wavelength", `${state.wavelengthNm.toFixed(0)} nm`],
    ["g1", formatNumber(g1, 4)],
    ["g2", formatNumber(g2, 4)],
    ["Status", stabilityLabel(g1, g2)[0]],
    ["n_center", formatNumber(state.nCenter, 2)],
  ];

  if (mode) {
    rows.push(["Waist z", `${formatNumber(mode.zWaist * 1e3, 2)} mm`]);
    rows.push(["Waist radius", `${formatNumber(mode.w0 * 1e3, 4)} mm`]);
    rows.push(["Rayleigh range", `${formatNumber(mode.zR * 1e3, 2)} mm`]);
    rows.push(["Waist at Mirror1", `${formatNumber(mode.wM1 * 1e3, 4)} mm`]);
    rows.push(["Waist at Mirror2", `${formatNumber(mode.wM2 * 1e3, 4)} mm`]);
  } else {
    rows.push(["Mode", "Unavailable"]);
    rows.push(["Reason", errorText || "Unknown"]);
  }

  summaryGrid.innerHTML = "";
  rows.forEach(([term, value]) => {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    wrapper.append(dt, dd);
    summaryGrid.appendChild(wrapper);
  });
}

function render() {
  geometryDefs.forEach((def) => syncCenteredControl(def.key));
  opticsDefs.forEach((def) => syncLinearControl(def.key));

  const r1 = state.r1Mm * 1e-3;
  const r2 = state.r2Mm * 1e-3;
  const length = state.lMm * 1e-3;
  const wavelength = state.wavelengthNm * 1e-9;
  const nCenter = state.nCenter;
  const g1 = 1 - length / r1;
  const g2 = 1 - length / r2;

  let mode = null;
  let errorText = null;
  try {
    mode = computeCavityMode(r1, r2, length, wavelength, nCenter);
  } catch (error) {
    errorText = error.message;
  }

  drawProfilePlot(mode, errorText, { length, yMaxMm: state.yMaxMm });
  drawStabilityPlot(g1, g2);
  updateSummary(mode, errorText, g1, g2);
}

function resetDefaults() {
  Object.assign(state, DEFAULT_STATE);
  geometryDefs.forEach((def) => syncCenteredControl(def.key));
  opticsDefs.forEach((def) => syncLinearControl(def.key));
  render();
}

function openModeScan() {
  window.location.href = buildModeScanUrl(window.location.href, state);
}

function init() {
  geometryDefs.forEach(createCenteredControl);
  opticsDefs.forEach(createLinearControl);
  resetButton.addEventListener("click", resetDefaults);
  openModeScanButton.addEventListener("click", openModeScan);
  window.addEventListener("resize", render);
  render();
}

init();
