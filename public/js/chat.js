(function initChat() {
  const messagesEl = document.getElementById("chatMessages");
  const formEl = document.getElementById("chatForm");
  const inputEl = document.getElementById("chatInput");
  const emojiToggleEl = document.getElementById("emojiToggle");
  const emojiPickerEl = document.getElementById("emojiPicker");

  if (!messagesEl || !formEl || !inputEl) {
    return;
  }

  const socket = typeof io === "function" ? io() : null;
  let currentUserId = null;

  const QUICK_EMOJIS = ["😀", "😂", "🤣", "😍", "😎", "🤝", "🔥", "🚀", "💎", "⛏️", "🎉", "✅", "💬", "👏"];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getInitial(username) {
    const trimmed = String(username || "").trim();
    if (!trimmed) {
      return "M";
    }
    return trimmed.charAt(0).toUpperCase();
  }

  function isOwnMessage(message) {
    const msgUserId = Number(message?.userId || 0);
    return Number.isInteger(currentUserId) && currentUserId > 0 && msgUserId === currentUserId;
  }

  async function loadSession() {
    try {
      const response = await fetch("/api/auth/session", { credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        return;
      }
      const id = Number(payload?.user?.id || 0);
      if (Number.isInteger(id) && id > 0) {
        currentUserId = id;
      }
    } catch {
      // ignore transient errors
    }
  }

  function setupEmojiPicker() {
    if (!emojiToggleEl || !emojiPickerEl) {
      return;
    }

    emojiPickerEl.innerHTML = QUICK_EMOJIS.map((emoji) => {
      return `<button type="button" class="emoji-item" data-emoji="${emoji}" aria-label="${emoji}">${emoji}</button>`;
    }).join("");

    emojiToggleEl.addEventListener("click", () => {
      emojiPickerEl.hidden = !emojiPickerEl.hidden;
    });

    emojiPickerEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const emoji = target.getAttribute("data-emoji");
      if (!emoji) {
        return;
      }

      const value = String(inputEl.value || "");
      const start = Number(inputEl.selectionStart ?? value.length);
      const end = Number(inputEl.selectionEnd ?? value.length);
      inputEl.value = `${value.slice(0, start)}${emoji}${value.slice(end)}`;
      const cursor = start + emoji.length;
      inputEl.setSelectionRange(cursor, cursor);
      inputEl.focus();
    });

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!emojiPickerEl.contains(target) && target !== emojiToggleEl) {
        emojiPickerEl.hidden = true;
      }
    });
  }

  function renderMessages(messages) {
    messagesEl.innerHTML = "";
    for (const msg of messages || []) {
      const item = document.createElement("div");
      item.className = `chat-item ${isOwnMessage(msg) ? "is-own" : ""}`.trim();
      const username = escapeHtml(msg.username || "Miner");
      item.innerHTML = `
        <div class="chat-avatar" aria-hidden="true">${escapeHtml(getInitial(msg.username))}</div>
        <div class="chat-bubble">
          <div class="chat-line">
            <span class="chat-user">${username}:</span>
            <span class="chat-text">${escapeHtml(msg.message || "")}</span>
          </div>
        </div>
      `;
      messagesEl.appendChild(item);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function loadMessages() {
    try {
      const response = await fetch("/api/chat/messages", { credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return;
      }
      renderMessages(payload.messages || []);
    } catch {
      // ignore transient errors
    }
  }

  async function sendMessage(message) {
    const response = await fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ message })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || "Failed to send message.");
    }

    return payload.message;
  }

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = String(inputEl.value || "").trim();
    if (!message) {
      return;
    }

    inputEl.value = "";
    try {
      await sendMessage(message);
    } catch {
      // if send fails, reload state
      loadMessages();
    }
  });

  if (socket) {
    socket.on("chat:new-message", async () => {
      await loadMessages();
    });
  }

  setupEmojiPicker();
  loadSession().then(loadMessages);
  setInterval(loadMessages, 5000);
})();
