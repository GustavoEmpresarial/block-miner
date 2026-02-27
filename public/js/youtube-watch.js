const youtubeUrlInput = document.getElementById("youtubeUrlInput");
const loadVideoBtn = document.getElementById("loadVideoBtn");
const youtubeFrame = document.getElementById("youtubeFrame");
const startWatchBtn = document.getElementById("startWatchBtn");
const stopWatchBtn = document.getElementById("stopWatchBtn");
const nextClaimTimer = document.getElementById("nextClaimTimer");
const rewardPerMinute = document.getElementById("rewardPerMinute");
const rewardDuration = document.getElementById("rewardDuration");
const activeYoutubeHash = document.getElementById("activeYoutubeHash");
const claims24h = document.getElementById("claims24h");
const hashGranted24h = document.getElementById("hashGranted24h");
const claimsTotal = document.getElementById("claimsTotal");
const hashGrantedTotal = document.getElementById("hashGrantedTotal");
const watchStatus = document.getElementById("watchStatus");

const state = {
  isRunning: false,
  countdown: 60,
  timerId: null,
  requestInFlight: false,
  videoLoaded: false,
  currentVideoId: null
};

function setStatus(message, type = "") {
  watchStatus.textContent = message;
  watchStatus.classList.remove("error", "success");
  if (type) {
    watchStatus.classList.add(type);
  }
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "--";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) {
    return `${seconds}s`;
  }
  return `${minutes} min`;
}

function extractYouTubeVideoId(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return null;
  }

  const idPattern = /^[a-zA-Z0-9_-]{11}$/;
  if (idPattern.test(raw)) {
    return raw;
  }

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      const shortId = url.pathname.split("/").filter(Boolean)[0] || "";
      return idPattern.test(shortId) ? shortId : null;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") {
        const queryId = url.searchParams.get("v") || "";
        return idPattern.test(queryId) ? queryId : null;
      }

      if (url.pathname.startsWith("/embed/")) {
        const embedId = url.pathname.split("/")[2] || "";
        return idPattern.test(embedId) ? embedId : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function updateTimerUI() {
  nextClaimTimer.textContent = `${Math.max(0, state.countdown)}s`;
}

async function fetchStatus() {
  try {
    const response = await fetch("/api/games/youtube/status", { credentials: "include" });
    const payload = await response.json();

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.message || "Unable to load YouTube reward status.");
    }

    rewardPerMinute.textContent = `${Number(payload.rewardGh || 0).toFixed(2)} GH/s`;
    rewardDuration.textContent = formatDuration(Number(payload.rewardDurationSeconds || 0));
    activeYoutubeHash.textContent = `${Number(payload.activeHashRate || 0).toFixed(2)} GH/s`;

    const remainingSeconds = Number(payload.nextClaimInSeconds || 0);
    state.countdown = remainingSeconds > 0 ? remainingSeconds : 60;
    updateTimerUI();
  } catch (error) {
    setStatus(error.message || "Unable to load status.", "error");
  }
}

async function fetchUserStats() {
  try {
    const response = await fetch("/api/games/youtube/stats", { credentials: "include" });
    const payload = await response.json();

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.message || "Unable to load YouTube stats.");
    }

    if (claims24h) claims24h.textContent = String(Number(payload.claims24h || 0));
    if (hashGranted24h) hashGranted24h.textContent = `${Number(payload.hashGranted24h || 0).toFixed(2)} GH/s`;
    if (claimsTotal) claimsTotal.textContent = String(Number(payload.claimsTotal || 0));
    if (hashGrantedTotal) hashGrantedTotal.textContent = `${Number(payload.hashGrantedTotal || 0).toFixed(2)} GH/s`;
  } catch {
    // silent stats failure
  }
}

async function claimMinuteReward() {
  if (state.requestInFlight) {
    return;
  }
  state.requestInFlight = true;

  try {
    const response = await fetch("/api/games/youtube/claim", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ videoId: state.currentVideoId || undefined })
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      const remaining = Number(payload?.nextClaimInSeconds || 0);
      if (remaining > 0) {
        state.countdown = remaining;
        updateTimerUI();
      }
      throw new Error(payload?.message || "Unable to claim YouTube reward.");
    }

    activeYoutubeHash.textContent = `${Number(payload.activeHashRate || 0).toFixed(2)} GH/s`;
    rewardPerMinute.textContent = `${Number(payload.rewardGh || 0).toFixed(2)} GH/s`;
    rewardDuration.textContent = formatDuration(Number(payload.rewardDurationSeconds || 0));
    state.countdown = 60;
    updateTimerUI();
    setStatus(`+${Number(payload.rewardGh || 0).toFixed(2)} GH/s applied. Keep watching for the next claim.`, "success");
    await fetchUserStats();
  } catch (error) {
    setStatus(error.message || "Claim failed.", "error");
  } finally {
    state.requestInFlight = false;
  }
}

function stopWatchMode(message = "Watch mode stopped.") {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
  state.isRunning = false;
  startWatchBtn.disabled = false;
  stopWatchBtn.disabled = true;
  setStatus(message);
}

function startWatchMode() {
  if (!state.videoLoaded) {
    setStatus("Load a YouTube video first.", "error");
    return;
  }

  if (state.isRunning) {
    return;
  }

  state.isRunning = true;
  startWatchBtn.disabled = true;
  stopWatchBtn.disabled = false;
  setStatus("Watch mode active. A claim is attempted every 60 seconds while this page is open.");

  state.timerId = setInterval(async () => {
    if (!state.isRunning) {
      return;
    }

    if (document.hidden) {
      setStatus("Watch mode paused while tab is hidden.");
      return;
    }

    state.countdown -= 1;
    if (state.countdown <= 0) {
      await claimMinuteReward();
      return;
    }

    updateTimerUI();
  }, 1000);
}

loadVideoBtn.addEventListener("click", () => {
  const videoId = extractYouTubeVideoId(youtubeUrlInput.value);
  if (!videoId) {
    setStatus("Invalid YouTube URL or video ID.", "error");
    return;
  }

  const origin = encodeURIComponent(window.location.origin);
  youtubeFrame.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1&origin=${origin}`;
  state.videoLoaded = true;
  state.currentVideoId = videoId;
  setStatus("Video loaded. Click Start Watch Mode to begin earning.", "success");
});

startWatchBtn.addEventListener("click", startWatchMode);
stopWatchBtn.addEventListener("click", () => stopWatchMode());

document.addEventListener("visibilitychange", () => {
  if (!state.isRunning) {
    return;
  }

  if (document.hidden) {
    setStatus("Watch mode paused while tab is hidden.");
  } else {
    setStatus("Watch mode resumed.");
  }
});

fetchStatus();
fetchUserStats();
updateTimerUI();
