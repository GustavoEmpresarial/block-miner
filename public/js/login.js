const form = document.getElementById("loginForm");
const feedback = document.getElementById("feedback");
const submitBtn = form?.querySelector("button[type='submit']");

function setFeedback(message, isError = false) {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("error", isError);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function setLoading(isLoading) {
  if (!submitBtn) return;
  submitBtn.disabled = isLoading;
  if (isLoading) {
    submitBtn.dataset.originalText = submitBtn.textContent;
    submitBtn.textContent = "Signing in...";
  } else if (submitBtn.dataset.originalText) {
    submitBtn.textContent = submitBtn.dataset.originalText;
    delete submitBtn.dataset.originalText;
  }
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const email = String(data.get("email") || "").trim().toLowerCase();
  const password = String(data.get("password") || "");

  if (!email || !password) {
    setFeedback("Email and password are required.", true);
    return;
  }

  if (!isValidEmail(email)) {
    setFeedback("Please enter a valid email address.", true);
    return;
  }

  if (password.length < 6) {
    setFeedback("Password must be at least 6 characters.", true);
    return;
  }

  try {
    setLoading(true);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok || !payload?.ok) {
      setFeedback(payload?.message || "Unable to login right now.", true);
      return;
    }

    localStorage.setItem(
      "blockminer_session",
      JSON.stringify({ name: payload.user.name, email: payload.user.email })
    );
    localStorage.setItem("blockminer_token", payload.token);
    setFeedback("Login successful! Redirecting to dashboard...");

    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 700);
  } catch (error) {
    setFeedback("Network error while logging in.", true);
  } finally {
    setLoading(false);
  }
});
