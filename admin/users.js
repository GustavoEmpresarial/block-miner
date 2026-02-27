const usersTable = document.getElementById("usersTable");
const usersStatus = document.getElementById("usersStatus");
const pageStatus = document.getElementById("pageStatus");
const detailsStatus = document.getElementById("detailsStatus");
const detailsGrid = document.getElementById("detailsGrid");
const txTable = document.getElementById("txTable");
const payoutTable = document.getElementById("payoutTable");
const userIdInput = document.getElementById("userIdInput");
const searchInput = document.getElementById("searchInput");
const fromInput = document.getElementById("fromInput");
const toInput = document.getElementById("toInput");
const pageInfo = document.getElementById("pageInfo");

let currentPage = 1;
const pageSize = 20;
let totalUsers = 0;

function setStatus(el, text, type = "") {
  if (!el) return;
  el.textContent = text;
  el.className = `status ${type}`.trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(ms) {
  const n = Number(ms || 0);
  if (!n) return "--";
  const date = new Date(n);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
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

async function request(url, options = {}) {
  const method = options?.method || "GET";
  const csrf = getCookie("blockminer_csrf");
  const adminToken = localStorage.getItem("adminToken");
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

function renderUsers(users) {
  usersTable.innerHTML = "";
  users.forEach((user) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(user.id)}</td>
      <td>${escapeHtml(user.email || "--")}</td>
      <td>${escapeHtml(user.username || user.name || "--")}</td>
      <td>${escapeHtml(user.ip || "--")}</td>
      <td>${Number(user.pool_balance || 0).toFixed(6)}</td>
      <td>${Number(user.faucet_claims || 0)}</td>
      <td>${Number(user.shortlink_daily_runs || 0)}</td>
      <td>${Number(user.auto_gpu_claims || 0)}</td>
      <td>${Number(user.youtube_claims || 0)}</td>
      <td>${Number(user.youtube_active_hash || 0).toFixed(2)}</td>
      <td><button class="btn small" data-id="${user.id}" type="button">Details</button></td>
    `;
    row.querySelector("button")?.addEventListener("click", () => loadUserDetails(user.id));
    usersTable.appendChild(row);
  });
}

function renderDetails(payload) {
  const { user, metrics } = payload;
  const cards = [
    ["User ID", user.id],
    ["Email", user.email || "--"],
    ["Username", user.username || user.name || "--"],
    ["Wallet", user.wallet_address || "--"],
    ["Pool balance", Number(user.pool_balance || 0).toFixed(6)],
    ["Base hash", Number(user.base_hash_rate || 0).toFixed(2)],
    ["Faucet claims", Number(metrics?.faucetClaims || 0)],
    ["Shortlink runs", Number(metrics?.shortlinkDailyRuns || 0)],
    ["Auto GPU claims", Number(metrics?.autoGpuClaims || 0)],
    ["YouTube claims", Number(metrics?.youtubeWatchClaims || 0)],
    ["YouTube active hash", `${Number(metrics?.youtubeWatchActiveHash || 0).toFixed(2)} GH/s`],
    ["YouTube hash granted", `${Number(metrics?.youtubeWatchTotalHashGranted || 0).toFixed(2)} GH/s`],
    ["Inventory items", Number(metrics?.inventoryItems || 0)],
    ["Active machines", Number(metrics?.activeMachines || 0)],
    ["Last login", formatDate(user.last_login_at)]
  ];

  detailsGrid.innerHTML = "";
  for (const [label, value] of cards) {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(String(value))}</div>`;
    detailsGrid.appendChild(card);
  }

  txTable.innerHTML = "";
  (payload.recentTransactions || []).forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${item.id}</td><td>${escapeHtml(item.type || "")}</td><td>${Number(item.amount || 0).toFixed(6)}</td><td>${escapeHtml(item.status || "")}</td><td>${escapeHtml(item.tx_hash || "--")}</td><td>${escapeHtml(formatDate(item.created_at))}</td>`;
    txTable.appendChild(row);
  });

  payoutTable.innerHTML = "";
  (payload.recentPayouts || []).forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${item.id}</td><td>${Number(item.amount_pol || 0).toFixed(6)}</td><td>${escapeHtml(item.source || "")}</td><td>${escapeHtml(item.tx_hash || "--")}</td><td>${escapeHtml(formatDate(item.created_at))}</td>`;
    payoutTable.appendChild(row);
  });
}

async function loadUsers() {
  setStatus(usersStatus, "Loading...", "info");
  try {
    const query = new URLSearchParams({
      page: String(currentPage),
      pageSize: String(pageSize)
    });

    const search = String(searchInput?.value || "").trim();
    const from = String(fromInput?.value || "").trim();
    const to = String(toInput?.value || "").trim();
    if (search) query.set("q", search);
    if (from) query.set("from", from);
    if (to) query.set("to", to);

    const data = await request(`/api/admin/users?${query.toString()}`);
    renderUsers(data?.users || []);
    totalUsers = Number(data?.total || 0);
    const pageMax = Math.max(1, Math.ceil(totalUsers / pageSize));
    pageInfo.textContent = `Page ${currentPage}/${pageMax} · Total ${totalUsers}`;
    setStatus(usersStatus, `Loaded ${data?.users?.length || 0} users.`, "success");
  } catch (error) {
    setStatus(usersStatus, error.message || "Failed to load users.", "error");
  }
}

async function loadUserDetails(id) {
  setStatus(detailsStatus, "Loading details...", "info");
  try {
    const data = await request(`/api/admin/users/${id}/details`);
    renderDetails(data);
    userIdInput.value = String(id);
    setStatus(detailsStatus, `Loaded user #${id}.`, "success");
  } catch (error) {
    setStatus(detailsStatus, error.message || "Failed to load user details.", "error");
  }
}

document.getElementById("loadDetailsBtn")?.addEventListener("click", () => {
  const id = Number(userIdInput?.value || 0);
  if (!Number.isInteger(id) || id <= 0) {
    setStatus(detailsStatus, "Invalid user id.", "error");
    return;
  }
  loadUserDetails(id);
});

document.getElementById("applyFilterBtn")?.addEventListener("click", () => {
  currentPage = 1;
  loadUsers();
});

document.getElementById("prevPageBtn")?.addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  loadUsers();
});

document.getElementById("nextPageBtn")?.addEventListener("click", () => {
  const pageMax = Math.max(1, Math.ceil(totalUsers / pageSize));
  if (currentPage >= pageMax) return;
  currentPage += 1;
  loadUsers();
});

document.getElementById("refreshBtn")?.addEventListener("click", () => {
  loadUsers();
  setStatus(pageStatus, "Refreshed.", "success");
});

loadUsers();