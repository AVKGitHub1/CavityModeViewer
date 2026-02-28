"use strict";

const DEFAULT_STATE = {
  r1Mm: 50,
  r2Mm: 50,
  lMm: 40,
  wavelengthNm: 780,
  nCenter: 1.0,
  yMaxMm: 0.5,
};

const EXACT_TOL = 1e-3;
const NEAR_TOL = 0.08;

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

const state = { ...DEFAULT_STATE };
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits);
}

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

  const prop = (d) => [
    [1, d],
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
  ctx.translate(16, margin.top + plotH / 2);
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

  const bg = ctx.createImageData(Math.max(1, Math.round(plotW)), Math.max(1, Math.round(plotH)));
  for (let py = 0; py < bg.height; py += 1) {
    const gy = yMax - ((py + 0.5) / bg.height) * (yMax - yMin);
    for (let px = 0; px < bg.width; px += 1) {
      const gx = xMin + ((px + 0.5) / bg.width) * (xMax - xMin);
      const stable = gx * gy >= 0 && gx * gy <= 1;
      const index = (py * bg.width + px) * 4;
      bg.data[index] = stable ? 213 : 255;
      bg.data[index + 1] = stable ? 239 : 214;
      bg.data[index + 2] = stable ? 213 : 214;
      bg.data[index + 3] = 255;
    }
  }
  ctx.putImageData(bg, margin.left, margin.top);

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
  ctx.translate(16, margin.top + plotH / 2);
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

function init() {
  geometryDefs.forEach(createCenteredControl);
  opticsDefs.forEach(createLinearControl);
  resetButton.addEventListener("click", resetDefaults);
  window.addEventListener("resize", render);
  render();
}

init();
