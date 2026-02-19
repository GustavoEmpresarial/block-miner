const referralLink = document.getElementById("referralLink");
const referralCode = document.getElementById("referralCode");
const referralStatus = document.getElementById("referralStatus");
const copyLinkBtn = document.getElementById("copyLinkBtn");

function getToken() {
  return localStorage.getItem("blockminer_token");
}

function setStatus(message, isError = false) {
  if (!referralStatus) return;
  referralStatus.textContent = message;
  referralStatus.style.color = isError ? "#ff8b8b" : "";
}

function buildLink(code) {
  const base = window.location.origin;
  return `${base}/r-${encodeURIComponent(code)}`;
}

async function loadReferral() {
  const token = getToken();
  if (!token) {
    window.location.href = "/login";
    return;
  }

  try {
    setStatus("Loading...");
    const response = await fetch("/api/auth/referral", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const payload = await response.json();
    if (!response.ok || !payload?.ok || !payload.refCode) {
      setStatus(payload?.message || "Unable to load referral.", true);
      return;
    }

    if (referralCode) {
      referralCode.textContent = payload.refCode;
    }

    if (referralLink) {
      referralLink.value = buildLink(payload.refCode);
    }

    setStatus("Ready");
  } catch {
    setStatus("Network error.", true);
  }
}

async function copyReferralLink() {
  if (!referralLink?.value) {
    window.notify?.("Referral link not ready yet.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(referralLink.value);
    window.notify?.("Referral link copied!", "success");
  } catch {
    referralLink.select();
    referralLink.setSelectionRange(0, referralLink.value.length);
    const success = document.execCommand("copy");
    if (success) {
      window.notify?.("Referral link copied!", "success");
    } else {
      window.notify?.("Unable to copy. Please copy manually.", "error");
    }
  }
}

copyLinkBtn?.addEventListener("click", copyReferralLink);
loadReferral();
