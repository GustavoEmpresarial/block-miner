function showFeedback(target, message, type = "info") {
  if (!target) return;
  target.textContent = message;
  target.classList.remove("is-error", "is-success");
  if (type === "error") {
    target.classList.add("is-error");
  }
  if (type === "success") {
    target.classList.add("is-success");
  }
}

function notifyToast(message, type = "info") {
  if (typeof window.notify === "function") {
    window.notify(message, type);
  }
}

function normalizeUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function isValidUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getToken() {
  return localStorage.getItem("blockminer_token");
}

async function getUserIdFromSession() {
  const token = getToken();
  if (!token) return null;
  try {
    const response = await fetch("/api/auth/session", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.ok && data.user?.id) {
      return data.user.id;
    }
  } catch {
    // Ignore session lookup errors.
  }
  return null;
}

async function loadPromoHash() {
  const token = getToken();
  if (!token) {
    const ptpLinkInput = document.getElementById("ptpLink");
    if (ptpLinkInput) ptpLinkInput.value = "Error: not authenticated";
    return;
  }

  const ptpLinkInput = document.getElementById("ptpLink");
  
  try {
    // Try to get userId
    let userId = await getUserIdFromSession();
    
    // If userId is available, build a direct link
    if (userId) {
      const baseUrl = window.location.origin;
      if (ptpLinkInput) {
        ptpLinkInput.value = `${baseUrl}/ptp-r-${userId}`;
      }
      return;
    }

    // If userId is unavailable, fall back to promo hash
    const response = await fetch("/api/ptp/promo-hash", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    
    if (data.ok && data.promoLink) {
      if (ptpLinkInput) {
        ptpLinkInput.value = data.promoLink;
      }
    } else {
      if (ptpLinkInput) {
        ptpLinkInput.value = "Failed to load link";
      }
      showFeedback(
        document.getElementById("ptpLinkFeedback"),
        data.message || "Could not generate your promo link",
        "error"
      );
    }
  } catch (error) {
    console.error("Error loading promo hash:", error);
    if (ptpLinkInput) {
      ptpLinkInput.value = "Connection error";
    }
    showFeedback(
      document.getElementById("ptpLinkFeedback"),
      "Connection error. Please reload the page.",
      "error"
    );
  }
}

async function loadMyAds() {
  const token = getToken();
  if (!token) return;

  try {
    const response = await fetch("/api/ptp/my-ads", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.ok) {
      const adsList = document.getElementById("adsList");
      if (adsList) {
        if (data.ads.length === 0) {
          adsList.innerHTML = '<p style="text-align: center; color: #aebee1;">No ads created yet.</p>';
        } else {
          adsList.innerHTML = data.ads.map(ad => {
            const targetViews = Number.isFinite(Number(ad.target_views)) ? Number(ad.target_views) : "-";
            const costUsd = Number.isFinite(Number(ad.cost_usd || ad.paid_usd))
              ? Number(ad.cost_usd || ad.paid_usd).toFixed(2)
              : "0.00";
            const costAssetValue = Number.isFinite(Number(ad.cost_asset))
              ? Number(ad.cost_asset).toFixed(6)
              : "-";
            const assetLabel = "USDC";
            return `
            <div class="ad-item">
              <div class="ad-info">
                <strong>${ad.title}</strong>
                <p><small>${ad.url}</small></p>
                <p><small>Views: ${ad.views} / ${targetViews}</small></p>
                <p><small>Paid: $${costUsd} | ${costAssetValue} ${assetLabel}</small></p>
              </div>
            </div>
          `;
          }).join('');
        }
      }
      showFeedback(document.getElementById("manageAdsFeedback"), "", "info");
    } else {
      showFeedback(document.getElementById("manageAdsFeedback"), data.message || "Failed to load ads.", "error");
    }
  } catch (error) {
    showFeedback(document.getElementById("manageAdsFeedback"), "Failed to load ads.", "error");
    console.error("Error loading ads:", error);
  }
}

async function loadEarnings() {
  const token = getToken();
  if (!token) return;

  try {
    const response = await fetch("/api/ptp/earnings", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.ok) {
      const earningsDisplay = document.getElementById("earningsDisplay");
      const chart = document.getElementById("earningsChart");
      const chartAxis = document.getElementById("earningsChartAxis");
      if (earningsDisplay) {
        earningsDisplay.innerHTML = `
          <p>Total: <strong>$${data.totalUsd.toFixed(4)}</strong> (${Number(data.totalUsdc).toFixed(4)} USDC)</p>
        `;
      }
      if (chart && chartAxis) {
        const dailyTotals = Array.isArray(data.dailyTotals) ? data.dailyTotals : [];
        const maxValue = Math.max(0.0001, ...dailyTotals.map((d) => Number(d.totalUsd || 0)));
        chart.innerHTML = dailyTotals
          .map((day) => {
            const total = Number(day.totalUsd || 0);
            const height = Math.max(12, Math.round((total / maxValue) * 120));
            return `
              <div class="earnings-bar">
                <div class="earnings-bar-value">$${total.toFixed(4)}</div>
                <div class="earnings-bar-fill" style="height: ${height}px;"></div>
              </div>
            `;
          })
          .join("");

        chartAxis.innerHTML = dailyTotals
          .map((day) => `<div>${day.label}</div>`)
          .join("");
      }
      showFeedback(document.getElementById("earningsFeedback"), "", "info");
    } else {
      showFeedback(document.getElementById("earningsFeedback"), data.message || "Failed to load earnings.", "error");
    }
  } catch (error) {
    showFeedback(document.getElementById("earningsFeedback"), "Failed to load earnings.", "error");
    console.error("Error loading earnings:", error);
  }
}

async function createAd() {
  const token = getToken();
  if (!token) {
    showFeedback(document.getElementById("createAdFeedback"), "You need to be logged in.", "error");
    notifyToast("You need to be logged in.", "error");
    return;
  }

  const titleInput = document.getElementById("adTitle");
  const urlInput = document.getElementById("adUrl");
  const viewsInput = document.getElementById("adViews");
  const title = titleInput?.value.trim() || "";
  const urlRaw = urlInput?.value.trim() || "";
  const normalizedUrl = normalizeUrl(urlRaw);
  const viewsValue = Math.floor(Number(viewsInput?.value || 0));

  if (!title || !urlRaw) {
    showFeedback(document.getElementById("createAdFeedback"), "Enter a title and URL.", "error");
    return;
  }

  if (title.length < 3 || title.length > 120) {
    showFeedback(document.getElementById("createAdFeedback"), "Title must be 3-120 characters.", "error");
    return;
  }

  if (!isValidUrl(normalizedUrl)) {
    showFeedback(document.getElementById("createAdFeedback"), "Enter a valid URL (http/https).", "error");
    return;
  }

  if (!Number.isFinite(viewsValue) || viewsValue < 1 || viewsValue > 10000000) {
    showFeedback(document.getElementById("createAdFeedback"), "Number of views must be between 1 and 10,000,000.", "error");
    return;
  }

  try {
    const submitBtn = document.querySelector("#createAdForm .btn.primary");
    if (submitBtn) submitBtn.disabled = true;
    const response = await fetch("/api/ptp/create-ad", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ title, url: normalizedUrl, views: viewsValue })
    });
    const data = await response.json();
    if (data.ok) {
      showFeedback(document.getElementById("createAdFeedback"), "Ad created successfully.", "success");
      notifyToast("Ad created successfully.", "success");
      if (titleInput) titleInput.value = "";
      if (urlInput) urlInput.value = "";
      if (viewsInput) viewsInput.value = "";
      loadMyAds();
    } else {
      showFeedback(document.getElementById("createAdFeedback"), data.message || "Failed to create ad.", "error");
      notifyToast(data.message || "Failed to create ad.", "error");
    }
  } catch (error) {
    showFeedback(document.getElementById("createAdFeedback"), "Failed to create ad.", "error");
    notifyToast("Failed to create ad.", "error");
    console.error(error);
  } finally {
    const submitBtn = document.querySelector("#createAdForm .btn.primary");
    if (submitBtn) submitBtn.disabled = false;
  }
}

function copyPromoLink() {
  const ptpLink = document.getElementById("ptpLink");
  if (!ptpLink || !ptpLink.value) {
    notifyToast("Link is not available", "error");
    return;
  }

  const textToCopy = ptpLink.value;

  // Try Clipboard API first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        showFeedback(document.getElementById("ptpLinkFeedback"), "Link copied successfully.", "success");
        notifyToast("Link copied.", "success");
      })
      .catch(() => {
        // Fallback if Clipboard API fails
        fallbackCopy(textToCopy);
      });
  } else {
    // Fallback for browsers without Clipboard API
    fallbackCopy(textToCopy);
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);

  try {
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const success = document.execCommand("copy");
    
    if (success) {
      showFeedback(document.getElementById("ptpLinkFeedback"), "Link copied successfully.", "success");
      notifyToast("Link copied.", "success");
    } else {
      showFeedback(document.getElementById("ptpLinkFeedback"), "Failed to copy link", "error");
      notifyToast("Copy failed", "error");
    }
  } catch (e) {
    console.error("Copy error:", e);
    showFeedback(document.getElementById("ptpLinkFeedback"), "Failed to copy link", "error");
    notifyToast("Copy failed", "error");
  } finally {
    document.body.removeChild(textarea);
  }
}

// Initialize page on load
document.addEventListener("DOMContentLoaded", () => {
  loadPromoHash();
  loadMyAds();
  loadEarnings();

  const copyBtn = document.getElementById("copyPtpLink");
  if (copyBtn) {
    copyBtn.addEventListener("click", copyPromoLink);
  }

  const createAdForm = document.getElementById("createAdForm");
  if (createAdForm) {
    createAdForm.addEventListener("submit", (event) => {
      event.preventDefault();
      createAd();
    });
  }

  // Auto-refresh data every 30 seconds
  setInterval(() => {
    loadMyAds();
    loadEarnings();
  }, 30000);
});
