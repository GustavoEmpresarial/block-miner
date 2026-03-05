(function initAntiAdblock() {
  if (window.__bmAntiAdblockInitialized) {
    return;
  }
  window.__bmAntiAdblockInitialized = true;

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    "gtm.start": new Date().getTime(),
    event: "gtm.js"
  });

  const gtmScript = document.createElement("script");
  gtmScript.async = true;
  gtmScript.src = "https://www.googletagmanager.com/gtm.js?id=GTM-PC5MSWJ";
  (document.head || document.documentElement).appendChild(gtmScript);

  const gaScript = document.createElement("script");
  gaScript.async = true;
  gaScript.src = "https://www.googletagmanager.com/gtag/js?id=G-C1L9JE70W6";
  (document.head || document.documentElement).appendChild(gaScript);

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", "G-C1L9JE70W6");

  const parentDiv = document.createElement("div");
  parentDiv.id = "abb";
  parentDiv.innerHTML = '<ins class="surfe-be" data-sid="1"></ins>';
  (document.body || document.documentElement).appendChild(parentDiv);

  window.adsurfebe = window.adsurfebe || [];
  window.adsurfebe.push({});

  const swalScript = document.createElement("script");
  swalScript.src = "https://cdn.jsdelivr.net/npm/sweetalert2@11";
  swalScript.async = true;
  (document.head || document.documentElement).appendChild(swalScript);

  let adBlockedDetected = false;
  const testAd = "https://static.surfe.pro/js/net.js";

  function showWarningAndReload() {
    const message = "Disable your Ad Blocker.";
    if (window.Swal && typeof window.Swal.fire === "function") {
      window.Swal.fire(message);
    } else {
      window.alert(message);
    }

    window.setTimeout(() => {
      window.location.reload();
    }, 5000);
  }

  function adsBlocked(callback) {
    fetch(new Request(testAd, { method: "HEAD", mode: "no-cors" }))
      .then(() => callback(false))
      .catch(() => callback(true));
  }

  function init() {
    adsBlocked((blocked) => {
      if (blocked) {
        adBlockedDetected = true;
      }
    });
  }

  (function testAdScriptLoad() {
    const startedAt = performance.now();
    const script = document.createElement("script");
    script.onload = function onLoad() {
      const elapsed = (performance.now() - startedAt).toFixed(2);
      void elapsed;
      script.parentNode && script.parentNode.removeChild(script);
    };
    script.onerror = function onError() {
      adBlockedDetected = true;
    };
    script.src = testAd;
    (document.body || document.documentElement).appendChild(script);
  })();

  document.addEventListener("DOMContentLoaded", init, false);

  window.addEventListener("load", function onLoad() {
    const abb = document.getElementById("abb");
    if (abb) {
      if (abb.innerHTML.indexOf("GIF") !== -1) {
        adBlockedDetected = true;
      } else {
        abb.remove();
      }
    }

    if (!document.getElementById("2deb000b57bfac9d72c14d4ed967b572")) {
      showWarningAndReload();
      return;
    }

    if (adBlockedDetected === true) {
      showWarningAndReload();
    }
  });
})();
