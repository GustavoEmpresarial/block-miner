const form = document.getElementById("registerForm");
const feedback = document.getElementById("feedback");
const togglePassword = document.getElementById("togglePassword");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");
const eyeIcon = document.getElementById("eyeIcon");
const toggleConfirmPassword = document.getElementById("toggleConfirmPassword");
const eyeIconConfirm = document.getElementById("eyeIconConfirm");
const submitBtn = form?.querySelector("button[type='submit']");
const refCodeInput = document.getElementById("refCode");
const referralBanner = document.getElementById("referralBanner");
const referralCodeLabel = document.getElementById("referralCodeLabel");

function getCookie(name) {
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return "";
}

function setCookie(name, value, days) {
  const maxAge = days ? `; Max-Age=${days * 24 * 60 * 60}` : "";
  document.cookie = `${name}=${encodeURIComponent(value)}${maxAge}; Path=/; SameSite=Lax`;
}

const refFromUrl = new URLSearchParams(window.location.search).get("ref");
const refFromCookie = getCookie("bm_ref");
const activeRef = (refFromUrl || refFromCookie || "").trim();

if (refFromUrl) {
  setCookie("bm_ref", refFromUrl.trim(), 7);
}

if (refCodeInput && activeRef) {
  refCodeInput.value = activeRef;
}

if (referralBanner && referralCodeLabel) {
  if (activeRef) {
    referralCodeLabel.textContent = activeRef;
    referralBanner.hidden = false;
  } else {
    referralBanner.hidden = true;
  }
}

function setFeedback(message, isError = false) {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("error", isError);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9._-]{3,24}$/.test(username);
}

function isStrongPassword(password) {
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  return password.length >= 6 && hasLetter && hasNumber;
}

function setLoading(isLoading) {
  if (!submitBtn) return;
  submitBtn.disabled = isLoading;
  if (isLoading) {
    submitBtn.dataset.originalText = submitBtn.textContent;
    submitBtn.textContent = "Creating...";
  } else if (submitBtn.dataset.originalText) {
    submitBtn.textContent = submitBtn.dataset.originalText;
    delete submitBtn.dataset.originalText;
  }
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const username = String(data.get("username") || "").trim();
  const email = String(data.get("email") || "").trim().toLowerCase();
  const password = String(data.get("password") || "");
  const confirmPassword = String(data.get("confirmPassword") || "");
  const refCode = String(data.get("refCode") || "").trim();

  if (!username || !email || !password || !confirmPassword) {
    setFeedback("Please complete all fields.", true);
    return;
  }
  if (!isValidUsername(username)) {
    setFeedback("Username must be 3-24 chars and use letters, numbers, dot, dash or underscore.", true);
    return;
  }
  if (!isValidEmail(email)) {
    setFeedback("Please enter a valid email address.", true);
    return;
  }
  if (!isStrongPassword(password)) {
    setFeedback("Password must be at least 6 characters and include letters and numbers.", true);
    return;
  }
  if (password !== confirmPassword) {
    setFeedback("Passwords do not match.", true);
    return;
  }

  try {
    setLoading(true);
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, email, password, refCode })
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok || !payload?.ok) {
      setFeedback(payload?.message || "Unable to register right now.", true);
      return;
    }

    localStorage.setItem(
      "blockminer_session",
      JSON.stringify({
        username: payload.user.username || payload.user.name,
        email: payload.user.email
      })
    );
    localStorage.setItem("blockminer_token", payload.token);

    setFeedback("Registration complete! Redirecting to dashboard...");
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 700);
  } catch (error) {
    setFeedback("Network error while registering.", true);
  } finally {
    setLoading(false);
  }
});

if (togglePassword && passwordInput) {
  togglePassword.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    if (eyeIcon) {
      eyeIcon.classList.toggle("bi-eye", !isPassword);
      eyeIcon.classList.toggle("bi-eye-slash", isPassword);
    }
  });
}

if (toggleConfirmPassword && confirmPasswordInput) {
  toggleConfirmPassword.addEventListener("click", () => {
    const isPassword = confirmPasswordInput.type === "password";
    confirmPasswordInput.type = isPassword ? "text" : "password";
    if (eyeIconConfirm) {
      eyeIconConfirm.classList.toggle("bi-eye", !isPassword);
      eyeIconConfirm.classList.toggle("bi-eye-slash", isPassword);
    }
  });
}
