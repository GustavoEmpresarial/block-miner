(function initLayout() {
  const getCookie = (name) => {
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
  };

  const isUnsafeMethod = (method) => {
    const m = String(method || "GET").toUpperCase();
    return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
  };

  // Add CSRF header automatically for cookie-authenticated unsafe requests.
  // The server enforces CSRF only when Authorization: Bearer is NOT present.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    try {
      const url = typeof input === "string" ? input : input?.url;
      const isSameOrigin = !url || url.startsWith("/") || url.startsWith(window.location.origin);
      const method = init?.method || (typeof input !== "string" ? input?.method : "GET") || "GET";
      const headers = new Headers(init?.headers || (typeof input !== "string" ? input?.headers : undefined) || {});
      const hasAuth = headers.has("Authorization") || headers.has("authorization");

      if (isSameOrigin && isUnsafeMethod(method) && !hasAuth) {
        const csrf = getCookie("blockminer_csrf");
        if (csrf) {
          headers.set("X-CSRF-Token", csrf);
        }
      }

      return originalFetch(input, { ...init, headers });
    } catch {
      return originalFetch(input, init);
    }
  };

  const ensureToastContainer = () => {
    let container = document.querySelector(".app-toasts");
    if (!container) {
      container = document.createElement("div");
      container.className = "app-toasts";
      document.body.appendChild(container);
    }
    return container;
  };

  const notify = (message, type = "info", durationMs = 3200) => {
    if (!message) {
      return;
    }

    const container = ensureToastContainer();
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "status");
    toast.textContent = message;

    container.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add("toast-hide");
    }, Math.max(1000, durationMs - 400));

    window.setTimeout(() => {
      toast.remove();
    }, durationMs);
  };

  window.notify = notify;

  const includeTarget = document.getElementById("layoutInclude");
  if (!includeTarget) {
    return;
  }

  fetch("/includes/internal-navbar.html")
    .then((response) => response.text())
    .then((html) => {
      includeTarget.innerHTML = html;
      document.body.classList.add("with-layout");

      const logoutBtn = document.getElementById("navLogoutBtn");
      const logoutBtnSide = document.getElementById("navLogoutBtnSide");
      const menuBtn = document.getElementById("navMenuBtn");
      const sidebar = document.getElementById("globalSidebar");
      const sideLinks = [...document.querySelectorAll(".side-links a")];
      const sectionToggles = [...document.querySelectorAll("[data-section-toggle]")];

      let overlay = document.querySelector(".sidebar-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "sidebar-overlay";
        document.body.appendChild(overlay);
      }

      const currentPath = window.location.pathname;
      sideLinks.forEach((link) => {
        const href = link.getAttribute("href");
        if (href === currentPath) {
          link.classList.add("active");
        }
      });

      const setSectionOpen = (sectionId, isOpen) => {
        const section = document.querySelector(`[data-section="${sectionId}"]`);
        const toggle = document.querySelector(`[data-section-toggle="${sectionId}"]`);
        if (!section || !toggle) {
          return;
        }

        section.classList.toggle("open", isOpen);
        toggle.setAttribute("aria-expanded", String(isOpen));
      };

      sectionToggles.forEach((toggle) => {
        const sectionId = toggle.dataset.sectionToggle;
        const panel = document.querySelector(`[data-section-panel="${sectionId}"]`);
        const hasActiveLink = panel
          ? [...panel.querySelectorAll("a")].some((link) => link.getAttribute("href") === currentPath)
          : false;

        setSectionOpen(sectionId, hasActiveLink);

        toggle.addEventListener("click", () => {
          const section = document.querySelector(`[data-section="${sectionId}"]`);
          const isOpen = section?.classList.contains("open");
          setSectionOpen(sectionId, !isOpen);
        });
      });

      const renderAuth = (loggedIn) => {
        if (logoutBtn) {
          logoutBtn.style.display = loggedIn ? "inline-flex" : "none";
        }
        if (logoutBtnSide) {
          logoutBtnSide.style.display = loggedIn ? "inline-flex" : "none";
        }

        if (!loggedIn && window.location.pathname === "/dashboard") {
          window.location.href = "/login";
        }
      };

      const validateSession = async () => {
        const attemptRefresh = async () => {
          try {
            const refreshResponse = await fetch("/api/auth/refresh", {
              method: "POST",
              credentials: "include"
            });
            const refreshPayload = await refreshResponse.json();
            if (!refreshResponse.ok || !refreshPayload?.ok || !refreshPayload?.token) {
              return false;
            }

            localStorage.setItem("blockminer_token", refreshPayload.token);
            return true;
          } catch {
            return false;
          }
        };

        let token = localStorage.getItem("blockminer_token");
        if (!token) {
          const refreshed = await attemptRefresh();
          token = localStorage.getItem("blockminer_token");
          if (!refreshed || !token) {
            localStorage.removeItem("blockminer_session");
            return false;
          }
        }

        try {
          let response = await fetch("/api/auth/session", {
            headers: {
              Authorization: `Bearer ${token}`
            }
          });

          if (!response.ok) {
            const refreshed = await attemptRefresh();
            token = localStorage.getItem("blockminer_token");
            if (!refreshed || !token) {
              localStorage.removeItem("blockminer_token");
              localStorage.removeItem("blockminer_session");
              return false;
            }

            response = await fetch("/api/auth/session", {
              headers: {
                Authorization: `Bearer ${token}`
              }
            });
          }

          const payload = await response.json();
          if (!response.ok || !payload?.ok) {
            localStorage.removeItem("blockminer_token");
            localStorage.removeItem("blockminer_session");
            return false;
          }

          localStorage.setItem(
            "blockminer_session",
            JSON.stringify({
              name: payload.user.name,
              email: payload.user.email
            })
          );
          return true;
        } catch {
          localStorage.removeItem("blockminer_token");
          localStorage.removeItem("blockminer_session");
          return false;
        }
      };

      const handleLogout = () => {
        const token = localStorage.getItem("blockminer_token");
        fetch("/api/auth/logout", {
          method: "POST",
          headers: token
            ? {
                Authorization: `Bearer ${token}`
              }
            : {}
        }).catch(() => undefined).finally(() => {
          localStorage.removeItem("blockminer_token");
          localStorage.removeItem("blockminer_session");
          renderAuth(false);
          window.location.href = "/login";
        });
      };

      logoutBtn?.addEventListener("click", handleLogout);
      logoutBtnSide?.addEventListener("click", handleLogout);

      const closeSidebar = () => {
        sidebar?.classList.remove("active");
        overlay?.classList.remove("active");
      };

      const openSidebar = () => {
        sidebar?.classList.add("active");
        overlay?.classList.add("active");
      };

      menuBtn?.addEventListener("click", () => {
        if (sidebar?.classList.contains("active")) {
          closeSidebar();
        } else {
          openSidebar();
        }
      });

      overlay?.addEventListener("click", closeSidebar);
      sideLinks.forEach((link) => link.addEventListener("click", closeSidebar));

      validateSession().then((loggedIn) => renderAuth(loggedIn));
    })
    .catch(() => undefined);
})();
