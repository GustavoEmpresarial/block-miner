(function initExternalNavbar() {
  const includeTarget = document.getElementById("externalNavbarInclude");
  if (!includeTarget) {
    return;
  }

  const loadInclude = (url) =>
    fetch(url, { cache: "no-store" }).then((response) => {
      if (!response.ok) {
        throw new Error(`Include failed: ${response.status}`);
      }
      return response.text();
    });

  loadInclude("/includes/external-navbar.html")
    .catch(() => loadInclude("./includes/external-navbar.html"))
    .then((html) => {
      includeTarget.innerHTML = html;
    })
    .catch((error) => {
      console.error("External navbar include failed", error);
    });
})();

(function loadLandingStats() {
  const usersEl = document.getElementById("statUsers");
  const paidEl = document.getElementById("statPaid");
  const daysEl = document.getElementById("statDays");

  if (!usersEl || !paidEl || !daysEl) {
    return;
  }

  fetch("/api/landing-stats")
    .then((response) => response.json())
    .then((payload) => {
      if (!payload?.ok) {
        return;
      }

      usersEl.textContent = Number(payload.registeredUsers || 0).toLocaleString("en-US");
      paidEl.textContent = `${Number(payload.totalPaid || 0).toLocaleString("en-US")} POL`;
      daysEl.textContent = Number(payload.daysOnline || 0).toLocaleString("en-US");
    })
    .catch(() => undefined);
})();

(function guardHeroVideoOnMobile() {
  const featureMedia = document.getElementById("featureMedia");
  if (!featureMedia) {
    return;
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isSmallScreen = window.matchMedia("(max-width: 760px)").matches;

  if (!prefersReducedMotion && !isSmallScreen) {
    return;
  }

  featureMedia.classList.add("is-static");
  const video = featureMedia.querySelector("video");
  if (video) {
    video.pause();
    video.removeAttribute("autoplay");
    video.remove();
  }
})();
