function getToken() {
  return localStorage.getItem("blockminer_token");
}

function formatPol(value) {
  if (!Number.isFinite(value)) return "0 POL";
  const formatted = value % 1 === 0 ? value.toFixed(0) : value.toFixed(2);
  return `${formatted} POL`;
}

function formatHashRate(value) {
  if (!Number.isFinite(value)) return "0 H/s";
  const formatted = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} H/s`;
}

function getPageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get("page"));
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function setPageInUrl(page) {
  const params = new URLSearchParams(window.location.search);
  params.set("page", String(page));
  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", newUrl);
}

function renderPagination(container, page, pageSize, total) {
  container.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const prevButton = document.createElement("button");
  prevButton.className = "page-btn";
  prevButton.textContent = "Prev";
  prevButton.disabled = page <= 1;

  const nextButton = document.createElement("button");
  nextButton.className = "page-btn";
  nextButton.textContent = "Next";
  nextButton.disabled = page >= totalPages;

  const pageLabel = document.createElement("span");
  pageLabel.className = "page-label";
  pageLabel.textContent = `Page ${page} of ${totalPages}`;

  prevButton.addEventListener("click", () => {
    loadShop(page - 1, pageSize);
  });

  nextButton.addEventListener("click", () => {
    loadShop(page + 1, pageSize);
  });

  container.append(prevButton, pageLabel, nextButton);
}

async function fetchMiners(page, pageSize) {
  const token = getToken();
  if (!token) {
    window.notify?.("Please login first.", "error");
    return null;
  }

  const response = await fetch(`/api/shop/miners?page=${page}&pageSize=${pageSize}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await response.json();
  if (!data.ok) {
    window.notify?.(data.message || "Unable to load miners.", "error");
    return null;
  }

  return data;
}

async function purchaseMinerFromShop(minerId, button) {
  const token = getToken();
  if (!token) {
    window.notify?.("Please login first.", "error");
    return;
  }

  if (!Number.isInteger(minerId) || minerId <= 0) {
    window.notify?.("Invalid product data. Please refresh the page.", "error");
    return;
  }

  try {
    button.disabled = true;
    const response = await fetch("/api/shop/purchase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ minerId })
    });

    const data = await response.json();
    if (data.ok) {
      window.notify?.(data.message || "Miner purchased successfully!", "success");
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 1200);
    } else {
      window.notify?.(data.message || "Purchase failed.", "error");
    }
  } catch (error) {
    console.error("Error purchasing:", error);
    window.notify?.("Error processing purchase.", "error");
  } finally {
    button.disabled = false;
  }
}

function createCard(miner) {
  const card = document.createElement("article");
  card.className = "card shop-card";

  const img = document.createElement("img");
  img.src = miner.imageUrl;
  img.alt = miner.name;
  img.className = "machine-image";
  img.loading = "lazy";
  img.onerror = () => {
    img.style.display = "none";
  };

  const name = document.createElement("h2");
  name.textContent = miner.name;

  const stats = document.createElement("div");
  stats.className = "machine-stats";

  const powerLabel = document.createElement("span");
  powerLabel.className = "stat-label";
  powerLabel.textContent = "Power Output";

  const powerValue = document.createElement("span");
  powerValue.className = "stat-value";
  powerValue.textContent = formatHashRate(miner.baseHashRate);

  stats.append(powerLabel, powerValue);

  const price = document.createElement("div");
  price.className = "machine-price";

  const priceLabel = document.createElement("span");
  priceLabel.className = "price-label";
  priceLabel.textContent = "Price";

  const priceValue = document.createElement("span");
  priceValue.className = "price-value";
  priceValue.textContent = formatPol(miner.price);

  price.append(priceLabel, priceValue);

  const button = document.createElement("button");
  button.className = "btn-buy";
  button.type = "button";
  button.textContent = "Purchase Now";
  button.addEventListener("click", () => {
    purchaseMinerFromShop(miner.id, button);
  });

  card.append(img, name, stats, price, button);
  return card;
}

async function loadShop(page, pageSize) {
  const grid = document.getElementById("shopGrid");
  const pagination = document.getElementById("pagination");
  if (!grid || !pagination) return;

  grid.innerHTML = "<div class=\"shop-loading\">Loading miners...</div>";
  pagination.innerHTML = "";

  const data = await fetchMiners(page, pageSize);
  if (!data) {
    grid.innerHTML = "<div class=\"shop-loading\">Unable to load miners.</div>";
    return;
  }

  grid.innerHTML = "";
  const fragment = document.createDocumentFragment();
  data.miners.forEach((miner) => {
    fragment.append(createCard(miner));
  });
  grid.append(fragment);

  setPageInUrl(data.page);
  renderPagination(pagination, data.page, data.pageSize, data.total);
}

document.addEventListener("DOMContentLoaded", () => {
  const page = getPageFromUrl();
  loadShop(page, 24);
});
