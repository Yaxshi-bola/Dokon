// ============================================================
// AKSESS v3 — Premium Phone Accessories Store
// Telegram Mini App Script
// ============================================================

// ── Configuration ────────────────────────────────────────────
const SUPABASE_URL = "https://dzzgqhlyptppyulkyquj.supabase.co";
const SUPABASE_KEY = "sb_publishable_y7BTNA-BHKHEQ_QOEdnBfg_bPoEZ6Ry";
const ADMIN_ID = 8544023815;
const CART_KEY = "aksess_cart";
const FAVS_KEY = "aksess_favs";

// ── Global State ─────────────────────────────────────────────
let db = null;
let storage = null;
let tg = null;
let user = {};
let categories = [];
let banners = [];
let products = [];
let cart = [];
let favs = [];
let currentProduct = null;
let heroIndex = 0;
let heroInterval = null;
let heroTouchStartX = 0;
let galleryTouchStartX = 0;
let galleryIndex = 0;
let isAdmin = false;
let currentCategoryFilter = null;
let searchDebounce = null;
let productImgFiles = [];
let bannerImgFile = null;

// ── Supabase & Telegram Setup ────────────────────────────────
function initSupabase() {
  db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  storage = db.storage;
}

function initTelegram() {
  tg = window.Telegram && window.Telegram.WebApp;
  if (!tg) {
    // Fallback for development
    tg = {
      ready: () => {},
      expand: () => {},
      close: () => {},
      MainButton: { show: () => {}, hide: () => {}, setText: () => {}, onClick: () => {} },
      BackButton: { show: () => {}, hide: () => {}, onClick: () => {} },
      HapticFeedback: { notificationOccurred: () => {}, impactOccurred: () => {}, selectionChanged: () => {} },
      sendData: () => {},
      openTelegramLink: () => {},
      openLink: () => {},
      showPopup: () => {},
      setHeaderColor: () => {},
      setBackgroundColor: () => {},
      themeParams: {},
      initDataUnsafe: { user: { id: 1, first_name: "Dev", last_name: "User", username: "devuser" } },
      colorScheme: "light",
      viewportHeight: 600,
      viewportStableHeight: 600,
    };
  }
  tg.ready();
  tg.expand();
  tg.setHeaderColor("#ffffff");
  tg.setBackgroundColor("#f5f5f7");

  const tgUser = tg.initDataUnsafe && tg.initDataUnsafe.user;
  user = {
    id: (tgUser && tgUser.id) || 0,
    first_name: (tgUser && tgUser.first_name) || "Guest",
    last_name: (tgUser && tgUser.last_name) || "",
    username: (tgUser && tgUser.username) || "",
  };
  isAdmin = user.id === ADMIN_ID;

  // Register or update user
  if (user.id) registerUser();
}

async function registerUser() {
  try {
    const { data: existing } = await db
      .from("users")
      .select("id")
      .eq("telegram_id", user.id)
      .single();
    if (existing) {
      await db
        .from("users")
        .update({
          first_name: user.first_name,
          last_name: user.last_name,
          username: user.username,
          last_seen: new Date().toISOString(),
        })
        .eq("telegram_id", user.id);
    } else {
      await db.from("users").insert({
        telegram_id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        last_seen: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.warn("Register user error:", e);
  }
}

// ── Data Fetching ────────────────────────────────────────────
async function fetchCategories() {
  try {
    const { data, error } = await db.from("categories").select("*").order("name");
    if (error) throw error;
    categories = data && data.length ? data : demoCategories();
  } catch (e) {
    console.warn("Fetch categories error:", e);
    categories = demoCategories();
  }
  return categories;
}

async function fetchBanners() {
  try {
    const { data, error } = await db
      .from("banners")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");
    if (error) throw error;
    banners = data && data.length ? data : demoBanners();
  } catch (e) {
    console.warn("Fetch banners error:", e);
    banners = demoBanners();
  }
  return banners;
}

async function fetchProducts() {
  try {
    const { data, error } = await db.from("products").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    products = data && data.length ? data : demoProducts();
  } catch (e) {
    console.warn("Fetch products error:", e);
    products = demoProducts();
  }
  return products;
}

function setupRealtime() {
  try {
    db.channel("aksess-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => fetchProducts().then(renderHomeSections))
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, () => fetchCategories().then(renderCatPills))
      .on("postgres_changes", { event: "*", schema: "public", table: "banners" }, () => fetchBanners().then(setupHero))
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        if (document.getElementById("page-orders").classList.contains("active")) renderOrdersPage();
        if (isAdmin && document.getElementById("page-admin").classList.contains("active")) loadAdminData();
      })
      .subscribe();
  } catch (e) {
    console.warn("Realtime setup error:", e);
  }
}

// ── Navigation ───────────────────────────────────────────────
const pageHistory = [];

function navigateTo(pageId) {
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  const page = document.getElementById(pageId);
  if (page) {
    page.classList.add("active");
    page.scrollTop = 0;
  }
  // Update bottom nav active state
  document.querySelectorAll(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.page === pageId);
  });
  // Show/hide back button
  if (tg && tg.BackButton) {
    if (pageId !== "page-home" && pageId !== "page-admin") {
      tg.BackButton.show();
    } else {
      tg.BackButton.hide();
    }
  }
}

function goBack() {
  if (currentProduct) {
    currentProduct = null;
    navigateTo(pageHistory.pop() || "page-home");
    return;
  }
  navigateTo("page-home");
}

function openPage(pageId) {
  pageHistory.length = 0;
  navigateTo(pageId);
  // Page-specific init
  switch (pageId) {
    case "page-home":
      renderHomeSections();
      break;
    case "page-categories":
      renderCategoriesPage();
      break;
    case "page-search":
      break;
    case "page-orders":
      renderOrdersPage();
      break;
    case "page-profile":
      renderProfile();
      break;
    case "page-admin":
      if (isAdmin) loadAdminData();
      break;
  }
}

// ── Hero Banner Slider ───────────────────────────────────────
function setupHero() {
  const track = document.getElementById("hero-track");
  const dots = document.getElementById("hero-dots");
  if (!track || !dots) return;
  if (!banners.length) {
    track.innerHTML = '<div class="hero-slide"><div class="hero-placeholder">AKSESS</div></div>';
    dots.innerHTML = "";
    return;
  }

  track.innerHTML = banners
    .map(
      (b) => `
    <div class="hero-slide" style="background:${b.color || "#1c1c1e"}">
      <div class="hero-content">
        ${b.icon ? `<div class="hero-icon">${b.icon}</div>` : ""}
        <div class="hero-title">${b.title || ""}</div>
        <div class="hero-sub">${b.subtitle || ""}</div>
      </div>
      ${b.image_url ? `<img class="hero-img" src="${b.image_url}" alt="${b.title || ""}" loading="lazy" />` : ""}
    </div>`
    )
    .join("");

  dots.innerHTML = banners
    .map((_, i) => `<div class="hero-dot${i === 0 ? " active" : ""}" data-i="${i}"></div>`)
    .join("");

  dots.querySelectorAll(".hero-dot").forEach((d) => {
    d.addEventListener("click", () => slideHero(parseInt(d.dataset.i)));
  });

  heroIndex = 0;
  slideHero(0);
  startHeroAutoplay();

  // Swipe support
  track.addEventListener("touchstart", (e) => {
    heroTouchStartX = e.touches[0].clientX;
  }, { passive: true });
  track.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - heroTouchStartX;
    if (Math.abs(dx) > 50) {
      if (dx < 0) slideHero(heroIndex + 1);
      else slideHero(heroIndex - 1);
    }
  }, { passive: true });
}

function slideHero(index) {
  if (index < 0) index = banners.length - 1;
  if (index >= banners.length) index = 0;
  heroIndex = index;
  const track = document.getElementById("hero-track");
  if (track) track.style.transform = `translateX(-${index * 100}%)`;
  document.querySelectorAll(".hero-dot").forEach((d, i) => {
    d.classList.toggle("active", i === index);
  });
}

function startHeroAutoplay() {
  clearInterval(heroInterval);
  heroInterval = setInterval(() => slideHero(heroIndex + 1), 4000);
}

// ── Home Page Rendering ──────────────────────────────────────
function renderHomeSections() {
  renderCatPills();
  renderSection("trending-list", products.filter((p) => p.is_featured));
  renderSection("new-list", products.filter((p) => p.is_new));
  renderSection("bestseller-list", products.filter((p) => p.is_bestseller));
  renderSection("premium-list", products.filter((p) => p.is_premium));
}

function renderCatPills() {
  const el = document.getElementById("home-cats");
  if (!el) return;
  el.innerHTML = categories
    .map(
      (c) => `
    <div class="cat-pill" onclick="filterByCategory(${c.id})" style="--cat-color:${c.color || "#333"}">
      <span class="cat-pill-icon">${c.icon || ""}</span>
      <span class="cat-pill-name">${c.name}</span>
    </div>`
    )
    .join("");
}

function renderSection(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<div class="empty-hint">No items yet</div>';
    return;
  }
  el.innerHTML = items.map((p) => productCardHTML(p)).join("");
}

function renderProductGrid(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = '<div class="empty-hint">No products found</div>';
    return;
  }
  el.innerHTML = items.map((p) => productCardHTML(p)).join("");
}

function productCardHTML(p) {
  const isFav = favs.includes(p.id);
  const cat = categories.find((c) => c.id === p.category_id);
  return `
    <div class="product-card" onclick="openProduct(${p.id})">
      <div class="pc-img-wrap">
        <img class="pc-img" src="${p.image_url || (p.images && p.images[0]) || ""}" alt="${p.name}" loading="lazy" />
        ${p.is_new ? '<span class="pc-badge badge-new">NEW</span>' : ""}
        ${p.is_bestseller ? '<span class="pc-badge badge-best">HOT</span>' : ""}
        ${p.is_premium ? '<span class="pc-badge badge-premium">PRO</span>' : ""}
        <button class="pc-fav${isFav ? " active" : ""}" onclick="event.stopPropagation();toggleFav(${p.id})">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        </button>
      </div>
      <div class="pc-info">
        ${cat ? `<div class="pc-cat" style="color:${cat.color || "#666"}">${cat.name}</div>` : ""}
        <div class="pc-name">${p.name}</div>
        <div class="pc-price">
          <span class="pc-cur">${fmtPrice(p.price)}</span>
          ${p.old_price ? `<span class="pc-old">${fmtPrice(p.old_price)}</span>` : ""}
        </div>
      </div>
    </div>`;
}

// ── Categories Page ──────────────────────────────────────────
function renderCategoriesPage() {
  const grid = document.getElementById("cats-grid");
  if (!grid) return;
  grid.innerHTML = categories
    .map(
      (c) => `
    <div class="cat-card" onclick="showCategoryProducts(${c.id})" style="--cat-color:${c.color || "#333"}">
      <div class="cat-card-icon">${c.icon || "📱"}</div>
      <div class="cat-card-name">${c.name}</div>
      <div class="cat-card-count">${products.filter((p) => p.category_id === c.id).length}</div>
    </div>`
    )
    .join("");
  clearCategoryFilter();
}

function showCategoryProducts(catId) {
  if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
  currentCategoryFilter = catId;
  const cat = categories.find((c) => c.id === catId);
  const section = document.getElementById("cat-products-section");
  const title = document.getElementById("cat-products-title");
  const container = document.getElementById("cat-products");
  if (section) section.style.display = "";
  if (title) title.textContent = cat ? cat.name : "Products";
  const filtered = products.filter((p) => p.category_id === catId);
  renderProductGrid("cat-products", filtered);
}

function clearCategoryFilter() {
  currentCategoryFilter = null;
  const section = document.getElementById("cat-products-section");
  if (section) section.style.display = "none";
}

function filterByCategory(catId) {
  if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
  openPage("page-categories");
  setTimeout(() => showCategoryProducts(catId), 100);
}

function showAllFiltered() {
  const container = document.getElementById("cat-products");
  renderProductGrid("cat-products", products);
  const title = document.getElementById("cat-products-title");
  if (title) title.textContent = "All Products";
}

// ── Search ───────────────────────────────────────────────────
function onSearchInput() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(doSearch, 300);
}

async function doSearch() {
  const input = document.getElementById("search-input");
  const clearBtn = document.getElementById("search-clear");
  const initial = document.getElementById("search-initial");
  const results = document.getElementById("search-results");
  const countEl = document.getElementById("search-count");
  const grid = document.getElementById("search-grid");
  const empty = document.getElementById("search-empty");

  const q = (input && input.value.trim().toLowerCase()) || "";
  if (clearBtn) clearBtn.style.display = q ? "" : "none";

  if (!q) {
    if (initial) initial.style.display = "";
    if (results) results.style.display = "none";
    return;
  }

  if (initial) initial.style.display = "none";
  if (results) results.style.display = "";
  if (empty) empty.style.display = "none";

  const matched = products.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      (p.description && p.description.toLowerCase().includes(q)) ||
      (p.phone_models && p.phone_models.toLowerCase().includes(q))
  );

  if (countEl) countEl.textContent = `${matched.length} result${matched.length !== 1 ? "s" : ""}`;

  if (!matched.length) {
    if (grid) grid.innerHTML = "";
    if (empty) empty.style.display = "";
    return;
  }

  renderProductGrid("search-grid", matched);
}

function clearSearch() {
  const input = document.getElementById("search-input");
  if (input) input.value = "";
  doSearch();
}

function setSearch(q) {
  const input = document.getElementById("search-input");
  if (input) input.value = q;
  doSearch();
  openPage("page-search");
}

// ── Product Detail & Gallery ─────────────────────────────────
function openProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("medium");

  // Save current page for back navigation
  const currentPage = document.querySelector(".page.active");
  if (currentPage) pageHistory.push(currentPage.id);

  currentProduct = p;
  const wrap = document.getElementById("product-detail-wrap");
  if (!wrap) return;

  const cat = categories.find((c) => c.id === p.category_id);
  const imgs = p.images && p.images.length ? p.images : p.image_url ? [p.image_url] : [];

  wrap.innerHTML = `
    <div class="pd-gallery">
      <div class="gallery-container">
        <div class="gallery-track" id="gallery-track">
          ${imgs.map((img) => `<div class="gallery-slide"><img src="${img}" alt="${p.name}" /></div>`).join("")}
          ${!imgs.length ? '<div class="gallery-slide gallery-no-img">No Image</div>' : ""}
        </div>
        <div class="gallery-dots" id="gallery-dots">
          ${imgs.map((_, i) => `<div class="gallery-dot${i === 0 ? " active" : ""}" data-i="${i}"></div>`).join("")}
        </div>
      </div>
      <button class="gallery-fullscreen" onclick="openGallery()">⤢</button>
    </div>
    <div class="pd-body">
      ${cat ? `<div class="pd-cat" style="color:${cat.color || "#666"}">${cat.name}</div>` : ""}
      <h1 class="pd-name">${p.name}</h1>
      <div class="pd-price-row">
        <span class="pd-price">${fmtPrice(p.price)}</span>
        ${p.old_price ? `<span class="pd-old-price">${fmtPrice(p.old_price)}</span>` : ""}
        ${p.old_price ? `<span class="pd-discount">-${Math.round(((p.old_price - p.price) / p.old_price) * 100)}%</span>` : ""}
      </div>
      ${p.phone_models ? `<div class="pd-models">📱 Compatible: ${p.phone_models}</div>` : ""}
      <div class="pd-desc">${p.description || ""}</div>
      <div class="pd-stock${p.stock > 0 ? " in-stock" : " out-stock"}">
        ${p.stock > 0 ? `✓ In stock (${p.stock})` : "✕ Out of stock"}
      </div>
      <div class="pd-badges">
        ${p.is_new ? '<span class="pd-badge badge-new">New</span>' : ""}
        ${p.is_bestseller ? '<span class="pd-badge badge-best">Bestseller</span>' : ""}
        ${p.is_premium ? '<span class="pd-badge badge-premium">Premium</span>' : ""}
        ${p.is_featured ? '<span class="pd-badge badge-featured">Featured</span>' : ""}
      </div>
      <div class="pd-actions">
        <button class="btn-fav${favs.includes(p.id) ? " active" : ""}" onclick="toggleFav(${p.id});openProduct(${p.id})">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        </button>
        <button class="btn-add-cart${p.stock <= 0 ? " disabled" : ""}" onclick="${p.stock > 0 ? `addToCart(${p.id})` : ""}">
          ${p.stock > 0 ? "Add to Cart" : "Out of Stock"}
        </button>
      </div>
    </div>`;

  // Gallery swipe
  galleryIndex = 0;
  setupGallerySwipe();

  navigateTo("page-product");
}

function setupGallerySwipe() {
  const track = document.getElementById("gallery-track");
  if (!track) return;
  track.addEventListener("touchstart", (e) => {
    galleryTouchStartX = e.touches[0].clientX;
  }, { passive: true });
  track.addEventListener("touchend", (e) => {
    const p = currentProduct;
    if (!p) return;
    const imgs = p.images && p.images.length ? p.images : [];
    const dx = e.changedTouches[0].clientX - galleryTouchStartX;
    if (Math.abs(dx) > 50) {
      if (dx < 0) slideGallery(galleryIndex + 1, imgs.length);
      else slideGallery(galleryIndex - 1, imgs.length);
    }
  }, { passive: true });
}

function slideGallery(index, total) {
  if (index < 0) index = 0;
  if (index >= total) index = total - 1;
  galleryIndex = index;
  const track = document.getElementById("gallery-track");
  if (track) track.style.transform = `translateX(-${index * 100}%)`;
  document.querySelectorAll("#gallery-dots .gallery-dot").forEach((d, i) => {
    d.classList.toggle("active", i === index);
  });
}

function openGallery() {
  if (!currentProduct) return;
  const imgs = currentProduct.images && currentProduct.images.length ? currentProduct.images : [];
  if (!imgs.length) return;
  // Simple fullscreen overlay gallery
  const overlay = document.createElement("div");
  overlay.className = "gallery-overlay";
  overlay.innerHTML = `
    <div class="gallery-fs-close" onclick="this.parentElement.remove()">✕</div>
    <div class="gallery-fs-track" style="transform:translateX(-${galleryIndex * 100}%)">
      ${imgs.map((img) => `<div class="gallery-fs-slide"><img src="${img}" alt="" /></div>`).join("")}
    </div>
    <div class="gallery-fs-dots">
      ${imgs.map((_, i) => `<div class="gallery-fs-dot${i === galleryIndex ? " active" : ""}"></div>`).join("")}
    </div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

// ── Cart System ──────────────────────────────────────────────
function loadCart() {
  try {
    cart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    cart = [];
  }
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function updateCartBadge() {
  const badge = document.getElementById("cart-badge");
  if (!badge) return;
  const count = cart.reduce((s, i) => s + i.qty, 0);
  badge.textContent = count;
  badge.style.display = count > 0 ? "" : "none";
}

function addToCart(productId) {
  const p = products.find((x) => x.id === productId);
  if (!p || p.stock <= 0) return;
  if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");

  const existing = cart.find((i) => i.id === productId);
  if (existing) {
    if (existing.qty < p.stock) existing.qty++;
  } else {
    cart.push({
      id: p.id,
      name: p.name,
      price: p.price,
      image_url: p.image_url || (p.images && p.images[0]) || "",
      qty: 1,
    });
  }
  saveCart();
  toast("Added to cart");
}

function openCart() {
  renderCartModal();
  openModal("cart-modal");
}

function renderCartModal() {
  const list = document.getElementById("cart-list");
  const footer = document.getElementById("cart-footer");
  const empty = document.getElementById("cart-empty");
  const totalEl = document.getElementById("cart-total");

  if (!cart.length) {
    if (list) list.innerHTML = "";
    if (footer) footer.style.display = "none";
    if (empty) empty.style.display = "";
    return;
  }

  if (empty) empty.style.display = "none";
  if (footer) footer.style.display = "";

  if (list) {
    list.innerHTML = cart
      .map(
        (item) => `
      <div class="cart-item">
        <img class="ci-img" src="${item.image_url}" alt="${item.name}" />
        <div class="ci-info">
          <div class="ci-name">${item.name}</div>
          <div class="ci-price">${fmtPrice(item.price)}</div>
        </div>
        <div class="ci-qty">
          <button class="ci-btn" onclick="changeQty(${item.id},-1)">−</button>
          <span>${item.qty}</span>
          <button class="ci-btn" onclick="changeQty(${item.id},1)">+</button>
        </div>
        <button class="ci-remove" onclick="removeFromCart(${item.id})">✕</button>
      </div>`
      )
      .join("");
  }

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  if (totalEl) totalEl.textContent = fmtPrice(total);
}

function changeQty(productId, delta) {
  const item = cart.find((i) => i.id === productId);
  if (!item) return;
  const p = products.find((x) => x.id === productId);
  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter((i) => i.id !== productId);
  } else if (p && item.qty > p.stock) {
    item.qty = p.stock;
    toast("Maximum stock reached");
  }
  saveCart();
  renderCartModal();
}

function removeFromCart(productId) {
  cart = cart.filter((i) => i.id !== productId);
  saveCart();
  renderCartModal();
  if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("warning");
}

// ── Order System ─────────────────────────────────────────────
function openOrderModal() {
  if (!cart.length) {
    toast("Cart is empty");
    return;
  }
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const totalEl = document.getElementById("o-total");
  const summaryEl = document.getElementById("o-summary");
  const phoneEl = document.getElementById("o-phone");

  if (totalEl) totalEl.textContent = fmtPrice(total);
  if (summaryEl) {
    summaryEl.innerHTML = cart
      .map((i) => `<div class="os-item"><span>${i.name} ×${i.qty}</span><span>${fmtPrice(i.price * i.qty)}</span></div>`)
      .join("");
  }
  if (phoneEl && user.username) phoneEl.value = user.username;

  openModal("order-modal");
}

async function placeOrder() {
  const phone = document.getElementById("o-phone")?.value.trim();
  const address = document.getElementById("o-address")?.value.trim();
  const payment = document.getElementById("o-payment")?.value;
  const note = document.getElementById("o-note")?.value.trim();

  if (!phone) {
    toast("Please enter your phone number");
    return;
  }
  if (!address) {
    toast("Please enter your delivery address");
    return;
  }

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const items = cart.map((i) => ({
    id: i.id,
    name: i.name,
    price: i.price,
    qty: i.qty,
  }));

  const orderData = {
    user_telegram_id: user.id,
    user_name: `${user.first_name}${user.last_name ? " " + user.last_name : ""}`,
    phone,
    address,
    note,
    items,
    total,
    status: "pending",
    payment_method: payment || "cash",
  };

  try {
    const { data, error } = await db.from("orders").insert(orderData).select().single();
    if (error) throw error;

    // Send data back to bot
    if (tg && tg.sendData) {
      tg.sendData(
        JSON.stringify({
          action: "new_order",
          order_id: data.id,
          total,
          phone,
          address,
        })
      );
    }

    cart = [];
    saveCart();
    closeModal("order-modal");
    toast("Order placed successfully! 🎉");
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
  } catch (e) {
    console.error("Place order error:", e);
    toast("Failed to place order. Please try again.");
  }
}

// ── Orders Page ──────────────────────────────────────────────
function renderOrdersPage() {
  const list = document.getElementById("orders-list");
  const empty = document.getElementById("orders-empty");
  if (!list) return;

  filterUserOrders();
}

async function filterUserOrders() {
  const list = document.getElementById("orders-list");
  const empty = document.getElementById("orders-empty");
  if (!list) return;

  try {
    const { data, error } = await db
      .from("orders")
      .select("*")
      .eq("user_telegram_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const orders = data || [];
    if (!orders.length) {
      list.innerHTML = "";
      if (empty) empty.style.display = "";
      return;
    }
    if (empty) empty.style.display = "none";

    list.innerHTML = orders
      .map(
        (o) => `
      <div class="order-card" onclick="openOrderDetailModal(${o.id})">
        <div class="oc-header">
          <span class="oc-id">#${o.id}</span>
          ${statusLabel(o.status)}
        </div>
        <div class="oc-date">${fmtDate(o.created_at)}</div>
        <div class="oc-items">${o.items ? o.items.length : 0} item${(o.items && o.items.length) !== 1 ? "s" : ""}</div>
        <div class="oc-total">${fmtPrice(o.total)}</div>
      </div>`
      )
      .join("");
  } catch (e) {
    console.warn("Filter orders error:", e);
    list.innerHTML = '<div class="empty-hint">Could not load orders</div>';
  }
}

function openOrderDetailModal(orderId) {
  // Implemented in admin section; reuse for user too
  openOrderDetail(orderId);
}

// ── Profile & Favorites ──────────────────────────────────────
async function renderProfile() {
  const ava = document.getElementById("profile-ava");
  const nameEl = document.getElementById("profile-name");
  const unameEl = document.getElementById("profile-uname");
  const stOrders = document.getElementById("st-orders");
  const stFavs = document.getElementById("st-favs");
  const stSpent = document.getElementById("st-spent");
  const adminRow = document.getElementById("admin-menu-row");

  if (ava) ava.textContent = (user.first_name || "G")[0].toUpperCase();
  if (nameEl) nameEl.textContent = `${user.first_name}${user.last_name ? " " + user.last_name : ""}`;
  if (unameEl) unameEl.textContent = user.username ? `@${user.username}` : "";
  if (adminRow) adminRow.style.display = isAdmin ? "" : "none";

  // Stats
  try {
    const { data: orders } = await db
      .from("orders")
      .select("total")
      .eq("user_telegram_id", user.id);
    const totalOrders = orders ? orders.length : 0;
    const totalSpent = orders ? orders.reduce((s, o) => s + (o.total || 0), 0) : 0;
    if (stOrders) stOrders.textContent = totalOrders;
    if (stSpent) stSpent.textContent = fmtShort(totalSpent);
  } catch {
    if (stOrders) stOrders.textContent = "0";
    if (stSpent) stSpent.textContent = "0";
  }

  if (stFavs) stFavs.textContent = favs.length;

  renderFavorites();
}

function renderFavorites() {
  const grid = document.getElementById("favs-grid");
  if (!grid) return;
  const favProducts = products.filter((p) => favs.includes(p.id));
  if (!favProducts.length) {
    grid.innerHTML = '<div class="empty-hint">No favorites yet</div>';
    return;
  }
  grid.innerHTML = favProducts.map((p) => productCardHTML(p)).join("");
}

function toggleFav(productId) {
  if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
  const idx = favs.indexOf(productId);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.push(productId);
  }
  localStorage.setItem(FAVS_KEY, JSON.stringify(favs));
  // Re-render current view
  renderHomeSections();
  if (document.getElementById("page-profile").classList.contains("active")) renderFavorites();
  if (currentProduct) openProduct(currentProduct.id);
}

// ── Custom Requests ──────────────────────────────────────────
function previewReqImg(inputId) {
  const input = document.getElementById(inputId || "req-img-inp");
  const ph = document.getElementById("req-img-ph");
  const prev = document.getElementById("req-img-prev");
  if (!input || !input.files || !input.files[0]) return;

  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = (e) => {
    if (ph) ph.style.display = "none";
    if (prev) {
      prev.src = e.target.result;
      prev.style.display = "";
    }
  };
  reader.readAsDataURL(file);
}

async function submitRequest() {
  const desc = document.getElementById("req-desc")?.value.trim();
  const model = document.getElementById("req-model")?.value.trim();
  const contact = document.getElementById("req-contact")?.value.trim();
  const imgInput = document.getElementById("req-img-inp");

  if (!desc) {
    toast("Please describe what you need");
    return;
  }

  let imageUrl = null;

  // Upload image if provided
  if (imgInput && imgInput.files && imgInput.files[0]) {
    try {
      const file = imgInput.files[0];
      const ext = file.name.split(".").pop();
      const path = `${user.id}_${Date.now()}.${ext}`;
      const { data, error } = await storage.from("requests").upload(path, file);
      if (!error && data) {
        const { data: urlData } = storage.from("requests").getPublicUrl(data.path);
        imageUrl = urlData.publicUrl;
      }
    } catch (e) {
      console.warn("Image upload error:", e);
    }
  }

  try {
    const { error } = await db.from("custom_requests").insert({
      user_telegram_id: user.id,
      user_name: `${user.first_name}${user.last_name ? " " + user.last_name : ""}`,
      description: desc,
      phone_model: model || null,
      contact: contact || null,
      image_url: imageUrl,
      status: "pending",
    });
    if (error) throw error;

    toast("Request submitted! We'll get back to you soon.");
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
    closeModal("request-modal");

    // Clear form
    if (document.getElementById("req-desc")) document.getElementById("req-desc").value = "";
    if (document.getElementById("req-model")) document.getElementById("req-model").value = "";
    if (document.getElementById("req-contact")) document.getElementById("req-contact").value = "";
    const ph = document.getElementById("req-img-ph");
    const prev = document.getElementById("req-img-prev");
    if (ph) ph.style.display = "";
    if (prev) prev.style.display = "none";
  } catch (e) {
    console.error("Submit request error:", e);
    toast("Failed to submit request");
  }
}

// ══════════════════════════════════════════════════════════════
// ADMIN PANEL
// ══════════════════════════════════════════════════════════════

// ── Admin Tab Switching ──────────────────────────────────────
function switchTab(tabName) {
  if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
  document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".admin-section").forEach((s) => s.classList.remove("active"));

  const tab = document.querySelector(`.admin-tab[data-tab="${tabName}"]`);
  const section = document.getElementById(`admin-sec-${tabName}`);
  if (tab) tab.classList.add("active");
  if (section) section.classList.add("active");

  // Load data for tab
  switch (tabName) {
    case "dashboard": renderAdminDashboard(); break;
    case "products": renderAdminProducts(); break;
    case "categories": renderAdminCategories(); break;
    case "orders": renderAdminOrders(); break;
    case "requests": renderAdminRequests(); break;
    case "banners": renderAdminBanners(); break;
    case "users": renderAdminUsers(); break;
    case "broadcast": loadBroadcastHistory(); break;
  }
}

// ── Admin Data Loading ───────────────────────────────────────
async function loadAdminData() {
  await Promise.all([fetchProducts(), fetchCategories(), fetchBanners()]);
  renderAdminDashboard();
}

// ── Admin Dashboard ──────────────────────────────────────────
async function renderAdminDashboard() {
  try {
    const [prodRes, orderRes, userRes] = await Promise.all([
      db.from("products").select("id", { count: "exact" }),
      db.from("orders").select("id, total, status"),
      db.from("users").select("id", { count: "exact" }),
    ]);

    const totalProducts = prodRes.count || (prodRes.data && prodRes.data.length) || 0;
    const totalOrders = orderRes.data ? orderRes.data.length : 0;
    const totalUsers = userRes.count || (userRes.data && userRes.data.length) || 0;
    const totalRevenue = orderRes.data ? orderRes.data.reduce((s, o) => s + (o.total || 0), 0) : 0;
    const pendingOrders = orderRes.data ? orderRes.data.filter((o) => o.status === "pending").length : 0;
    const deliveredOrders = orderRes.data ? orderRes.data.filter((o) => o.status === "delivered").length : 0;

    const el = (id, val) => {
      const e = document.getElementById(id);
      if (e) e.textContent = val;
    };
    el("as-products", totalProducts);
    el("as-orders", totalOrders);
    el("as-users", totalUsers);
    el("as-revenue", fmtShort(totalRevenue));
    el("as-pending", pendingOrders);
    el("as-delivered", deliveredOrders);
  } catch (e) {
    console.warn("Dashboard stats error:", e);
  }

  // Recent orders
  try {
    const { data: recent } = await db
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);
    const recentEl = document.getElementById("a-recent-orders");
    if (recentEl) {
      recentEl.innerHTML = (recent || [])
        .map(
          (o) => `
        <div class="admin-list-item" onclick="openOrderDetail(${o.id})">
          <span class="ali-id">#${o.id}</span>
          <span class="ali-name">${o.user_name || "Unknown"}</span>
          <span class="ali-total">${fmtPrice(o.total)}</span>
          ${statusLabel(o.status)}
        </div>`
        )
        .join("");
    }
  } catch (e) {
    console.warn("Recent orders error:", e);
  }

  // Recent requests
  try {
    const { data: recentReq } = await db
      .from("custom_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);
    const reqEl = document.getElementById("a-recent-requests");
    if (reqEl) {
      reqEl.innerHTML = (recentReq || [])
        .map(
          (r) => `
        <div class="admin-list-item">
          <span class="ali-name">${r.user_name || "Unknown"}</span>
          <span class="ali-desc">${(r.description || "").substring(0, 50)}${(r.description || "").length > 50 ? "..." : ""}</span>
          ${statusLabel(r.status)}
        </div>`
        )
        .join("");
    }
  } catch (e) {
    console.warn("Recent requests error:", e);
  }
}

// ── Admin Products ───────────────────────────────────────────
function renderAdminProducts() {
  const list = document.getElementById("a-products-list");
  if (!list) return;
  list.innerHTML = products
    .map(
      (p) => `
    <div class="admin-list-item">
      <img class="ali-img" src="${p.image_url || (p.images && p.images[0]) || ""}" alt="" />
      <span class="ali-name">${p.name}</span>
      <span class="ali-price">${fmtPrice(p.price)}</span>
      <span class="ali-stock">Stock: ${p.stock}</span>
      <div class="ali-actions">
        <button class="btn-sm" onclick="openProductForm(${p.id})">Edit</button>
        <button class="btn-sm btn-danger" onclick="deleteProduct(${p.id})">Del</button>
      </div>
    </div>`
    )
    .join("");
}

function openProductForm(id) {
  clearProductForm();
  if (id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const el = (fid, val) => {
      const e = document.getElementById(fid);
      if (e) e.value = val != null ? val : "";
    };
    el("pf-id", p.id);
    el("pf-title", p.name);
    el("pf-name", p.name);
    el("pf-desc", p.description);
    el("pf-price", p.price);
    el("pf-old-price", p.old_price);
    el("pf-stock", p.stock);
    el("pf-category", p.category_id);
    el("pf-models", p.phone_models);
    const setCheck = (fid, val) => {
      const e = document.getElementById(fid);
      if (e) e.checked = !!val;
    };
    setCheck("pf-featured", p.is_featured);
    setCheck("pf-new", p.is_new);
    setCheck("pf-bestseller", p.is_bestseller);
    setCheck("pf-premium", p.is_premium);
    // Show existing images
    const imgs = p.images || [];
    productImgFiles = imgs.map((url) => ({ url, isExisting: true }));
    renderProductImgThumbs();
  }
  populateCategorySelect();
  openModal("product-form-modal");
}

function clearProductForm() {
  productImgFiles = [];
  const el = (fid) => {
    const e = document.getElementById(fid);
    if (e) {
      if (e.type === "checkbox") e.checked = false;
      else if (e.tagName === "SELECT") e.selectedIndex = 0;
      else e.value = "";
    }
  };
  ["pf-id", "pf-title", "pf-name", "pf-desc", "pf-price", "pf-old-price", "pf-stock", "pf-category", "pf-models"].forEach(el);
  ["pf-featured", "pf-new", "pf-bestseller", "pf-premium"].forEach(el);
  renderProductImgThumbs();
  const prog = document.getElementById("pf-upload-progress");
  if (prog) prog.style.display = "none";
}

function populateCategorySelect() {
  const sel = document.getElementById("pf-category");
  if (!sel) return;
  sel.innerHTML = '<option value="">Select category</option>' +
    categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
}

function addProductImgs() {
  const input = document.getElementById("pf-imgs");
  if (!input || !input.files) return;
  Array.from(input.files).forEach((file) => {
    productImgFiles.push({ file, isExisting: false });
  });
  renderProductImgThumbs();
}

function renderProductImgThumbs() {
  const container = document.getElementById("pf-thumbs");
  if (!container) return;
  container.innerHTML = productImgFiles
    .map(
      (img, i) => `
    <div class="pf-thumb">
      <img src="${img.isExisting ? img.url : URL.createObjectURL(img.file)}" alt="" />
      <button class="pf-thumb-remove" onclick="removeProductImg(${i})">✕</button>
    </div>`
    )
    .join("");
}

function removeProductImg(index) {
  productImgFiles.splice(index, 1);
  renderProductImgThumbs();
}

async function saveProduct() {
  const id = document.getElementById("pf-id")?.value;
  const name = document.getElementById("pf-name")?.value.trim();
  const desc = document.getElementById("pf-desc")?.value.trim();
  const price = parseFloat(document.getElementById("pf-price")?.value) || 0;
  const old_price = parseFloat(document.getElementById("pf-old-price")?.value) || null;
  const stock = parseInt(document.getElementById("pf-stock")?.value) || 0;
  const category_id = parseInt(document.getElementById("pf-category")?.value) || null;
  const phone_models = document.getElementById("pf-models")?.value.trim() || null;
  const is_featured = document.getElementById("pf-featured")?.checked || false;
  const is_new = document.getElementById("pf-new")?.checked || false;
  const is_bestseller = document.getElementById("pf-bestseller")?.checked || false;
  const is_premium = document.getElementById("pf-premium")?.checked || false;

  if (!name || !price) {
    toast("Name and price are required");
    return;
  }

  // Upload new images
  const uploadedUrls = [];
  const progressEl = document.getElementById("pf-upload-progress");
  const progressBar = document.getElementById("pf-progress-bar");
  const progressText = document.getElementById("pf-progress-text");

  const newFiles = productImgFiles.filter((f) => !f.isExisting);
  const existingUrls = productImgFiles.filter((f) => f.isExisting).map((f) => f.url);

  if (newFiles.length && progressEl) {
    progressEl.style.display = "";
  }

  for (let i = 0; i < newFiles.length; i++) {
    try {
      const file = newFiles[i].file;
      const ext = file.name.split(".").pop();
      const path = `product_${Date.now()}_${i}.${ext}`;
      const { data, error } = await storage.from("products").upload(path, file);
      if (error) throw error;
      const { data: urlData } = storage.from("products").getPublicUrl(data.path);
      uploadedUrls.push(urlData.publicUrl);
      if (progressBar) progressBar.style.width = `${((i + 1) / newFiles.length) * 100}%`;
      if (progressText) progressText.textContent = `Uploading ${i + 1}/${newFiles.length}`;
    } catch (e) {
      console.warn("Image upload error:", e);
    }
  }

  if (progressEl) progressEl.style.display = "none";

  const allImages = [...existingUrls, ...uploadedUrls];
  const image_url = allImages[0] || null;
  const images = allImages;

  const productData = {
    name,
    description: desc,
    price,
    old_price,
    stock,
    category_id,
    phone_models,
    images,
    image_url,
    is_featured,
    is_new,
    is_bestseller,
    is_premium,
    updated_at: new Date().toISOString(),
  };

  try {
    if (id) {
      const { error } = await db.from("products").update(productData).eq("id", id);
      if (error) throw error;
      toast("Product updated");
    } else {
      const { error } = await db.from("products").insert(productData);
      if (error) throw error;
      toast("Product added");
    }
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
    closeModal("product-form-modal");
    await fetchProducts();
    renderAdminProducts();
  } catch (e) {
    console.error("Save product error:", e);
    toast("Failed to save product");
  }
}

async function deleteProduct(id) {
  if (!confirm("Delete this product?")) return;
  try {
    const { error } = await db.from("products").delete().eq("id", id);
    if (error) throw error;
    toast("Product deleted");
    await fetchProducts();
    renderAdminProducts();
  } catch (e) {
    console.error("Delete product error:", e);
    toast("Failed to delete product");
  }
}

// ── Admin Categories ─────────────────────────────────────────
function renderAdminCategories() {
  const list = document.getElementById("a-categories-list");
  if (!list) return;
  list.innerHTML = categories
    .map(
      (c) => `
    <div class="admin-list-item">
      <span class="ali-icon">${c.icon || ""}</span>
      <span class="ali-name">${c.name}</span>
      <span class="ali-color" style="background:${c.color || "#ccc"}"></span>
      <div class="ali-actions">
        <button class="btn-sm" onclick="openCategoryForm(${c.id})">Edit</button>
        <button class="btn-sm btn-danger" onclick="deleteCategory(${c.id})">Del</button>
      </div>
    </div>`
    )
    .join("");
}

function openCategoryForm(id) {
  const el = (fid, val) => {
    const e = document.getElementById(fid);
    if (e) e.value = val != null ? val : "";
  };
  el("cf-id", "");
  el("cf-name", "");
  el("cf-icon", "");
  el("cf-color", "#333333");

  if (id) {
    const c = categories.find((x) => x.id === id);
    if (!c) return;
    el("cf-id", c.id);
    el("cf-name", c.name);
    el("cf-icon", c.icon || "");
    el("cf-color", c.color || "#333333");
  }
  openModal("category-form-modal");
}

async function saveCategory() {
  const id = document.getElementById("cf-id")?.value;
  const name = document.getElementById("cf-name")?.value.trim();
  const icon = document.getElementById("cf-icon")?.value.trim();
  const color = document.getElementById("cf-color")?.value || "#333333";

  if (!name) {
    toast("Category name is required");
    return;
  }

  try {
    if (id) {
      const { error } = await db.from("categories").update({ name, icon, color }).eq("id", id);
      if (error) throw error;
      toast("Category updated");
    } else {
      const { error } = await db.from("categories").insert({ name, icon, color });
      if (error) throw error;
      toast("Category added");
    }
    closeModal("category-form-modal");
    await fetchCategories();
    renderAdminCategories();
  } catch (e) {
    console.error("Save category error:", e);
    toast("Failed to save category");
  }
}

async function deleteCategory(id) {
  if (!confirm("Delete this category?")) return;
  try {
    const { error } = await db.from("categories").delete().eq("id", id);
    if (error) throw error;
    toast("Category deleted");
    await fetchCategories();
    renderAdminCategories();
  } catch (e) {
    console.error("Delete category error:", e);
    toast("Failed to delete category");
  }
}

// ── Admin Orders ─────────────────────────────────────────────
async function renderAdminOrders() {
  const list = document.getElementById("a-orders-list");
  if (!list) return;

  try {
    const { data, error } = await db.from("orders").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    const orders = data || [];
    list.innerHTML = orders
      .map(
        (o) => `
      <div class="admin-list-item" onclick="openOrderDetail(${o.id})">
        <span class="ali-id">#${o.id}</span>
        <span class="ali-name">${o.user_name || "Unknown"}</span>
        <span class="ali-total">${fmtPrice(o.total)}</span>
        ${statusLabel(o.status)}
        <span class="ali-date">${fmtDate(o.created_at)}</span>
      </div>`
      )
      .join("");
    if (!orders.length) list.innerHTML = '<div class="empty-hint">No orders yet</div>';
  } catch (e) {
    console.warn("Admin orders error:", e);
    list.innerHTML = '<div class="empty-hint">Could not load orders</div>';
  }
}

async function updateOrderStatus(orderId, newStatus) {
  try {
    const { error } = await db.from("orders").update({ status: newStatus }).eq("id", orderId);
    if (error) throw error;
    toast("Order status updated");
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
    renderAdminOrders();
    renderAdminDashboard();
  } catch (e) {
    console.error("Update order status error:", e);
    toast("Failed to update status");
  }
}

async function openOrderDetail(orderId) {
  try {
    const { data, error } = await db.from("orders").select("*").eq("id", orderId).single();
    if (error) throw error;
    const o = data;
    const body = document.getElementById("order-detail-body");
    if (!body) return;

    body.innerHTML = `
      <div class="od-header">
        <span class="od-id">Order #${o.id}</span>
        ${statusLabel(o.status)}
      </div>
      <div class="od-section">
        <div class="od-label">Customer</div>
        <div class="od-value">${o.user_name || "Unknown"}</div>
      </div>
      <div class="od-section">
        <div class="od-label">Phone</div>
        <div class="od-value">${o.phone || "-"}</div>
      </div>
      <div class="od-section">
        <div class="od-label">Address</div>
        <div class="od-value">${o.address || "-"}</div>
      </div>
      <div class="od-section">
        <div class="od-label">Payment Method</div>
        <div class="od-value">${o.payment_method || "cash"}</div>
      </div>
      ${o.note ? `<div class="od-section"><div class="od-label">Note</div><div class="od-value">${o.note}</div></div>` : ""}
      <div class="od-section">
        <div class="od-label">Date</div>
        <div class="od-value">${fmtDate(o.created_at)}</div>
      </div>
      <div class="od-section">
        <div class="od-label">Items</div>
        <div class="od-items">
          ${(o.items || [])
            .map(
              (i) => `
            <div class="od-item">
              <span>${i.name}</span>
              <span>×${i.qty}</span>
              <span>${fmtPrice(i.price * i.qty)}</span>
            </div>`
            )
            .join("")}
        </div>
      </div>
      <div class="od-section od-total-section">
        <div class="od-label">Total</div>
        <div class="od-total-value">${fmtPrice(o.total)}</div>
      </div>
      ${isAdmin ? `
        <div class="od-section">
          <div class="od-label">Update Status</div>
          <select class="od-status-select" onchange="updateOrderStatus(${o.id}, this.value)">
            <option value="pending" ${o.status === "pending" ? "selected" : ""}>Pending</option>
            <option value="confirmed" ${o.status === "confirmed" ? "selected" : ""}>Confirmed</option>
            <option value="processing" ${o.status === "processing" ? "selected" : ""}>Processing</option>
            <option value="shipped" ${o.status === "shipped" ? "selected" : ""}>Shipped</option>
            <option value="delivered" ${o.status === "delivered" ? "selected" : ""}>Delivered</option>
            <option value="cancelled" ${o.status === "cancelled" ? "selected" : ""}>Cancelled</option>
          </select>
        </div>
      ` : ""}
    `;
    openModal("order-detail-modal");
  } catch (e) {
    console.error("Order detail error:", e);
    toast("Could not load order details");
  }
}

// ── Admin Requests ───────────────────────────────────────────
async function renderAdminRequests() {
  const list = document.getElementById("a-requests-list");
  if (!list) return;

  try {
    const { data, error } = await db.from("custom_requests").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    const requests = data || [];
    list.innerHTML = requests
      .map(
        (r) => `
      <div class="admin-list-item ali-col">
        <div class="ali-row">
          <span class="ali-name">${r.user_name || "Unknown"}</span>
          ${statusLabel(r.status)}
        </div>
        <div class="ali-desc">${r.description || ""}</div>
        ${r.phone_model ? `<div class="ali-model">📱 ${r.phone_model}</div>` : ""}
        ${r.contact ? `<div class="ali-contact">📞 ${r.contact}</div>` : ""}
        ${r.image_url ? `<img class="ali-req-img" src="${r.image_url}" alt="" />` : ""}
        ${r.admin_reply ? `<div class="ali-reply">💬 ${r.admin_reply}</div>` : ""}
        <div class="ali-actions">
          <select class="req-status-sel" onchange="updateRequestStatus(${r.id}, this.value)">
            <option value="pending" ${r.status === "pending" ? "selected" : ""}>Pending</option>
            <option value="in_progress" ${r.status === "in_progress" ? "selected" : ""}>In Progress</option>
            <option value="completed" ${r.status === "completed" ? "selected" : ""}>Completed</option>
            <option value="rejected" ${r.status === "rejected" ? "selected" : ""}>Rejected</option>
          </select>
          <button class="btn-sm" onclick="replyToRequest(${r.id})">Reply</button>
        </div>
      </div>`
      )
      .join("");
    if (!requests.length) list.innerHTML = '<div class="empty-hint">No requests yet</div>';
  } catch (e) {
    console.warn("Admin requests error:", e);
    list.innerHTML = '<div class="empty-hint">Could not load requests</div>';
  }
}

async function updateRequestStatus(reqId, newStatus) {
  try {
    const { error } = await db.from("custom_requests").update({ status: newStatus }).eq("id", reqId);
    if (error) throw error;
    toast("Request status updated");
    renderAdminRequests();
  } catch (e) {
    console.error("Update request status error:", e);
    toast("Failed to update status");
  }
}

async function replyToRequest(reqId) {
  const reply = prompt("Enter your reply:");
  if (!reply) return;
  try {
    const { error } = await db.from("custom_requests").update({ admin_reply: reply }).eq("id", reqId);
    if (error) throw error;
    toast("Reply sent");
    renderAdminRequests();
  } catch (e) {
    console.error("Reply error:", e);
    toast("Failed to send reply");
  }
}

// ── Admin Banners ────────────────────────────────────────────
async function renderAdminBanners() {
  const list = document.getElementById("a-banners-list");
  if (!list) return;

  try {
    const { data, error } = await db.from("banners").select("*").order("sort_order");
    if (error) throw error;
    const bannerList = data || [];
    list.innerHTML = bannerList
      .map(
        (b) => `
      <div class="admin-list-item">
        ${b.image_url ? `<img class="ali-img" src="${b.image_url}" alt="" />` : ""}
        <span class="ali-name">${b.title || "Untitled"}</span>
        <span class="ali-sub">${b.subtitle || ""}</span>
        <span class="ali-order">Order: ${b.sort_order || 0}</span>
        <span class="ali-active">${b.is_active ? "✓ Active" : "✕ Inactive"}</span>
        <div class="ali-actions">
          <button class="btn-sm" onclick="openBannerForm(${b.id})">Edit</button>
          <button class="btn-sm btn-danger" onclick="deleteBanner(${b.id})">Del</button>
        </div>
      </div>`
      )
      .join("");
    if (!bannerList.length) list.innerHTML = '<div class="empty-hint">No banners yet</div>';
  } catch (e) {
    console.warn("Admin banners error:", e);
    // Use local banners as fallback
    list.innerHTML = banners
      .map(
        (b) => `
      <div class="admin-list-item">
        <span class="ali-name">${b.title || "Untitled"}</span>
        <div class="ali-actions">
          <button class="btn-sm" onclick="openBannerForm(${b.id})">Edit</button>
          <button class="btn-sm btn-danger" onclick="deleteBanner(${b.id})">Del</button>
        </div>
      </div>`
      )
      .join("");
  }
}

function openBannerForm(id) {
  const el = (fid, val) => {
    const e = document.getElementById(fid);
    if (e) {
      if (e.type === "checkbox") e.checked = !!val;
      else e.value = val != null ? val : "";
    }
  };
  el("bf-id", "");
  el("bf-title", "");
  el("bf-sub", "");
  el("bf-order", 0);
  el("bf-icon", "");
  el("bf-active", true);
  bannerImgFile = null;

  const ph = document.getElementById("bf-img-ph");
  const prev = document.getElementById("bf-img-prev");
  if (ph) ph.style.display = "";
  if (prev) prev.style.display = "none";

  if (id) {
    // Find from loaded banners
    db.from("banners").select("*").eq("id", id).single().then(({ data }) => {
      if (data) {
        el("bf-id", data.id);
        el("bf-title", data.title);
        el("bf-sub", data.subtitle);
        el("bf-order", data.sort_order);
        el("bf-icon", data.icon);
        el("bf-active", data.is_active);
        if (data.image_url) {
          if (ph) ph.style.display = "none";
          if (prev) {
            prev.src = data.image_url;
            prev.style.display = "";
          }
        }
        if (data.color) {
          const colorInp = document.getElementById("bf-color");
          if (colorInp) colorInp.value = data.color;
        }
      }
    });
  }
  openModal("banner-form-modal");
}

function previewBannerImg() {
  const input = document.getElementById("bf-img");
  if (!input || !input.files || !input.files[0]) return;

  bannerImgFile = input.files[0];
  const ph = document.getElementById("bf-img-ph");
  const prev = document.getElementById("bf-img-prev");
  const reader = new FileReader();
  reader.onload = (e) => {
    if (ph) ph.style.display = "none";
    if (prev) {
      prev.src = e.target.result;
      prev.style.display = "";
    }
  };
  reader.readAsDataURL(bannerImgFile);
}

async function saveBanner() {
  const id = document.getElementById("bf-id")?.value;
  const title = document.getElementById("bf-title")?.value.trim();
  const subtitle = document.getElementById("bf-sub")?.value.trim();
  const sort_order = parseInt(document.getElementById("bf-order")?.value) || 0;
  const icon = document.getElementById("bf-icon")?.value.trim();
  const is_active = document.getElementById("bf-active")?.checked ?? true;
  const color = document.getElementById("bf-color")?.value || "#1c1c1e";

  if (!title) {
    toast("Banner title is required");
    return;
  }

  let imageUrl = null;

  // Upload image if new file
  if (bannerImgFile) {
    try {
      const ext = bannerImgFile.name.split(".").pop();
      const path = `banner_${Date.now()}.${ext}`;
      const { data, error } = await storage.from("banners").upload(path, bannerImgFile);
      if (!error && data) {
        const { data: urlData } = storage.from("banners").getPublicUrl(data.path);
        imageUrl = urlData.publicUrl;
      }
    } catch (e) {
      console.warn("Banner image upload error:", e);
    }
  } else {
    // Keep existing image
    const prev = document.getElementById("bf-img-prev");
    if (prev && prev.src && prev.style.display !== "none") {
      imageUrl = prev.src;
    }
  }

  const bannerData = {
    title,
    subtitle,
    sort_order,
    icon: icon || null,
    is_active,
    color,
    image_url: imageUrl,
  };

  try {
    if (id) {
      const { error } = await db.from("banners").update(bannerData).eq("id", id);
      if (error) throw error;
      toast("Banner updated");
    } else {
      const { error } = await db.from("banners").insert(bannerData);
      if (error) throw error;
      toast("Banner added");
    }
    closeModal("banner-form-modal");
    await fetchBanners();
    renderAdminBanners();
  } catch (e) {
    console.error("Save banner error:", e);
    toast("Failed to save banner");
  }
}

async function deleteBanner(id) {
  if (!confirm("Delete this banner?")) return;
  try {
    const { error } = await db.from("banners").delete().eq("id", id);
    if (error) throw error;
    toast("Banner deleted");
    await fetchBanners();
    renderAdminBanners();
  } catch (e) {
    console.error("Delete banner error:", e);
    toast("Failed to delete banner");
  }
}

// ── Admin Users ──────────────────────────────────────────────
async function renderAdminUsers() {
  const list = document.getElementById("a-users-list");
  if (!list) return;

  try {
    const { data, error } = await db.from("users").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    const users = data || [];
    list.innerHTML = users
      .map(
        (u) => `
      <div class="admin-list-item">
        <span class="ali-name">${u.first_name || ""} ${u.last_name || ""}</span>
        <span class="ali-uname">${u.username ? "@" + u.username : ""}</span>
        <span class="ali-id">ID: ${u.telegram_id}</span>
        <span class="ali-date">${fmtDate(u.last_seen || u.created_at)}</span>
      </div>`
      )
      .join("");
    if (!users.length) list.innerHTML = '<div class="empty-hint">No users yet</div>';
  } catch (e) {
    console.warn("Admin users error:", e);
    list.innerHTML = '<div class="empty-hint">Could not load users</div>';
  }
}

// ── Admin Broadcast ──────────────────────────────────────────
async function doBroadcast() {
  const text = document.getElementById("bc-text")?.value.trim();
  const withBtn = document.getElementById("bc-with-btn")?.checked;
  const silent = document.getElementById("bc-silent")?.checked;

  if (!text) {
    toast("Broadcast message is required");
    return;
  }

  try {
    const { data: users } = await db.from("users").select("telegram_id");
    const sentCount = users ? users.length : 0;

    const { error } = await db.from("broadcasts").insert({
      text,
      created_by: user.id,
      sent_count: sentCount,
    });
    if (error) throw error;

    toast(`Broadcast sent to ${sentCount} users`);
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");

    // Clear form
    if (document.getElementById("bc-text")) document.getElementById("bc-text").value = "";
    const info = document.getElementById("bc-info");
    if (info) info.textContent = `Last broadcast sent to ${sentCount} users`;

    loadBroadcastHistory();
  } catch (e) {
    console.error("Broadcast error:", e);
    toast("Failed to send broadcast");
  }
}

async function loadBroadcastHistory() {
  const list = document.getElementById("a-broadcast-history");
  if (!list) return;

  try {
    const { data, error } = await db.from("broadcasts").select("*").order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    const broadcasts = data || [];
    list.innerHTML = broadcasts
      .map(
        (b) => `
      <div class="admin-list-item">
        <span class="ali-desc">${(b.text || "").substring(0, 80)}${(b.text || "").length > 80 ? "..." : ""}</span>
        <span class="ali-count">Sent: ${b.sent_count || 0}</span>
        <span class="ali-date">${fmtDate(b.created_at)}</span>
      </div>`
      )
      .join("");
    if (!broadcasts.length) list.innerHTML = '<div class="empty-hint">No broadcasts yet</div>';
  } catch (e) {
    console.warn("Broadcast history error:", e);
    list.innerHTML = '<div class="empty-hint">Could not load history</div>';
  }
}

// ── Share App ────────────────────────────────────────────────
function shareApp() {
  if (tg && tg.openTelegramLink) {
    tg.openTelegramLink("https://t.me/share/url?url=https://t.me/AksessBot/app&text=Check out AKSESS - Premium Phone Accessories! 📱✨");
  } else {
    // Fallback
    try {
      navigator.share({
        title: "AKSESS",
        text: "Check out AKSESS - Premium Phone Accessories!",
        url: "https://t.me/AksessBot/app",
      });
    } catch {
      toast("Sharing not supported");
    }
  }
}

// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════

function toast(msg) {
  const container = document.getElementById("toasts");
  if (!container) return;
  const t = document.createElement("div");
  t.className = "toast-item";
  t.textContent = msg;
  container.appendChild(t);
  // Trigger animation
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

function fmtPrice(num) {
  if (num == null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
}

function fmtShort(num) {
  if (num == null) return "0";
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function fmtDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status) {
  const map = {
    pending: "⏳ Pending",
    confirmed: "✅ Confirmed",
    processing: "🔄 Processing",
    shipped: "📦 Shipped",
    delivered: "✅ Delivered",
    cancelled: "❌ Cancelled",
    in_progress: "🔄 In Progress",
    completed: "✅ Completed",
    rejected: "❌ Rejected",
  };
  const cls = {
    pending: "status-pending",
    confirmed: "status-confirmed",
    processing: "status-processing",
    shipped: "status-shipped",
    delivered: "status-delivered",
    cancelled: "status-cancelled",
    in_progress: "status-processing",
    completed: "status-delivered",
    rejected: "status-cancelled",
  };
  return `<span class="status-badge ${cls[status] || "status-pending"}">${map[status] || status}</span>`;
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("active");
  document.body.style.overflow = "";
}

function onOverlayClick(e, modalId) {
  if (e.target === e.currentTarget) closeModal(modalId);
}

function stopProp(e) {
  e.stopPropagation();
}

// ══════════════════════════════════════════════════════════════
// DEMO DATA
// ══════════════════════════════════════════════════════════════

function demoCategories() {
  return [
    { id: 1, name: "Cases", icon: "🛡️", color: "#FF6B6B", created_at: new Date().toISOString() },
    { id: 2, name: "Screen Protectors", icon: "📱", color: "#4ECDC4", created_at: new Date().toISOString() },
    { id: 3, name: "Chargers", icon: "⚡", color: "#FFE66D", created_at: new Date().toISOString() },
    { id: 4, name: "Cables", icon: "🔌", color: "#A8E6CF", created_at: new Date().toISOString() },
    { id: 5, name: "Power Banks", icon: "🔋", color: "#FF8B94", created_at: new Date().toISOString() },
    { id: 6, name: "Earphones", icon: "🎧", color: "#B5EAD7", created_at: new Date().toISOString() },
    { id: 7, name: "Holders", icon: "🏗️", color: "#C7CEEA", created_at: new Date().toISOString() },
    { id: 8, name: "Accessories", icon: "✨", color: "#E2F0CB", created_at: new Date().toISOString() },
  ];
}

function demoBanners() {
  return [
    {
      id: 1,
      title: "New Arrivals",
      subtitle: "Premium cases for iPhone 16",
      image_url: "",
      color: "#1c1c1e",
      icon: "✨",
      sort_order: 1,
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      title: "30% OFF",
      subtitle: "Screen protectors this week",
      image_url: "",
      color: "#FF6B6B",
      icon: "🔥",
      sort_order: 2,
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: 3,
      title: "Free Shipping",
      subtitle: "Orders over $50",
      image_url: "",
      color: "#4ECDC4",
      icon: "🚀",
      sort_order: 3,
      is_active: true,
      created_at: new Date().toISOString(),
    },
  ];
}

function demoProducts() {
  return [
    {
      id: 1, name: "MagSafe Clear Case", description: "Ultra-thin clear case with MagSafe compatibility. Premium polycarbonate back with soft TPU edges.", price: 29.99, old_price: 39.99, stock: 150, category_id: 1, phone_models: "iPhone 16, iPhone 16 Pro", images: [], image_url: "", is_featured: true, is_new: true, is_bestseller: false, is_premium: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 2, name: "Tempered Glass 9H", description: "9H hardness tempered glass screen protector with oleophobic coating. Easy install kit included.", price: 12.99, old_price: null, stock: 300, category_id: 2, phone_models: "iPhone 16 Pro Max, Samsung S24", images: [], image_url: "", is_featured: true, is_new: false, is_bestseller: true, is_premium: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 3, name: "20W GaN Charger", description: "Compact 20W GaN fast charger with USB-C port. Universal compatibility.", price: 24.99, old_price: 34.99, stock: 80, category_id: 3, phone_models: "Universal", images: [], image_url: "", is_featured: true, is_new: true, is_bestseller: true, is_premium: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 4, name: "Braided USB-C Cable 1.5m", description: "Premium nylon braided USB-C to USB-C cable. 100W charging support.", price: 15.99, old_price: null, stock: 200, category_id: 4, phone_models: "Universal", images: [], image_url: "", is_featured: false, is_new: false, is_bestseller: true, is_premium: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 5, name: "10000mAh Slim Power Bank", description: "Ultra-slim portable charger with dual USB-C ports. LED indicator.", price: 39.99, old_price: 49.99, stock: 60, category_id: 5, phone_models: "Universal", images: [], image_url: "", is_featured: true, is_new: true, is_bestseller: false, is_premium: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 6, name: "ANC Earbuds Pro", description: "Active noise cancelling wireless earbuds with 30hr battery. Premium sound quality.", price: 79.99, old_price: 99.99, stock: 40, category_id: 6, phone_models: "Universal", images: [], image_url: "", is_featured: true, is_new: true, is_bestseller: false, is_premium: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 7, name: "Magnetic Car Mount", description: "Strong magnetic car phone holder with 360° rotation. Dashboard and vent mount.", price: 19.99, old_price: null, stock: 120, category_id: 7, phone_models: "Universal", images: [], image_url: "", is_featured: false, is_new: false, is_bestseller: true, is_premium: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 8, name: "Leather Card Wallet", description: "Genuine leather card wallet with MagSafe attachment. Holds 3 cards.", price: 34.99, old_price: 44.99, stock: 50, category_id: 8, phone_models: "iPhone 16 series", images: [], image_url: "", is_featured: true, is_new: true, is_bestseller: false, is_premium: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 9, name: "Silicone Case - Midnight", description: "Soft-touch silicone case with microfiber lining. Premium feel.", price: 19.99, old_price: null, stock: 200, category_id: 1, phone_models: "iPhone 16, iPhone 16 Plus", images: [], image_url: "", is_featured: false, is_new: false, is_bestseller: true, is_premium: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 10, name: "Privacy Screen Protector", description: "Anti-spy privacy glass. Side viewing angle blocked.", price: 18.99, old_price: 24.99, stock: 100, category_id: 2, phone_models: "iPhone 16 Pro", images: [], image_url: "", is_featured: false, is_new: true, is_bestseller: false, is_premium: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 11, name: "65W GaN Charger 3-Port", description: "65W GaN charger with 2 USB-C + 1 USB-A. Charge 3 devices.", price: 44.99, old_price: 59.99, stock: 30, category_id: 3, phone_models: "Universal", images: [], image_url: "", is_featured: true, is_new: true, is_bestseller: false, is_premium: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 12, name: "20000mAh Power Bank", description: "High-capacity power bank with 65W PD fast charging. LED display.", price: 59.99, old_price: null, stock: 25, category_id: 5, phone_models: "Universal", images: [], image_url: "", is_featured: false, is_new: false, is_bestseller: false, is_premium: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
  ];
}

// ══════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════

async function init() {
  // Init Supabase
  initSupabase();

  // Init Telegram WebApp
  initTelegram();

  // Load persistent data
  loadCart();
  try {
    favs = JSON.parse(localStorage.getItem(FAVS_KEY)) || [];
  } catch {
    favs = [];
  }
  updateCartBadge();

  // Fetch data from Supabase
  await Promise.all([fetchCategories(), fetchBanners(), fetchProducts()]);

  // Setup realtime subscriptions
  setupRealtime();

  // Render home page
  setupHero();
  renderHomeSections();

  // Setup bottom nav
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      const page = item.dataset.page;
      if (page) openPage(page);
    });
  });

  // Setup back button
  if (tg && tg.BackButton) {
    tg.BackButton.onClick(() => goBack());
  }

  // Setup search
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", onSearchInput);
  }
  const searchClear = document.getElementById("search-clear");
  if (searchClear) {
    searchClear.addEventListener("click", clearSearch);
  }

  // Setup admin tabs
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.dataset.tab;
      if (tabName) switchTab(tabName);
    });
  });

  // Setup product image input
  const pfImgs = document.getElementById("pf-imgs");
  if (pfImgs) {
    pfImgs.addEventListener("change", addProductImgs);
  }

  // Setup request image input
  const reqImgInp = document.getElementById("req-img-inp");
  if (reqImgInp) {
    reqImgInp.addEventListener("change", () => previewReqImg("req-img-inp"));
  }

  // Setup banner image input
  const bfImg = document.getElementById("bf-img");
  if (bfImg) {
    bfImg.addEventListener("change", previewBannerImg);
  }

  // Navigate to home
  navigateTo("page-home");
}

// Start the app
document.addEventListener("DOMContentLoaded", init);
