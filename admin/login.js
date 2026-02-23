const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const securityCodeInput = document.getElementById("securityCode");
const submitBtn = document.getElementById("submitBtn");
const btnText = document.getElementById("btnText");
const btnLoader = document.getElementById("btnLoader");
const errorMessage = document.getElementById("errorMessage");
const successMessage = document.getElementById("successMessage");

function getCookie(name) {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((found, part) => {
      if (found !== null) {
        return found;
      }

      const [key, ...raw] = part.split("=");
      if (key !== name) {
        return null;
      }

      return decodeURIComponent(raw.join("="));
    }, null);
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = "block";
  successMessage.style.display = "none";
}

function showSuccess(message) {
  successMessage.textContent = message;
  successMessage.style.display = "block";
  errorMessage.style.display = "none";
}

function hideMessages() {
  errorMessage.style.display = "none";
  successMessage.style.display = "none";
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  if (isLoading) {
    btnText.style.display = "none";
    btnLoader.style.display = "block";
  } else {
    btnText.style.display = "inline-block";
    btnLoader.style.display = "none";
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim();
  const securityCode = securityCodeInput.value.trim();

  if (!email || !securityCode) {
    showError("Por favor, preencha todos os campos.");
    return;
  }

  if (!email.includes("@")) {
    showError("Digite um email válido.");
    return;
  }

  hideMessages();
  setLoading(true);

  try {
    const csrf = getCookie("blockminer_csrf");

    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {})
      },
      body: JSON.stringify({
        email,
        securityCode
      })
    });

    const data = await response.json();

    if (!response.ok) {
      showError(data.message || "Falha na autenticação. Verifique suas credenciais.");
      setLoading(false);
      return;
    }

    showSuccess("Autenticação bem-sucedida! Redirecionando...");

    // Armazena token JWT no localStorage
    if (data.token) {
      localStorage.setItem("adminToken", data.token);
      localStorage.setItem("adminTokenExpiry", new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString());
    }

    // Redireciona após 1 segundo
    setTimeout(() => {
      window.location.href = "/admin/";
    }, 1000);
  } catch (error) {
    console.error("Erro ao fazer login:", error);
    showError("Erro de conexão. Tente novamente mais tarde.");
    setLoading(false);
  }
});

// Focus no primeiro input
emailInput.focus();
