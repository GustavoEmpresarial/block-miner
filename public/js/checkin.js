const CHECKIN_AMOUNT_WEI = 10000000000000000n;
const CHECKIN_RECEIVER = "0x95EA8E99063A3EF1B95302aA1C5bE199653EEb13";
const POLYGON_CHAIN_ID = "0x89";

const statusEl = document.getElementById("checkinStatus");
const checkinBtn = document.getElementById("checkinBtn");

function getToken() {
  return localStorage.getItem("blockminer_token");
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.classList.remove("error", "success");
  if (type) {
    statusEl.classList.add(type);
  }
}

async function fetchStatus() {
  const token = getToken();
  if (!token) {
    setStatus("Please log in to use daily check-in.", "error");
    checkinBtn.disabled = true;
    return;
  }

  try {
    const response = await fetch("/api/checkin/status", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      setStatus(payload?.message || "Unable to load check-in status.", "error");
      return;
    }

    if (payload.checkedIn) {
      checkinBtn.disabled = true;
      setStatus("Today check-in already completed.", "success");
      return;
    }

    setStatus("No check-in today. You can check in now.");
  } catch {
    setStatus("Network error while checking status.", "error");
  }
}

async function ensurePolygonNetwork() {
  if (!window.ethereum) {
    throw new Error("Wallet not found.");
  }

  const currentChain = await window.ethereum.request({ method: "eth_chainId" });
  if (currentChain === POLYGON_CHAIN_ID) {
    return;
  }

  await window.ethereum.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: POLYGON_CHAIN_ID }]
  });
}

async function sendCheckinPayment() {
  if (!window.ethereum) {
    throw new Error("Wallet not found. Install MetaMask.");
  }

  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  const from = accounts?.[0];
  if (!from) {
    throw new Error("No wallet account found.");
  }

  const valueHex = `0x${CHECKIN_AMOUNT_WEI.toString(16)}`;
  const txHash = await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: CHECKIN_RECEIVER,
        value: valueHex
      }
    ]
  });

  return txHash;
}

async function verifyCheckin(txHash) {
  const token = getToken();
  const response = await fetch("/api/checkin/verify", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ txHash, chainId: 137 })
  });

  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || "Check-in verification failed.");
  }

  return payload;
}

async function handleCheckin() {
  checkinBtn.disabled = true;
  setStatus("Preparing wallet...", "");

  try {
    await ensurePolygonNetwork();
    setStatus("Sending 0.01 POL payment...", "");

    const txHash = await sendCheckinPayment();
    setStatus("Payment sent. Verifying on-chain...", "");

    const result = await verifyCheckin(txHash);
    if (result.status === "confirmed") {
      setStatus("Check-in confirmed. Enjoy 7 days of rewards!", "success");
    } else {
      setStatus("Check-in pending. It will confirm soon.", "success");
    }
  } catch (error) {
    setStatus(error.message || "Unable to complete check-in.", "error");
    checkinBtn.disabled = false;
    return;
  }
}

checkinBtn.addEventListener("click", () => {
  handleCheckin();
});

fetchStatus();
