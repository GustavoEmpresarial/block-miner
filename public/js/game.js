const socket = io();

const state = {
  minerId: null,
  tokenSymbol: "BMC",
  machines: [],
  inventory: [],
  lastMiner: null,
  currentBalance: 0
};

const elements = {
  netHashrate: document.getElementById("netHashrate"),
  coinPower: document.getElementById("coinPower"),
  myHashrate: document.getElementById("myHashrate"),
  blockCountdown: document.getElementById("blockCountdown"),
  miningRoom: document.getElementById("miningRoom"),
  inventoryList: document.getElementById("inventoryList"),
  inventoryCount: document.getElementById("inventoryCount"),
  rackCounter: document.getElementById("rackCounter"),
  machineModal: document.getElementById("machineModal"),
  modalTitle: document.getElementById("modalTitle"),
  modalBody: document.getElementById("modalBody"),
  modalActions: document.getElementById("modalActions")
};

const rackConfigs = {};
const RACKS_COUNT = 10;
const SLOTS_PER_RACK = 8;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getToken() {
  return localStorage.getItem("blockminer_token");
}

function formatHashrate(value) {
  return `${Math.round(value || 0)} H/s`;
}

function formatCountdown(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function applyLiveState(payload) {
  if (!payload) {
    return;
  }

  state.tokenSymbol = payload.tokenSymbol || state.tokenSymbol || "BMC";
  elements.netHashrate.textContent = formatHashrate(payload.networkHashRate);
  const blockReward = Number(payload.blockReward ?? 0.1);
  elements.coinPower.textContent = `${blockReward.toFixed(4)} ${state.tokenSymbol}`;
  elements.blockCountdown.textContent = formatCountdown(payload.blockCountdownSeconds ?? 600);

  if (payload.miner) {
    state.currentBalance = Number(payload.miner.balance || 0);
    elements.myHashrate.textContent = formatHashrate(payload.miner.estimatedHashRate);
  }
}

async function loadMachines() {
  const token = getToken();
  if (!token) {
    return;
  }

  try {
    const response = await fetch("/api/machines", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const data = await response.json();
    if (data.ok) {
      state.machines = data.machines || [];
      console.log("Machines loaded:", state.machines);
    }
  } catch (error) {
    console.error("Failed to load machines", error);
  }
}

async function loadInventory() {
  const token = getToken();
  if (!token) {
    return;
  }

  try {
    const response = await fetch("/api/inventory", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const data = await response.json();
    if (data.ok) {
      state.inventory = data.inventory || [];
    }
  } catch (error) {
    console.error("Failed to load inventory", error);
  }
}

async function loadRackConfigs() {
  const token = getToken();
  if (!token) {
    return;
  }

  try {
    const response = await fetch("/api/racks", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const data = await response.json();
    if (data.ok && data.racks) {
      data.racks.forEach(rack => {
        rackConfigs[rack.rack_index] = rack.custom_name;
      });
    }
  } catch (error) {
    console.error("Failed to load rack configs", error);
  }
}

async function saveRackName(rackIndex, customName) {
  const token = getToken();
  if (!token) {
    return;
  }

  try {
    const response = await fetch("/api/racks/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ rackIndex, customName })
    });
    const data = await response.json();
    if (data.ok) {
      rackConfigs[rackIndex] = customName;
      return true;
    }
  } catch (error) {
    console.error("Failed to save rack name", error);
  }
  return false;
}

function editRackName(rackIndex) {
  const currentName = rackConfigs[rackIndex] || `Rack ${rackIndex}`;
  
  const bodyHTML = `
    <p>Customize your rack name:</p>
    <input type="text" id="rackNameInput" class="modal-input" value="${currentName}" maxlength="30" placeholder="Rack name">
  `;

  const actionsHTML = `
    <button class="btn primary" onclick="confirmRackEdit(${rackIndex})">Save</button>
    <button class="btn" onclick="closeModal()">Cancel</button>
  `;

  openModal(`Edit Rack ${rackIndex}`, bodyHTML, actionsHTML);
  
  setTimeout(() => {
    const input = document.getElementById("rackNameInput");
    if (input) {
      input.focus();
      input.select();
    }
  }, 100);
}

async function confirmRackEdit(rackIndex) {
  const input = document.getElementById("rackNameInput");
  if (!input) return;
  
  const newName = input.value.trim();
  if (!newName) {
    window.notify?.("Name cannot be empty!", "error");
    return;
  }

  const success = await saveRackName(rackIndex, newName);
  if (success) {
    window.notify?.("Rack name updated!", "success");
    closeModal();
    await refreshState();
  } else {
    window.notify?.("Failed to save rack name.", "error");
  }
}

function getMachineBySlot(slotIndex) {
  // Check if this slot is the start of a machine
  const machine = state.machines.find((m) => m.slot_index === slotIndex);
  if (machine) {
    return machine;
  }
  
  // Check if this slot is occupied by a 2-cell machine from the previous slot
  // First check slot_size field, then fallback to hash_rate detection
  const previousMachine = state.machines.find((m) => {
    if (m.slot_index !== slotIndex - 1) return false;
    
    // Check slot_size if available
    if (m.slot_size === 2) return true;
    
    // Fallback: Elite Miners (hash_rate >= 100) occupy 2 slots
    const hashRate = Number(m.hash_rate || 0);
    return hashRate >= 100;
  });
  
  if (previousMachine) {
    return { ...previousMachine, isSecondSlot: true };
  }
  
  return null;
}

function getGlobalSlotIndex(rackIndex, localSlotIndex) {
  return (rackIndex - 1) * SLOTS_PER_RACK + localSlotIndex;
}

function getMachineDescriptor(machine) {
  const hashRate = Number(machine?.hash_rate || 55);
  const slotSize = Number.isInteger(machine?.slot_size) ? machine.slot_size : null;

  if (machine?.image_url) {
    return {
      name: machine?.miner_name || machine?.name || "Miner",
      image: machine.image_url,
      size: slotSize || (hashRate >= 100 ? 2 : 1)
    };
  }

  // Elite: hash_rate >= 100
  if (hashRate >= 100) {
    return { name: "Elite Miner", image: "/assets/machines/elite-miner.png", size: slotSize || 2 };
  }

  // Pro: hash_rate >= 80
  if (hashRate >= 80) {
    return { name: "Pro Miner", image: "/assets/machines/pro-miner.png", size: slotSize || 1 };
  }

  // Basic: default
  return { name: "Basic Miner", image: "/assets/machines/basic-miner.png", size: slotSize || 1 };
}

function openModal(title, bodyHTML, actionsHTML) {
  elements.modalTitle.textContent = title;
  elements.modalBody.innerHTML = bodyHTML;
  elements.modalActions.innerHTML = actionsHTML;
  elements.machineModal.classList.add("active");
}

function closeModal() {
  elements.machineModal.classList.remove("active");
}

function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const bodyHTML = `<p>${message}</p>`;
    const actionsHTML = `
      <button class="btn btn-primary" onclick="window.confirmDialogResolve(true)">OK</button>
      <button class="btn btn-secondary" onclick="window.confirmDialogResolve(false)">Cancel</button>
    `;
    
    window.confirmDialogResolve = (result) => {
      closeModal();
      delete window.confirmDialogResolve;
      resolve(result);
    };
    
    openModal("Confirmation", bodyHTML, actionsHTML);
  });
}

async function addMachineToSlot(rackIndex, localSlotIndex, inventoryId) {
  const token = getToken();
  if (!token) {
    return;
  }

  const slotIndex = getGlobalSlotIndex(rackIndex, localSlotIndex);

  try {
    const response = await fetch("/api/inventory/install", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ slotIndex, inventoryId })
    });
    const data = await response.json();
    if (data.ok) {
      window.notify?.(data.message || "Miner installed!", "success");
      closeModal();
      await loadMachines();
      await loadInventory();
      renderInventory();
      await refreshState();
    } else {
      window.notify?.(data.message || "Failed to install miner.", "error");
    }
  } catch {
    window.notify?.("Error installing miner.", "error");
  }
}

async function removeInventoryItem(inventoryId) {
  const token = getToken();
  if (!token) {
    return;
  }

  const confirmed = await showConfirmDialog("Are you sure you want to remove this miner from inventory?");
  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch("/api/inventory/remove", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ inventoryId })
    });
    const data = await response.json();
    if (data.ok) {
      window.notify?.(data.message || "Item removed!", "success");
      await loadInventory();
      renderInventory();
    } else {
      window.notify?.(data.message || "Failed to remove item.", "error");
    }
  } catch {
    window.notify?.("Error removing item.", "error");
  }
}

async function removeMachine(machineId) {
  const token = getToken();
  if (!token) {
    return;
  }

  const confirmed = await showConfirmDialog("Are you sure you want to send this miner to inventory?");
  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch("/api/machines/remove", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ machineId })
    });
    const data = await response.json();
    if (data.ok) {
      window.notify?.(data.message || "Miner sent to inventory!", "success");
      closeModal();
      await loadMachines();
      await refreshState();
    } else {
      window.notify?.(data.message || "Failed to remove miner.", "error");
    }
  } catch {
    window.notify?.("Error removing miner.", "error");
  }
}

async function upgradeMachine(machineId) {
  const token = getToken();
  if (!token) {
    return;
  }

  try {
    const response = await fetch("/api/machines/upgrade", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ machineId })
    });
    const data = await response.json();
    if (data.ok) {
      window.notify?.(data.message || "Machine upgraded!", "success");
      closeModal();
      await loadMachines();
      await refreshState();
    } else {
      window.notify?.(data.message || "Upgrade failed.", "error");
    }
  } catch {
    window.notify?.("Failed to upgrade machine.", "error");
  }
}

async function toggleMachine(machineId, isActive) {
  const token = getToken();
  if (!token) {
    return;
  }

  try {
    const response = await fetch("/api/machines/toggle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ machineId, isActive })
    });
    const data = await response.json();
    if (data.ok) {
      window.notify?.(data.message || "Machine toggled!", "success");
      closeModal();
      await loadMachines();
      await refreshState();
    } else {
      window.notify?.(data.message || "Toggle failed.", "error");
    }
  } catch {
    window.notify?.("Failed to toggle machine.", "error");
  }
}

async function clearRack(rackIndex) {
  const token = getToken();
  if (!token) {
    return;
  }

  const confirmed = await showConfirmDialog(`Clear all machines from Rack ${rackIndex}?`);
  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch("/api/machines/clear-rack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ rackIndex })
    });
    const data = await response.json();
    if (data.ok) {
      window.notify?.(data.message || "Rack cleared!", "success");
      await loadMachines();
      await loadInventory();
      renderMiningRoom(state.lastMiner);
      renderInventory();
      await refreshState();
    } else {
      window.notify?.(data.message || "Failed to clear rack.", "error");
    }
  } catch {
    window.notify?.("Error clearing rack.", "error");
  }
}

async function refreshState() {
  if (!state.minerId) {
    return;
  }

  try {
    await loadMachines();
    await loadInventory();
    const response = await fetch(`/api/state?minerId=${state.minerId}`);
    const minerState = await response.json();
    renderState(minerState);
  } catch {
    console.error("Failed to refresh state");
  }
}

async function handleSlotClick(rackIndex, localSlotIndex, machine) {
  if (machine) {
    const upgradeCost = (0.3 * machine.level).toFixed(2);
    const statusText = machine.is_active ? "Active" : "Inactive";
    const toggleAction = machine.is_active ? "Deactivate" : "Activate";

    const bodyHTML = `
      <p><strong>Level:</strong> ${machine.level}</p>
      <p><strong>Hash Rate:</strong> ${machine.hash_rate} H/s</p>
      <p><strong>Status:</strong> ${statusText}</p>
      <p><strong>Upgrade Cost:</strong> ${upgradeCost} ${state.tokenSymbol}</p>
      <p><strong>Balance:</strong> ${state.currentBalance.toFixed(4)} ${state.tokenSymbol}</p>
    `;

    const actionsHTML = `
      <button class="btn" onclick="toggleMachine(${machine.id}, ${!machine.is_active})">${toggleAction}</button>
      <button class="btn danger" onclick="removeMachine(${machine.id})">Send to inventory</button>
    `;

    openModal(`Rack ${rackIndex} - Slot ${localSlotIndex + 1}`, bodyHTML, actionsHTML);
  } else {
    await loadInventory();
    const bodyHTML = `
      <p><strong>Rack:</strong> ${rackIndex}</p>
      <p><strong>Slot:</strong> ${localSlotIndex + 1}</p>
      <p><strong>Status:</strong> Empty</p>
      <p><strong>Balance:</strong> ${state.currentBalance.toFixed(4)} ${state.tokenSymbol}</p>
      <p>Choose a miner from your inventory to install:</p>
    `;

    let actionsHTML = "";
    const inventoryItems = state.inventory || [];
    if (inventoryItems.length === 0) {
      actionsHTML = `
        <button class="btn" onclick="window.location.href='/shop'">Go to shop</button>
      `;
    } else {
      actionsHTML = inventoryItems
        .map(
          (item) => {
            const safeName = escapeHtml(item.miner_name);
            return `<button class="btn primary" onclick="addMachineToSlot(${rackIndex}, ${localSlotIndex}, ${item.id})">${safeName} (Lv ${item.level})</button>`;
          }
        )
        .join("");
    }

    openModal(`Rack ${rackIndex} - Slot ${localSlotIndex + 1} (Empty)`, bodyHTML, actionsHTML);
  }
}

function renderInventory() {
  if (!elements.inventoryList) {
    return;
  }

  const items = state.inventory || [];
  elements.inventoryList.innerHTML = "";
  if (elements.inventoryCount) {
    elements.inventoryCount.textContent = String(items.length);
  }

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "inventory-empty";
    empty.textContent = "Your inventory is empty. Buy miners in the shop.";
    elements.inventoryList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "inventory-item";

    const descriptor = getMachineDescriptor({
      hash_rate: item.hash_rate,
      slot_size: item.slot_size,
      miner_name: item.miner_name,
      image_url: item.image_url
    });
    const image = document.createElement("img");
    image.className = "inventory-image";
    image.src = descriptor.image;
    image.alt = descriptor.name;
    image.addEventListener("error", () => {
      image.style.display = "none";
    });

    const meta = document.createElement("div");
    meta.className = "inventory-meta";

    const title = document.createElement("span");
    title.className = "inventory-name";
    title.textContent = item.miner_name;

    const detail = document.createElement("span");
    detail.className = "inventory-detail";
    const slotInfo = descriptor.size === 2 ? " · Occupies 2 slots" : "";
    detail.textContent = `Lv ${item.level} · ${Math.round(item.hash_rate)} H/s${slotInfo}`;

    meta.append(title, detail);

    const actions = document.createElement("div");
    actions.className = "inventory-actions";

    const installBtn = document.createElement("button");
    installBtn.className = "btn primary";
    installBtn.textContent = "Install to Rack";
    installBtn.addEventListener("click", () => openInventoryInstall(item));

    actions.append(installBtn);
    card.append(image, meta, actions);
    elements.inventoryList.appendChild(card);
  });
}

function openInventoryInstall(item) {
  const descriptor = getMachineDescriptor({ hash_rate: item.hash_rate, slot_size: item.slot_size });
  const slotsNeeded = descriptor.size;
  const availableSlots = [];

  for (let rackIndex = 1; rackIndex <= RACKS_COUNT; rackIndex += 1) {
    const rackSlots = [];

    for (let localSlotIndex = 0; localSlotIndex < SLOTS_PER_RACK; localSlotIndex += 1) {
      const globalSlotIndex = getGlobalSlotIndex(rackIndex, localSlotIndex);

      if (slotsNeeded === 2) {
        if (localSlotIndex % 2 !== 0) continue;
        if (localSlotIndex + 1 >= SLOTS_PER_RACK) continue;

        if (!getMachineBySlot(globalSlotIndex) && !getMachineBySlot(globalSlotIndex + 1)) {
          rackSlots.push(localSlotIndex);
        }
      } else if (!getMachineBySlot(globalSlotIndex)) {
        rackSlots.push(localSlotIndex);
      }
    }

    if (rackSlots.length > 0) {
      availableSlots.push({ rackIndex, slots: rackSlots });
    }
  }

  const slotText = slotsNeeded > 1 ? `${slotsNeeded} slots` : "1 slot";
  const safeName = escapeHtml(item.miner_name);
  const bodyHTML = `
    <p><strong>Miner:</strong> ${safeName} (Lv ${item.level})</p>
    <p><strong>Size:</strong> Occupies ${slotText}</p>
    <p>Select a slot to install:</p>
  `;

  let actionsHTML = "";
  if (availableSlots.length === 0) {
    actionsHTML = `<button class="btn" onclick="closeModal()">No available slots</button>`;
  } else {
    actionsHTML = availableSlots
      .map((rack) => {
        const buttons = rack.slots
          .map((localSlotIndex) => {
            const label = slotsNeeded > 1
              ? `Slots ${localSlotIndex + 1}-${localSlotIndex + slotsNeeded}`
              : `Slot ${localSlotIndex + 1}`;
            return `<button class="btn primary" onclick="addMachineToSlot(${rack.rackIndex}, ${localSlotIndex}, ${item.id})">${label}</button>`;
          })
          .join("");

        return `
          <div class="slot-group">
            <div class="slot-group-title">Rack ${rack.rackIndex}</div>
            <div class="slot-group-actions">${buttons}</div>
          </div>
        `;
      })
      .join("");
  }

  openModal("Install Miner", bodyHTML, actionsHTML);
}

function renderMiningRoom(miner) {
  if (!elements.miningRoom) {
    return;
  }

  elements.miningRoom.innerHTML = "";

  if (!miner || !miner.rigs) {
    const placeholder = document.createElement("div");
    placeholder.className = "room-placeholder";
    placeholder.textContent = "Your mining room will be loaded with your account data.";
    elements.miningRoom.appendChild(placeholder);
    return;
  }

  console.log("Rendering mining room with machines:", state.machines);

  // Always show all 10 racks (80 slots total)
  const racksCount = RACKS_COUNT;

  // Update rack counter
  if (elements.rackCounter) {
    elements.rackCounter.textContent = `${racksCount}/10 racks`;
    if (racksCount >= 10) {
      elements.rackCounter.style.background = "rgba(255, 107, 107, 0.15)";
      elements.rackCounter.style.borderColor = "rgba(255, 107, 107, 0.35)";
      elements.rackCounter.style.color = "#ff6b6b";
    } else if (racksCount >= 8) {
      elements.rackCounter.style.background = "rgba(255, 184, 77, 0.15)";
      elements.rackCounter.style.borderColor = "rgba(255, 184, 77, 0.35)";
      elements.rackCounter.style.color = "#ffb84d";
    } else {
      elements.rackCounter.style.background = "rgba(76, 193, 130, 0.15)";
      elements.rackCounter.style.borderColor = "rgba(76, 193, 130, 0.35)";
      elements.rackCounter.style.color = "#4cc182";
    }
  }

  for (let rackIndex = 1; rackIndex <= racksCount; rackIndex += 1) {
    const rack = document.createElement("article");
    rack.className = `rack ${miner.active ? "active" : ""}`;

    const rackTitle = document.createElement("h4");
    
    const rackName = document.createElement("span");
    rackName.textContent = rackConfigs[rackIndex] || `Rack ${rackIndex}`;
    
    const editBtn = document.createElement("button");
    editBtn.className = "rack-edit-btn";
    editBtn.textContent = "✏️ Edit";
    editBtn.onclick = () => editRackName(rackIndex);

    const clearBtn = document.createElement("button");
    clearBtn.className = "rack-clear-btn";
    clearBtn.textContent = "🧹 Clear";
    clearBtn.onclick = () => clearRack(rackIndex);
    
    rackTitle.appendChild(rackName);
    rackTitle.appendChild(editBtn);
    rackTitle.appendChild(clearBtn);
    rack.appendChild(rackTitle);

    const machinesGrid = document.createElement("div");
    machinesGrid.className = "machines-grid";

    for (let localSlotIndex = 0; localSlotIndex < SLOTS_PER_RACK; localSlotIndex += 1) {
      const currentSlotIndex = getGlobalSlotIndex(rackIndex, localSlotIndex);
      const machine = getMachineBySlot(currentSlotIndex);
      
      // Skip rendering if this is a continuation slot (occupied by previous 2-cell machine)
      if (machine && machine.isSecondSlot) {
        continue;
      }
      
      const machineSlot = document.createElement("div");
      machineSlot.className = "machine-slot";

      if (machine) {
        // This is the main slot
        const descriptor = getMachineDescriptor(machine);
        machineSlot.classList.add("occupied");
        
        // If machine occupies 2 slots, make it wider
        if (descriptor.size === 2) {
          machineSlot.classList.add("double-width");
        }

        const image = document.createElement("img");
        image.className = "machine-image";
        image.src = descriptor.image;
        image.alt = descriptor.name;
        image.addEventListener("error", () => {
          image.style.display = "none";
        });
        machineSlot.append(image);
        machineSlot.addEventListener("click", () => handleSlotClick(rackIndex, localSlotIndex, machine));
      } else {
        machineSlot.classList.add("empty");

        const emptyLabel = document.createElement("span");
        emptyLabel.className = "machine-empty";
        emptyLabel.textContent = "Empty";

        machineSlot.append(emptyLabel);
        machineSlot.addEventListener("click", () => handleSlotClick(rackIndex, localSlotIndex, null));
      }

      machinesGrid.appendChild(machineSlot);
    }

    rack.appendChild(machinesGrid);
    elements.miningRoom.appendChild(rack);
  }
}

function renderState(payload) {
  if (!payload) {
    return;
  }

  state.tokenSymbol = payload.tokenSymbol || "BMC";

  elements.netHashrate.textContent = formatHashrate(payload.networkHashRate);
  const blockReward = Number(payload.blockReward ?? 0.1);
  elements.coinPower.textContent = `${blockReward.toFixed(4)} ${state.tokenSymbol}`;
  elements.blockCountdown.textContent = formatCountdown(payload.blockCountdownSeconds ?? 600);

  if (!payload.miner) {
    elements.myHashrate.textContent = "0 H/s";
    state.lastMiner = null;
    renderMiningRoom(null);
    return;
  }

  const miner = payload.miner;
  state.lastMiner = miner;
  state.currentBalance = Number(miner.balance || 0);
  elements.myHashrate.textContent = formatHashrate(miner.estimatedHashRate);
  renderMiningRoom(miner);
  renderInventory();
}

function requestJoin(token) {
  socket.emit("miner:join", { token }, async (response) => {
    if (!response?.ok) {
      return;
    }

    state.minerId = response.minerId;
    await loadRackConfigs();
    await loadMachines();
    await loadInventory();
    renderState(response.state);
  });
}

socket.on("connect", () => {
  const token = getToken();
  if (!token) {
    return;
  }

  requestJoin(token);
});

socket.on("state:update", async (payload) => {
  if (!state.minerId) {
    renderState(payload);
    return;
  }

  applyLiveState(payload);
});

socket.on("inventory:update", async (payload) => {
  if (payload?.inventory) {
    state.inventory = payload.inventory;
    renderInventory();
    return;
  }

  await loadInventory();
  renderInventory();
});

socket.on("machines:update", async (payload) => {
  if (payload?.machines) {
    state.machines = payload.machines;
    renderMiningRoom(state.lastMiner);
    return;
  }

  await loadMachines();
  renderMiningRoom(state.lastMiner);
});

elements.machineModal.querySelector(".modal-close").addEventListener("click", closeModal);

elements.machineModal.addEventListener("click", (e) => {
  if (e.target === elements.machineModal) {
    closeModal();
  }
});

renderMiningRoom(null);

// Expose functions globally for onclick handlers
window.upgradeMachine = upgradeMachine;
window.toggleMachine = toggleMachine;
window.addMachineToSlot = addMachineToSlot;
window.removeMachine = removeMachine;
window.confirmRackEdit = confirmRackEdit;
window.removeInventoryItem = removeInventoryItem;
window.clearRack = clearRack;
