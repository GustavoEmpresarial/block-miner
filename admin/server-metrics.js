const refreshButton = document.getElementById("refreshButton");
const statusMessage = document.getElementById("statusMessage");
const statsGrid = document.getElementById("statsGrid");
const historyInfo = document.getElementById("historyInfo");

const METRIC_HISTORY_LIMIT = 60;
const METRICS_REFRESH_INTERVAL_MS = 1000;
const metricHistory = {
  cpu: [],
  ram: [],
  disk: [],
  rssMb: []
};
let isLoadingMetrics = false;

const chartElements = {
  cpu: {
    svg: document.getElementById("cpuChart"),
    current: document.getElementById("cpuChartCurrent"),
    meta: document.getElementById("cpuChartMeta"),
    colorClass: "line-cpu"
  },
  ram: {
    svg: document.getElementById("ramChart"),
    current: document.getElementById("ramChartCurrent"),
    meta: document.getElementById("ramChartMeta"),
    colorClass: "line-ram"
  },
  disk: {
    svg: document.getElementById("diskChart"),
    current: document.getElementById("diskChartCurrent"),
    meta: document.getElementById("diskChartMeta"),
    colorClass: "line-disk"
  },
  rss: {
    svg: document.getElementById("rssChart"),
    current: document.getElementById("rssChartCurrent"),
    meta: document.getElementById("rssChartMeta"),
    colorClass: "line-rss"
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCookie(name) {
  const cookieString = document.cookie || "";
  const parts = cookieString.split(";").map((part) => part.trim());
  for (const part of parts) {
    if (!part) continue;
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex);
    if (key !== name) continue;
    return decodeURIComponent(part.slice(eqIndex + 1));
  }
  return null;
}

function setStatus(text, type = "") {
  if (!statusMessage) return;
  statusMessage.textContent = text;
  statusMessage.className = `status ${type}`.trim();
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${units[unitIndex]}`;
}

function formatPercent(value, digits = 2) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0.00%";
  return `${num.toFixed(digits)}%`;
}

function formatNumber(value, digits = 2) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  return num.toFixed(digits);
}

function pushHistoryValue(list, value) {
  if (!Array.isArray(list)) return;
  list.push(Number.isFinite(value) ? value : 0);
  if (list.length > METRIC_HISTORY_LIMIT) {
    list.splice(0, list.length - METRIC_HISTORY_LIMIT);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildPolylinePoints(values, options = {}) {
  const width = Number(options.width || 420);
  const height = Number(options.height || 150);
  const padding = Number(options.padding || 10);
  const minY = Number(options.minY || 0);
  const maxY = Number(options.maxY || 100);
  const points = [];

  if (!Array.isArray(values) || values.length === 0) {
    return points;
  }

  const span = Math.max(1, maxY - minY);
  const xStep = values.length <= 1 ? 0 : (width - padding * 2) / (values.length - 1);
  for (let index = 0; index < values.length; index += 1) {
    const rawValue = Number(values[index] || 0);
    const normalized = clamp((rawValue - minY) / span, 0, 1);
    const x = padding + xStep * index;
    const y = height - padding - normalized * (height - padding * 2);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }

  return points;
}

function renderChart(chart, values, config) {
  if (!chart?.svg || !chart.current || !chart.meta) return;
  if (!Array.isArray(values) || values.length === 0) {
    chart.current.textContent = "--";
    chart.meta.textContent = "--";
    chart.svg.innerHTML = "";
    return;
  }

  const latest = values[values.length - 1] || 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  let chartMin = Number.isFinite(config.minY) ? config.minY : min;
  let chartMax = Number.isFinite(config.maxY) ? config.maxY : max;

  if (chartMin === chartMax) {
    chartMax = chartMin + 1;
  }

  const points = buildPolylinePoints(values, {
    width: 420,
    height: 150,
    padding: 10,
    minY: chartMin,
    maxY: chartMax
  });

  const baseline = buildPolylinePoints([chartMin, chartMin], {
    width: 420,
    height: 150,
    padding: 10,
    minY: chartMin,
    maxY: chartMax
  });

  chart.svg.innerHTML = `
    <polyline class="chart-baseline" points="${baseline.join(" ")}" />
    <polyline class="chart-line ${chart.colorClass}" points="${points.join(" ")}" />
  `;

  chart.current.textContent = `${config.valueFormatter(latest)}`;
  chart.meta.textContent = `Min ${config.valueFormatter(min)} · Max ${config.valueFormatter(max)} · ${values.length} samples`;
}

function renderHistoryInfo() {
  if (!historyInfo) return;
  const count = metricHistory.cpu.length;
  if (count <= 0) {
    historyInfo.textContent = "Waiting for samples...";
    return;
  }

  const refreshSeconds = METRICS_REFRESH_INTERVAL_MS / 1000;
  historyInfo.textContent = `${count}/${METRIC_HISTORY_LIMIT} samples · update every ${refreshSeconds}s`;
}

function updateCharts(metrics) {
  const cpuPercent = Number(metrics.serverCpuUsagePercent || 0);
  const ramPercent = Number(metrics.serverMemoryUsagePercent || 0);
  const diskPercent = Number(metrics.serverDiskUsagePercent || 0);
  const rssMb = Number(metrics.processRssBytes || 0) / (1024 * 1024);

  pushHistoryValue(metricHistory.cpu, cpuPercent);
  pushHistoryValue(metricHistory.ram, ramPercent);
  pushHistoryValue(metricHistory.disk, diskPercent);
  pushHistoryValue(metricHistory.rssMb, rssMb);

  renderChart(chartElements.cpu, metricHistory.cpu, {
    minY: 0,
    maxY: 100,
    valueFormatter: (value) => formatPercent(value, 2)
  });

  renderChart(chartElements.ram, metricHistory.ram, {
    minY: 0,
    maxY: 100,
    valueFormatter: (value) => formatPercent(value, 2)
  });

  renderChart(chartElements.disk, metricHistory.disk, {
    minY: 0,
    maxY: 100,
    valueFormatter: (value) => formatPercent(value, 2)
  });

  const rssValues = metricHistory.rssMb;
  const rssMin = Math.min(...rssValues);
  const rssMax = Math.max(...rssValues);
  renderChart(chartElements.rss, rssValues, {
    minY: Math.max(0, rssMin - 5),
    maxY: rssMax + 5,
    valueFormatter: (value) => `${formatNumber(value, 1)} MB`
  });

  renderHistoryInfo();
}

async function request(url) {
  const adminToken = localStorage.getItem("adminToken");
  const csrf = getCookie("blockminer_csrf");
  const headers = {
    ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
    ...(csrf ? { "X-CSRF-Token": csrf } : {})
  };

  const response = await fetch(url, {
    method: "GET",
    headers,
    credentials: "include"
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminTokenExpiry");
    window.location.href = "/admin/login";
    return null;
  }

  if (!response.ok) {
    throw new Error(data?.message || "Request failed");
  }

  return data;
}

function renderMetrics(metrics) {
  if (!statsGrid) return;

  const loadLabel = metrics.serverLoadAvgSupported
    ? `${formatNumber(metrics.serverLoadAvg1m, 2)} / ${formatNumber(metrics.serverLoadAvg5m, 2)} / ${formatNumber(metrics.serverLoadAvg15m, 2)}`
    : "N/A on Windows";

  const sampledAt = metrics.sampledAt ? new Date(Number(metrics.sampledAt)).toLocaleString() : "--";

  const items = [
    ["Platform", metrics.platform || "--"],
    ["Sampled at", sampledAt],
    ["CPU usage", `${formatPercent(metrics.serverCpuUsagePercent)} (${Number(metrics.serverCpuCores || 0)} cores)`],
    ["Load avg (1m/5m/15m)", loadLabel],
    ["RAM used", `${formatBytes(metrics.serverMemoryUsedBytes)} / ${formatBytes(metrics.serverMemoryTotalBytes)} (${formatPercent(metrics.serverMemoryUsagePercent)})`],
    ["RAM free", formatBytes(metrics.serverMemoryFreeBytes)],
    ["Disk used", `${formatBytes(metrics.serverDiskUsedBytes)} / ${formatBytes(metrics.serverDiskTotalBytes)} (${formatPercent(metrics.serverDiskUsagePercent)})`],
    ["Disk free", formatBytes(metrics.serverDiskFreeBytes)],
    ["Node RSS", formatBytes(metrics.processRssBytes)],
    ["Node heap", `${formatBytes(metrics.processHeapUsedBytes)} / ${formatBytes(metrics.processHeapTotalBytes)}`],
    ["Node external", formatBytes(metrics.processExternalBytes)],
    ["Process uptime", `${formatNumber(metrics.processUptimeSeconds, 0)}s`]
  ];

  statsGrid.innerHTML = "";
  for (const [label, value] of items) {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(String(value ?? "--"))}</div>
    `;
    statsGrid.appendChild(card);
  }

  updateCharts(metrics);
}

async function loadMetrics() {
  if (isLoadingMetrics) return;
  isLoadingMetrics = true;
  setStatus("Loading...", "info");
  try {
    const data = await request("/api/admin/server-metrics");
    if (!data) return;
    renderMetrics(data.metrics || {});
    setStatus("Live", "success");
  } catch (error) {
    setStatus(error.message || "Failed to load metrics.", "error");
  } finally {
    isLoadingMetrics = false;
  }
}

refreshButton?.addEventListener("click", () => {
  loadMetrics();
});

loadMetrics();
setInterval(loadMetrics, METRICS_REFRESH_INTERVAL_MS);
