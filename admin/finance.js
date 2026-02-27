const statusEl = document.getElementById("status");
const overviewGrid = document.getElementById("overviewGrid");
const txTable = document.getElementById("txTable");
const payoutTable = document.getElementById("payoutTable");
const searchInput = document.getElementById("searchInput");
const typeInput = document.getElementById("typeInput");
const statusInput = document.getElementById("statusInput");
const fromInput = document.getElementById("fromInput");
const toInput = document.getElementById("toInput");
const pageInfo = document.getElementById("pageInfo");

let currentPage = 1;
const pageSize = 25;
let txTotal = 0;

function setStatus(text, type = "") { statusEl.textContent = text; statusEl.className = `status ${type}`.trim(); }
function fmtDate(ms) { const d = new Date(Number(ms || 0)); return Number.isNaN(d.getTime()) ? "--" : d.toLocaleString(); }
function fmt(value, digits = 6) { const n = Number(value || 0); return Number.isFinite(n) ? n.toFixed(digits) : "0"; }

function getCookie(name) {
  const parts = (document.cookie || "").split(";").map((p) => p.trim());
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

async function request(url, options = {}) {
  const method = options?.method || "GET";
  const adminToken = localStorage.getItem("adminToken");
  const csrf = getCookie("blockminer_csrf");
  const headers = {
    "Content-Type": "application/json",
    ...(method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && csrf ? { "X-CSRF-Token": csrf } : {}),
    ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {})
  };
  const response = await fetch(url, { headers, credentials: "include", ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminTokenExpiry");
    window.location.href = "/admin/login";
    return null;
  }
  if (!response.ok) throw new Error(data?.message || "Request failed");
  return data;
}

function renderOverview(overview) {
  const items = [
    ["Pool balance", fmt(overview.poolBalance)],
    ["Lifetime mined", fmt(overview.lifetimeMined)],
    ["Total payouts", fmt(overview.totalPaidPayouts)],
    ["Total withdrawn", fmt(overview.totalWithdrawn)],
    ["Pending withdrawals", fmt(overview.pendingWithdrawals)],
    ["Deposits (24h)", fmt(overview.deposits24h)]
  ];
  overviewGrid.innerHTML = "";
  for (const [label, value] of items) {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${value}</div>`;
    overviewGrid.appendChild(card);
  }
}

function renderTables(data) {
  txTable.innerHTML = "";
  for (const tx of data.transactions || []) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${tx.id}</td><td>${tx.user_id}</td><td>${tx.type}</td><td>${fmt(tx.amount)}</td><td>${tx.status}</td><td>${tx.tx_hash || "--"}</td><td>${fmtDate(tx.created_at)}</td>`;
    txTable.appendChild(row);
  }

  payoutTable.innerHTML = "";
  for (const p of data.payouts || []) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${p.id}</td><td>${p.user_id}</td><td>${fmt(p.amount_pol)}</td><td>${p.source || "--"}</td><td>${p.tx_hash || "--"}</td><td>${fmtDate(p.created_at)}</td>`;
    payoutTable.appendChild(row);
  }
}

async function loadAll() {
  setStatus("Loading...", "info");
  try {
    const query = new URLSearchParams({ page: String(currentPage), pageSize: String(pageSize) });
    const q = String(searchInput?.value || "").trim();
    const type = String(typeInput?.value || "").trim();
    const status = String(statusInput?.value || "").trim();
    const from = String(fromInput?.value || "").trim();
    const to = String(toInput?.value || "").trim();
    if (q) query.set("q", q);
    if (type) query.set("type", type);
    if (status) query.set("status", status);
    if (from) query.set("from", from);
    if (to) query.set("to", to);

    const [overviewData, activityData] = await Promise.all([
      request("/api/admin/finance/overview"),
      request(`/api/admin/finance/activity?${query.toString()}`)
    ]);
    renderOverview(overviewData?.overview || {});
    renderTables(activityData || {});
    txTotal = Number(activityData?.transactionsTotal || 0);
    const pageMax = Math.max(1, Math.ceil(txTotal / pageSize));
    pageInfo.textContent = `Page ${currentPage}/${pageMax} · Tx total ${txTotal}`;
    setStatus("Ready", "success");
  } catch (error) {
    setStatus(error.message || "Failed to load finance data.", "error");
  }
}

document.getElementById("refreshBtn")?.addEventListener("click", loadAll);
document.getElementById("applyBtn")?.addEventListener("click", () => { currentPage = 1; loadAll(); });
document.getElementById("prevBtn")?.addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  loadAll();
});
document.getElementById("nextBtn")?.addEventListener("click", () => {
  const pageMax = Math.max(1, Math.ceil(txTotal / pageSize));
  if (currentPage >= pageMax) return;
  currentPage += 1;
  loadAll();
});
loadAll();