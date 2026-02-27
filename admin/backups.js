const statusEl = document.getElementById("status");
const table = document.getElementById("backupsTable");
const exportBtn = document.getElementById("exportBtn");
const searchInput = document.getElementById("searchInput");
const fromInput = document.getElementById("fromInput");
const toInput = document.getElementById("toInput");
const pageInfo = document.getElementById("pageInfo");

let currentPage = 1;
const pageSize = 20;
let totalItems = 0;

function setStatus(text, type = "") { statusEl.textContent = text; statusEl.className = `status ${type}`.trim(); }
function fmtDate(ms) { const d = new Date(Number(ms || 0)); return Number.isNaN(d.getTime()) ? "--" : d.toLocaleString(); }
function fmtSize(bytes) { const n = Number(bytes || 0); if (n < 1024) return `${n} B`; if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`; if (n < 1024*1024*1024) return `${(n/1024/1024).toFixed(2)} MB`; return `${(n/1024/1024/1024).toFixed(2)} GB`; }

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

async function exportDb() {
  const adminToken = localStorage.getItem("adminToken");
  setStatus("Exporting...", "info");
  exportBtn.disabled = true;
  try {
    const response = await fetch("/api/admin/export-db", {
      method: "GET",
      headers: { ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}) },
      credentials: "include"
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.message || "Failed to export database.");
    }

    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || `admin-export-${Date.now()}.db`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("DB exported.", "success");
    await loadBackups();
  } catch (error) {
    setStatus(error.message || "Failed to export.", "error");
  } finally {
    exportBtn.disabled = false;
  }
}

async function deleteBackup(name) {
  if (!confirm(`Delete backup ${name}?`)) return;
  try {
    setStatus("Deleting backup...", "info");
    await request("/api/admin/backups", { method: "DELETE", body: JSON.stringify({ filename: name }) });
    setStatus("Backup deleted.", "success");
    await loadBackups();
  } catch (error) {
    setStatus(error.message || "Failed to delete backup.", "error");
  }
}

function renderBackups(files) {
  table.innerHTML = "";
  for (const file of files || []) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${file.name}</td><td>${fmtSize(file.size)}</td><td>${fmtDate(file.modifiedAt)}</td><td><button class="btn small bad" type="button">Delete</button></td>`;
    row.querySelector("button")?.addEventListener("click", () => deleteBackup(file.name));
    table.appendChild(row);
  }
}

async function loadBackups() {
  setStatus("Loading...", "info");
  try {
    const query = new URLSearchParams({ page: String(currentPage), pageSize: String(pageSize) });
    const search = String(searchInput?.value || "").trim();
    const from = String(fromInput?.value || "").trim();
    const to = String(toInput?.value || "").trim();
    if (search) query.set("q", search);
    if (from) query.set("from", from);
    if (to) query.set("to", to);

    const data = await request(`/api/admin/backups?${query.toString()}`);
    renderBackups(data?.files || []);
    totalItems = Number(data?.total || 0);
    const pageMax = Math.max(1, Math.ceil(totalItems / pageSize));
    pageInfo.textContent = `Page ${currentPage}/${pageMax} · Total ${totalItems}`;
    setStatus(`Loaded ${data?.files?.length || 0} files.`, "success");
  } catch (error) {
    setStatus(error.message || "Failed to load backups.", "error");
  }
}

document.getElementById("refreshBtn")?.addEventListener("click", loadBackups);
document.getElementById("exportBtn")?.addEventListener("click", exportDb);
document.getElementById("applyBtn")?.addEventListener("click", () => { currentPage = 1; loadBackups(); });
document.getElementById("prevBtn")?.addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  loadBackups();
});
document.getElementById("nextBtn")?.addEventListener("click", () => {
  const pageMax = Math.max(1, Math.ceil(totalItems / pageSize));
  if (currentPage >= pageMax) return;
  currentPage += 1;
  loadBackups();
});
loadBackups();