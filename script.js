/* ═══════════════════════════════════════════════════════
   AKSESS — Premium Aksessuarlar · script.js
   Supabase + Telegram WebApp + Full App Logic
═══════════════════════════════════════════════════════ */

// ── Config ──────────────────────────────────────────────
const SUPABASE_URL = "https://dzzgqhlyptppyulkyquj.supabase.co";
const SUPABASE_KEY = "sb_publishable_y7BTNA-BHKHEQ_QOEdnBfg_bPoEZ6Ry";
const ADMIN_ID     = 8544023815;

// ── Globals ─────────────────────────────────────────────
let sb, tg, user = {}, cart = [], favorites = [], allProducts = [],
    allCategories = [], allBanners = [], heroInterval,
    currentPage = "home", adminOrderFilter = "all",
    productFormImgs = [], editingProductId = null,
    editingCategoryId = null, editingBannerId = null;

// ── Init ────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor("#060612");
    tg.setBackgroundColor("#060612");
  }

  sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  loadUserFromTelegram();
  loadCart();
  loadFavorites();

  // Check if admin launched via ?admin=1
  const params = new URLSearchParams(location.search);
  if (params.get("admin") === "1" && isAdmin()) {
    document.getElementById("admin-menu-row").style.display = "flex";
  }

  await Promise.all([fetchCategories(), fetchBanners(), fetchProducts()]);

  hideLoader();
  setupRealtime();
  setupHero();
  renderHomeSections();
  renderProfile();
});

// ── Supabase SQL helper ─────────────────────────────────
const query = async (table, opts = {}) => {
  let q = sb.from(table).select(opts.select || "*");
  if (opts.eq)    Object.entries(opts.eq).forEach(([k,v]) => q = q.eq(k,v));
  if (opts.ilike) q = q.ilike(opts.ilike[0], `%${opts.ilike[1]}%`);
  if (opts.in)    q = q.in(opts.in[0], opts.in[1]);
  if (opts.order) q = q.order(opts.order, { ascending: opts.asc ?? false });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

// ── User / Auth ─────────────────────────────────────────
function loadUserFromTelegram() {
  const u = tg?.initDataUnsafe?.user;
  if (u) {
    user = { id: u.id, name: u.first_name + (u.last_name ? " " + u.last_name : ""),
             username: u.username || "", photo: u.photo_url || "" };
  } else {
    // Dev fallback
    user = { id: 0, name: "Demo Foydalanuvchi", username: "demo", photo: "" };
  }

  // Register / upsert user in Supabase
  sb.from("users").upsert({
    telegram_id: user.id, first_name: user.name.split(" ")[0],
    last_name: user.name.split(" ").slice(1).join(" "),
    username: user.username, last_seen: new Date().toISOString()
  }, { onConflict: "telegram_id" }).then();

  if (isAdmin()) {
    document.getElementById("admin-menu-row").style.display = "flex";
  }
}

function isAdmin() { return user.id === ADMIN_ID || user.id === 0; } // 0=dev

// ── Loader ──────────────────────────────────────────────
function hideLoader() {
  setTimeout(() => {
    document.getElementById("loader").classList.add("hidden");
  }, 600);
}

// ── Fetch Data ──────────────────────────────────────────
async function fetchCategories() {
  try {
    allCategories = await query("categories", { order: "created_at", asc: true });
    if (!allCategories.length) allCategories = demoCategories();
  } catch { allCategories = demoCategories(); }
}

async function fetchBanners() {
  try {
    allBanners = await query("banners", { eq: { is_active: true }, order: "sort_order", asc: true });
    if (!allBanners.length) allBanners = demoBanners();
  } catch { allBanners = demoBanners(); }
}

async function fetchProducts() {
  try {
    allProducts = await query("products", { order: "created_at" });
    if (!allProducts.length) allProducts = demoProducts();
  } catch { allProducts = demoProducts(); }
}

// ── Realtime ────────────────────────────────────────────
function setupRealtime() {
  sb.channel("public:products")
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, payload => {
      if (payload.eventType === "INSERT") allProducts.unshift(payload.new);
      else if (payload.eventType === "UPDATE") {
        const i = allProducts.findIndex(p => p.id === payload.new.id);
        if (i > -1) allProducts[i] = payload.new;
      } else if (payload.eventType === "DELETE") {
        allProducts = allProducts.filter(p => p.id !== payload.old.id);
      }
      renderHomeSections();
    }).subscribe();
}

// ── Hero Slider ─────────────────────────────────────────
function setupHero() {
  const track = document.getElementById("hero-track");
  const dots  = document.getElementById("hero-dots");
  if (!track) return;
  track.innerHTML = ""; dots.innerHTML = "";

  allBanners.forEach((b, i) => {
    const slide = document.createElement("div");
    slide.className = "hero-slide";
    slide.innerHTML = b.image_url
      ? `<img src="${b.image_url}" alt="${b.title||''}" loading="lazy">
         <div class="hero-slide-grad"></div>
         <div class="hero-slide-content">
           <div class="hero-slide-title">${b.title||""}</div>
           <div class="hero-slide-sub">${b.subtitle||""}</div>
         </div>`
      : `<div class="hero-slide-fallback" style="background:${b.color||"linear-gradient(135deg,#00c6ff22,#7c3aed22)"}">
           <div style="text-align:center;padding:24px">
             <div style="font-size:48px;margin-bottom:12px">${b.icon||"📱"}</div>
             <div class="hero-slide-title">${b.title||""}</div>
             <div class="hero-slide-sub" style="margin-top:6px">${b.subtitle||""}</div>
           </div>
         </div>`;
    track.appendChild(slide);

    const dot = document.createElement("div");
    dot.className = "hero-dot" + (i === 0 ? " active" : "");
    dots.appendChild(dot);
  });

  let idx = 0;
  clearInterval(heroInterval);
  heroInterval = setInterval(() => {
    idx = (idx + 1) % allBanners.length;
    setHeroSlide(idx);
  }, 3800);

  // Swipe on hero
  let startX = 0;
  track.addEventListener("touchstart", e => startX = e.touches[0].clientX, { passive: true });
  track.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) {
      if (dx < 0) idx = (idx + 1) % allBanners.length;
      else idx = (idx - 1 + allBanners.length) % allBanners.length;
      setHeroSlide(idx);
      clearInterval(heroInterval);
    }
  });
}

function setHeroSlide(idx) {
  document.getElementById("hero-track").style.transform = `translateX(-${idx * 100}%)`;
  document.querySelectorAll(".hero-dot").forEach((d, i) => d.classList.toggle("active", i === idx));
}

// ── Home Sections ───────────────────────────────────────
function renderHomeSections() {
  renderCatPills("home-cats", allCategories);
  renderProductList("trending-list",   allProducts.filter(p => p.is_featured),   true);
  renderProductList("new-list",        allProducts.filter(p => p.is_new),         true);
  renderProductList("bestseller-list", allProducts.filter(p => p.is_bestseller),  true);
  renderProductGrid("premium-list",    allProducts.filter(p => p.is_premium));
}

function renderCatPills(containerId, cats) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = cats.map(c =>
    `<div class="cat-pill" onclick="filterByCategory('${c.id}','${c.name}')">
       <span class="cat-pill-icon">${c.icon||"📦"}</span>
       <span>${c.name}</span>
     </div>`
  ).join("") || `<div style="color:var(--text2);font-size:13px;padding:8px">Kategoriya yo'q</div>`;
}

function renderProductList(containerId, prods, horizontal = false) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!prods.length) { el.innerHTML = ""; return; }
  el.innerHTML = prods.slice(0, 12).map(p => productCardHTML(p, horizontal)).join("");
}

function renderProductGrid(containerId, prods) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = prods.slice(0, 6).map(p => productCardHTML(p, false)).join("");
}

function productCardHTML(p, horizontal = false) {
  const inFav = favorites.includes(p.id);
  const inCart = cart.some(c => c.id === p.id);
  const imgs   = p.images || (p.image_url ? [p.image_url] : []);
  const img    = imgs[0] || "";
  const hasDiscount = p.old_price && p.old_price > p.price;
  const discPct = hasDiscount ? Math.round((1 - p.price / p.old_price) * 100) : 0;

  return `<div class="pcard${horizontal ? "" : ""}" onclick="openProduct('${p.id}')">
    <div class="pcard-img">
      ${img ? `<img src="${img}" alt="${p.name}" loading="lazy">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:40px">📱</div>`}
      <div class="pcard-badges">
        ${hasDiscount ? `<span class="badge badge-discount">-${discPct}%</span>` : ""}
        ${p.is_new ? `<span class="badge badge-new">Yangi</span>` : ""}
        ${p.stock === 0 ? `<span class="badge badge-out">Tugadi</span>` : ""}
      </div>
      <button class="fav-btn ${inFav ? "active" : ""}" onclick="toggleFav(event,'${p.id}')">
        <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>
    </div>
    <div class="pcard-info">
      <div class="pcard-name">${p.name}</div>
      <div class="pcard-prices">
        <span class="pcard-price">${fmtPrice(p.price)}</span>
        ${hasDiscount ? `<span class="pcard-old">${fmtPrice(p.old_price)}</span>` : ""}
      </div>
      <div class="pcard-footer">
        <span class="stock-dot ${p.stock === 0 ? "out" : ""}">${p.stock === 0 ? "Tugadi" : "Bor"}</span>
        <button class="add-cart-btn" ${p.stock === 0 ? "disabled" : ""} onclick="addToCart(event,'${p.id}')">
          <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
    </div>
  </div>`;
}

// ── Navigation ──────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => {
    n.classList.toggle("active", n.dataset.page === page);
  });

  const pg = document.getElementById("page-" + page);
  if (!pg) return;
  pg.classList.add("active");
  currentPage = page;
  pg.scrollTop = 0;

  const back = document.getElementById("btn-back");
  const topCenter = document.getElementById("topbar-center");
  const noNav = ["product","admin"];
  back.style.opacity = noNav.includes(page) ? "1" : "0";
  back.style.pointerEvents = noNav.includes(page) ? "auto" : "none";

  // Page titles
  const titles = { home:"", categories:"Kategoriyalar", search:"Qidiruv",
                   orders:"Buyurtmalarim", profile:"Profil", admin:"Admin Panel" };
  topCenter.innerHTML = page === "home"
    ? `<span class="brand">AKSESS</span>`
    : `<span style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px">${titles[page]||""}</span>`;

  if (page === "categories") renderCategoriesPage();
  if (page === "orders")     renderOrdersPage();
  if (page === "profile")    renderProfile();
  if (page === "admin" && isAdmin()) loadAdminData();
}

function goBack() {
  navigateTo(currentPage === "product" ? (history.state?.from || "home") : "home");
}

// ── Categories Page ─────────────────────────────────────
function renderCategoriesPage() {
  const grid = document.getElementById("cats-grid");
  const sec  = document.getElementById("cat-products-section");
  sec.style.display = "none";
  grid.style.display = "grid";

  grid.innerHTML = allCategories.map(c => {
    const cnt = allProducts.filter(p => p.category_id === c.id).length;
    return `<div class="cat-card" onclick="showCategoryProducts('${c.id}','${c.name}')">
      <div class="cat-card-icon">${c.icon||"📦"}</div>
      <div class="cat-card-name">${c.name}</div>
      <div class="cat-card-count">${cnt} mahsulot</div>
    </div>`;
  }).join("") || `<div style="grid-column:1/-1;text-align:center;color:var(--text2);padding:40px">
    Kategoriya yo'q
  </div>`;
}

function showCategoryProducts(catId, catName) {
  const prods = allProducts.filter(p => p.category_id == catId);
  document.getElementById("cats-grid").style.display = "none";
  const sec = document.getElementById("cat-products-section");
  sec.style.display = "block";
  document.getElementById("cat-products-title").textContent = catName;
  const grid = document.getElementById("cat-products");
  grid.innerHTML = prods.length
    ? prods.map(p => productCardHTML(p, false)).join("")
    : `<div class="empty-state inline" style="grid-column:1/-1"><div class="es-icon">📦</div><p>Mahsulot yo'q</p></div>`;
}

function clearCategoryFilter() { renderCategoriesPage(); }

function filterByCategory(catId, catName) {
  navigateTo("categories");
  setTimeout(() => showCategoryProducts(catId, catName), 50);
}

function showAllFiltered(type) {
  navigateTo("search");
  setTimeout(() => {
    let prods;
    if (type === "trending")   prods = allProducts.filter(p => p.is_featured);
    else if (type === "new")   prods = allProducts.filter(p => p.is_new);
    else                       prods = allProducts.filter(p => p.is_bestseller);
    document.getElementById("search-initial").style.display = "none";
    document.getElementById("search-results").style.display = "block";
    document.getElementById("search-count").textContent = `${prods.length} ta mahsulot`;
    document.getElementById("search-grid").innerHTML = prods.map(p => productCardHTML(p,false)).join("");
  }, 50);
}

// ── Search ──────────────────────────────────────────────
let searchDebounce;
function onSearchInput(val) {
  const clear = document.getElementById("search-clear");
  clear.style.display = val ? "block" : "none";
  clearTimeout(searchDebounce);
  if (!val.trim()) {
    document.getElementById("search-initial").style.display = "block";
    document.getElementById("search-results").style.display = "none";
    document.getElementById("search-empty").style.display = "none";
    return;
  }
  searchDebounce = setTimeout(() => doSearch(val), 250);
}

function doSearch(q) {
  const v = q.toLowerCase();
  const res = allProducts.filter(p =>
    p.name?.toLowerCase().includes(v) ||
    p.description?.toLowerCase().includes(v) ||
    p.phone_models?.toLowerCase().includes(v)
  );
  document.getElementById("search-initial").style.display = "none";
  document.getElementById("search-empty").style.display = res.length ? "none" : "flex";
  document.getElementById("search-results").style.display = res.length ? "block" : "none";
  document.getElementById("search-count").textContent = `${res.length} ta natija`;
  document.getElementById("search-grid").innerHTML = res.map(p => productCardHTML(p,false)).join("");
}

function clearSearch() {
  document.getElementById("search-input").value = "";
  onSearchInput("");
}

function setSearch(text) {
  const inp = document.getElementById("search-input");
  inp.value = text;
  inp.dispatchEvent(new Event("input"));
}

// ── Product Detail ──────────────────────────────────────
function openProduct(id) {
  const p = allProducts.find(x => x.id == id);
  if (!p) return;
  history.pushState({ from: currentPage }, "", "");
  navigateTo("product");

  const imgs = p.images || (p.image_url ? [p.image_url] : []);
  const inFav = favorites.includes(p.id);
  const models = (p.phone_models || "").split(",").filter(Boolean);
  const related = allProducts.filter(x => x.category_id === p.category_id && x.id !== p.id).slice(0,6);

  document.getElementById("product-detail-wrap").innerHTML = `
    <!-- Gallery -->
    <div class="pd-gallery" onclick="openGallery(${id})">
      <div class="pd-gallery-track" id="pd-gallery-track">
        ${imgs.length
          ? imgs.map(img => `<div class="pd-gallery-slide"><img src="${img}" alt="${p.name}" loading="lazy"></div>`).join("")
          : `<div class="pd-gallery-slide" style="display:flex;align-items:center;justify-content:center;background:var(--glass);min-width:100%;height:300px;font-size:72px">📱</div>`}
      </div>
      <div class="pd-gallery-dots">
        ${imgs.map((_,i) => `<div class="hero-dot ${i===0?"active":""}"></div>`).join("")}
      </div>
    </div>

    <div class="pd-body">
      <div class="pd-top">
        <h1 class="pd-name">${p.name}</h1>
      </div>
      <div class="pd-price-block">
        <div class="pd-price">${fmtPrice(p.price)}</div>
        ${p.old_price ? `<div class="pd-old-price">${fmtPrice(p.old_price)}</div>` : ""}
      </div>

      ${p.description ? `
        <div class="pd-section-title">Tavsif</div>
        <p class="pd-desc" style="margin-bottom:16px">${p.description}</p>` : ""}

      ${models.length ? `
        <div class="pd-section-title">Mos telefon modellari</div>
        <div class="pd-models-wrap" style="margin-bottom:16px">
          ${models.map(m => `<span class="pd-model-tag">${m.trim()}</span>`).join("")}
        </div>` : ""}

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span class="stock-dot ${p.stock === 0 ? "out" : ""}" style="font-size:13px">
          ${p.stock === 0 ? "Mavjud emas" : `${p.stock} dona mavjud`}
        </span>
      </div>

      <!-- Sticky actions -->
      <div class="pd-actions">
        <button class="pd-fav-btn ${inFav?"active":""}" id="pd-fav-btn" onclick="toggleFav(event,'${p.id}')">
          <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
        <button class="btn-primary" style="flex:1" ${p.stock===0?"disabled":""} onclick="addToCartAndNotify('${p.id}')">
          ${p.stock===0 ? "❌ Mavjud emas" : "🛒 Savatga qo'shish"}
        </button>
      </div>

      ${related.length ? `
        <div class="related-section">
          <h3>O'xshash mahsulotlar</h3>
          <div class="prods-scroll" style="margin:0 -16px;padding:0 16px 8px">
            ${related.map(rp => productCardHTML(rp, true)).join("")}
          </div>
        </div>` : ""}

      <div class="bottom-space"></div>
    </div>`;

  // Gallery swipe
  if (imgs.length > 1) {
    let gIdx = 0, startX2 = 0;
    const gt = document.getElementById("pd-gallery-track");
    gt.addEventListener("touchstart", e => startX2 = e.touches[0].clientX, { passive: true });
    gt.addEventListener("touchend", e => {
      const dx = e.changedTouches[0].clientX - startX2;
      if (Math.abs(dx) > 40) {
        if (dx < 0) gIdx = Math.min(gIdx + 1, imgs.length - 1);
        else gIdx = Math.max(gIdx - 1, 0);
        gt.style.transform = `translateX(-${gIdx * 100}%)`;
        document.querySelectorAll(".pd-gallery-dots .hero-dot").forEach((d,i) => d.classList.toggle("active",i===gIdx));
      }
    });
  }
}

// ── Gallery Modal ───────────────────────────────────────
function openGallery(productId) {
  const p = allProducts.find(x => x.id == productId);
  if (!p) return;
  const imgs = p.images || (p.image_url ? [p.image_url] : []);
  if (!imgs.length) return;

  const track = document.getElementById("gallery-track");
  const dots  = document.getElementById("gallery-dots");
  track.innerHTML = imgs.map(img => `<div class="gallery-slide"><img src="${img}" alt=""></div>`).join("");
  dots.innerHTML  = imgs.map((_,i) => `<div class="hero-dot ${i===0?"active":""}"></div>`).join("");

  openModal("modal-gallery");
}

// ── Cart ────────────────────────────────────────────────
function loadCart() {
  try { cart = JSON.parse(localStorage.getItem("aksess_cart") || "[]"); } catch { cart = []; }
  updateCartBadge();
}

function saveCart() {
  localStorage.setItem("aksess_cart", JSON.stringify(cart));
  updateCartBadge();
}

function updateCartBadge() {
  const total = cart.reduce((s, c) => s + c.qty, 0);
  const badge = document.getElementById("cart-badge");
  badge.textContent = total;
  badge.style.display = total > 0 ? "flex" : "none";
}

function addToCart(e, id) {
  e?.stopPropagation();
  const p = allProducts.find(x => x.id == id);
  if (!p) return;
  const ex = cart.find(c => c.id == id);
  if (ex) ex.qty = Math.min(ex.qty + 1, p.stock || 99);
  else cart.push({ id: p.id, name: p.name, price: p.price,
    image: (p.images||[])[0] || p.image_url || "", qty: 1 });
  saveCart();
  toast("✅ Savatga qo'shildi", "success");
  tg?.HapticFeedback?.impactOccurred("light");
}

function addToCartAndNotify(id) {
  addToCart(null, id);
}

function openCart() {
  renderCartModal();
  openModal("modal-cart");
}

function renderCartModal() {
  const list  = document.getElementById("cart-list");
  const foot  = document.getElementById("cart-footer");
  const empty = document.getElementById("cart-empty");

  if (!cart.length) {
    list.innerHTML = "";
    foot.style.display = "none";
    empty.style.display = "flex";
    return;
  }
  empty.style.display = "none";
  foot.style.display = "block";
  list.innerHTML = cart.map(item => `
    <div class="cart-item">
      ${item.image ? `<img class="cart-item-img" src="${item.image}" alt="">` : `<div class="cart-item-img" style="display:flex;align-items:center;justify-content:center;font-size:24px">📱</div>`}
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">${fmtPrice(item.price * item.qty)}</div>
        <div class="cart-qty-row">
          <button class="qty-btn" onclick="changeQty('${item.id}',-1)">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty('${item.id}',1)">+</button>
          <button class="cart-del" onclick="removeFromCart('${item.id}')">O'chirish</button>
        </div>
      </div>
    </div>`).join("");

  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  document.getElementById("cart-total").textContent = fmtPrice(total);
}

function changeQty(id, delta) {
  const item = cart.find(c => c.id == id);
  if (!item) return;
  item.qty = Math.max(1, item.qty + delta);
  saveCart();
  renderCartModal();
}

function removeFromCart(id) {
  cart = cart.filter(c => c.id != id);
  saveCart();
  renderCartModal();
}

// ── Order ───────────────────────────────────────────────
function openOrderModal() {
  closeModal("modal-cart");
  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  document.getElementById("o-total").textContent = fmtPrice(total);
  document.getElementById("o-summary").innerHTML = cart.map(c =>
    `<div class="order-summary-item"><span>${c.name} × ${c.qty}</span><span>${fmtPrice(c.price*c.qty)}</span></div>`
  ).join("");
  openModal("modal-order");
}

async function placeOrder() {
  const phone   = document.getElementById("o-phone").value.trim();
  const address = document.getElementById("o-address").value.trim();
  if (!phone || !address) { toast("📞 Telefon va manzilni kiriting", "error"); return; }

  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const orderData = {
    user_telegram_id: user.id,
    user_name: user.name,
    phone,
    address,
    note: document.getElementById("o-note").value.trim(),
    items: cart,
    total,
    status: "pending",
    created_at: new Date().toISOString()
  };

  try {
    const { data, error } = await sb.from("orders").insert(orderData).select().single();
    if (error) throw error;

    // Notify bot via WebApp
    if (tg?.sendData) {
      tg.sendData(JSON.stringify({ action: "new_order", ...data }));
    }

    cart = [];
    saveCart();
    closeModal("modal-order");
    toast("🎉 Buyurtma qabul qilindi!", "success");
    renderOrdersPage();
  } catch (e) {
    console.error(e);
    toast("❌ Xatolik yuz berdi", "error");
  }
}

// ── Orders Page ─────────────────────────────────────────
async function renderOrdersPage() {
  const list  = document.getElementById("orders-list");
  const empty = document.getElementById("orders-empty");
  list.innerHTML = "";

  try {
    const orders = await query("orders", {
      eq: { user_telegram_id: user.id },
      order: "created_at"
    });
    if (!orders.length) { empty.style.display = "flex"; return; }
    empty.style.display = "none";
    list.innerHTML = orders.map(o => {
      const items = Array.isArray(o.items) ? o.items : [];
      return `<div class="order-card">
        <div class="order-card-head">
          <span class="order-id">#${String(o.id).slice(0,8)}</span>
          <span class="order-status status-${o.status||"pending"}">${statusLabel(o.status)}</span>
        </div>
        <div class="order-items-preview">${items.slice(0,2).map(i=>i.name).join(", ")}${items.length>2?" ...":""}</div>
        <div class="order-card-foot">
          <span class="order-total">${fmtPrice(o.total)}</span>
          <span class="order-date">${fmtDate(o.created_at)}</span>
        </div>
      </div>`;
    }).join("");
  } catch { empty.style.display = "flex"; }
}

// ── Profile ─────────────────────────────────────────────
async function renderProfile() {
  document.getElementById("profile-name").textContent = user.name || "—";
  document.getElementById("profile-uname").textContent = user.username ? "@" + user.username : "";

  const ava = document.getElementById("profile-ava");
  if (user.photo) ava.innerHTML = `<img src="${user.photo}" alt="">`;

  // Stats
  try {
    const orders = await query("orders", { eq: { user_telegram_id: user.id } });
    document.getElementById("st-orders").textContent = orders.length;
    const spent = orders.filter(o => o.status === "delivered").reduce((s,o) => s + o.total, 0);
    document.getElementById("st-spent").textContent = spent >= 1000000 ? (spent/1000000).toFixed(1)+"M" : fmtShort(spent);
  } catch {}

  renderFavorites();
}

function renderFavorites() {
  const favProds = allProducts.filter(p => favorites.includes(p.id));
  document.getElementById("st-favs").textContent = favProds.length;
  const grid = document.getElementById("favs-grid");
  grid.innerHTML = favProds.length
    ? favProds.map(p => productCardHTML(p, false)).join("")
    : `<div class="empty-state inline"><div class="es-icon" style="font-size:28px">💔</div><p style="font-size:13px">Sevimlilar yo'q</p></div>`;
}

// ── Favorites ───────────────────────────────────────────
function loadFavorites() {
  try { favorites = JSON.parse(localStorage.getItem("aksess_favs") || "[]"); } catch { favorites = []; }
}

function toggleFav(e, id) {
  e?.stopPropagation();
  const idx = favorites.indexOf(id);
  if (idx > -1) { favorites.splice(idx, 1); toast("💔 Sevimlilardan o'chirildi", "info"); }
  else { favorites.push(id); toast("❤️ Sevimlilarga qo'shildi", "success"); }
  localStorage.setItem("aksess_favs", JSON.stringify(favorites));
  tg?.HapticFeedback?.impactOccurred("light");

  // Update all fav buttons
  document.querySelectorAll(`.fav-btn`).forEach(btn => {
    if (btn.getAttribute("onclick")?.includes(`'${id}'`)) {
      btn.classList.toggle("active", favorites.includes(id));
    }
  });

  const pdFav = document.getElementById("pd-fav-btn");
  if (pdFav && pdFav.getAttribute("onclick")?.includes(`'${id}'`)) {
    pdFav.classList.toggle("active", favorites.includes(id));
  }
  renderFavorites();
}

// ── Custom Request ──────────────────────────────────────
let reqImgFile = null;
function previewReqImg(inp) {
  const f = inp.files[0];
  if (!f) return;
  reqImgFile = f;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById("req-img-ph").style.display = "none";
    const prev = document.getElementById("req-img-prev");
    prev.src = e.target.result;
    prev.style.display = "block";
  };
  reader.readAsDataURL(f);
}

async function submitRequest() {
  const desc    = document.getElementById("req-desc").value.trim();
  const model   = document.getElementById("req-model").value.trim();
  const contact = document.getElementById("req-contact").value.trim();
  if (!desc) { toast("📝 Tavsif kiriting", "error"); return; }

  let image_url = "";
  if (reqImgFile) {
    const { data, error } = await sb.storage.from("requests")
      .upload(`${Date.now()}_${reqImgFile.name}`, reqImgFile, { upsert: true });
    if (!error) {
      const { data: pd } = sb.storage.from("requests").getPublicUrl(data.path);
      image_url = pd.publicUrl;
    }
  }

  const reqData = {
    user_telegram_id: user.id,
    user_name: user.name,
    description: desc,
    phone_model: model,
    contact,
    image_url,
    status: "new",
    created_at: new Date().toISOString()
  };

  try {
    const { data, error } = await sb.from("custom_requests").insert(reqData).select().single();
    if (error) throw error;

    if (tg?.sendData) {
      tg.sendData(JSON.stringify({ action: "custom_request", ...data }));
    }

    closeModal("modal-request");
    toast("📨 So'rov yuborildi!", "success");
    reqImgFile = null;
    document.getElementById("req-img-prev").style.display = "none";
    document.getElementById("req-img-ph").style.display = "flex";
    document.getElementById("req-desc").value = "";
    document.getElementById("req-model").value = "";
    document.getElementById("req-contact").value = "";
  } catch (e) {
    console.error(e);
    toast("❌ Xatolik yuz berdi", "error");
  }
}

// ══════════════════════════════════════════════════════
// ADMIN PANEL
// ══════════════════════════════════════════════════════

function switchTab(btn, tab) {
  document.querySelectorAll(".atab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".atab-content").forEach(c => c.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("tab-" + tab).classList.add("active");
  if (tab === "products")   renderAdminProducts();
  if (tab === "categories") renderAdminCategories();
  if (tab === "orders")     renderAdminOrders();
  if (tab === "requests")   renderAdminRequests();
  if (tab === "banners")    renderAdminBanners();
}

async function loadAdminData() {
  await Promise.all([fetchProducts(), fetchCategories()]);
  renderAdminDashboard();
  renderAdminProducts();
}

// Dashboard
async function renderAdminDashboard() {
  try {
    const [products, orders, users, requests] = await Promise.all([
      query("products"),
      query("orders"),
      query("users"),
      query("custom_requests")
    ]);
    document.getElementById("as-products").textContent = products.length;
    document.getElementById("as-orders").textContent   = orders.length;
    document.getElementById("as-users").textContent    = users.length;
    const revenue = orders.filter(o => o.status === "delivered").reduce((s,o) => s + (o.total||0), 0);
    document.getElementById("as-revenue").textContent  = fmtShort(revenue) + " so'm";

    document.getElementById("a-recent-orders").innerHTML = orders.slice(0,3).map(o =>
      `<div class="admin-row">
        <div class="admin-row-head">
          <span class="admin-row-name">${o.user_name||"—"}</span>
          <span class="order-status status-${o.status||"pending"}">${statusLabel(o.status)}</span>
        </div>
        <div class="admin-row-sub">${fmtPrice(o.total)} · ${fmtDate(o.created_at)}</div>
      </div>`
    ).join("") || `<div style="color:var(--text2);font-size:13px">Hali buyurtma yo'q</div>`;

    document.getElementById("a-recent-requests").innerHTML = requests.slice(0,3).map(r =>
      `<div class="admin-row">
        <div class="admin-row-head">
          <span class="admin-row-name">${r.user_name||"—"}</span>
          <span class="badge badge-new" style="font-size:9px">${r.status||"new"}</span>
        </div>
        <div class="admin-row-sub">${r.description||""} · ${r.phone_model||""}</div>
        ${r.image_url ? `<img src="${r.image_url}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;margin-top:8px" loading="lazy">` : ""}
      </div>`
    ).join("") || `<div style="color:var(--text2);font-size:13px">Hali so'rov yo'q</div>`;
  } catch (e) { console.error(e); }
}

// ── Admin Products ──────────────────────────────────────
function renderAdminProducts() {
  const el = document.getElementById("a-products-list");
  if (!el) return;
  el.innerHTML = allProducts.length
    ? allProducts.map(p => {
        const img = (p.images||[])[0] || p.image_url || "";
        const tags = [p.is_featured?"🔥":"", p.is_new?"✨":"", p.is_bestseller?"⭐":"", p.is_premium?"💎":""].filter(Boolean).join(" ");
        return `<div class="admin-row">
          <div class="admin-row-head">
            ${img ? `<img class="admin-row-img" src="${img}" alt="" loading="lazy">` : ""}
            <div style="flex:1;min-width:0">
              <div class="admin-row-name">${p.name}</div>
              <div class="admin-row-sub">${fmtPrice(p.price)} · Soni: ${p.stock??0} ${tags}</div>
            </div>
          </div>
          <div class="admin-row-actions">
            <button class="btn-ghost" onclick="openProductForm('${p.id}')">✏️ Tahrirlash</button>
            <button class="btn-danger" onclick="deleteProduct('${p.id}')">🗑 O'chirish</button>
          </div>
        </div>`;
      }).join("")
    : `<div style="color:var(--text2);text-align:center;padding:24px">Mahsulot yo'q</div>`;
}

// Product form
function openProductForm(id = null) {
  editingProductId = id;
  document.getElementById("pf-title").textContent = id ? "Mahsulotni tahrirlash" : "Mahsulot qo'shish";
  document.getElementById("pf-thumbs").innerHTML = "";
  productFormImgs = [];

  if (id) {
    const p = allProducts.find(x => x.id == id);
    if (!p) return;
    document.getElementById("pf-id").value       = p.id;
    document.getElementById("pf-name").value     = p.name || "";
    document.getElementById("pf-desc").value     = p.description || "";
    document.getElementById("pf-price").value    = p.price || "";
    document.getElementById("pf-old-price").value= p.old_price || "";
    document.getElementById("pf-stock").value    = p.stock ?? 0;
    document.getElementById("pf-models").value   = p.phone_models || "";
    document.getElementById("pf-featured").checked  = !!p.is_featured;
    document.getElementById("pf-new").checked       = !!p.is_new;
    document.getElementById("pf-bestseller").checked= !!p.is_bestseller;
    document.getElementById("pf-premium").checked   = !!p.is_premium;

    // Category select
    populateCategorySelect("pf-category", p.category_id);

    // Show existing images as thumbnails
    const imgs = p.images || (p.image_url ? [p.image_url] : []);
    productFormImgs = imgs.map(url => ({ url, file: null }));
    renderProductImgThumbs();
  } else {
    clearProductForm();
    populateCategorySelect("pf-category", null);
  }

  openModal("modal-product-form");
}

function clearProductForm() {
  ["pf-id","pf-name","pf-desc","pf-price","pf-old-price","pf-stock","pf-models"].forEach(id => {
    document.getElementById(id).value = "";
  });
  ["pf-featured","pf-new","pf-bestseller","pf-premium"].forEach(id => {
    document.getElementById(id).checked = false;
  });
  productFormImgs = [];
  document.getElementById("pf-thumbs").innerHTML = "";
}

function populateCategorySelect(selectId, selected) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = `<option value="">Tanlang...</option>` +
    allCategories.map(c => `<option value="${c.id}" ${c.id == selected ? "selected" : ""}>${c.icon||"📦"} ${c.name}</option>`).join("");
}

function addProductImgs(inp) {
  const files = Array.from(inp.files);
  files.forEach(f => productFormImgs.push({ file: f, url: URL.createObjectURL(f) }));
  renderProductImgThumbs();
  inp.value = "";
}

function renderProductImgThumbs() {
  const wrap = document.getElementById("pf-thumbs");
  wrap.innerHTML = productFormImgs.map((img, i) => `
    <div class="img-thumb">
      <img src="${img.url}" alt="">
      <button class="img-thumb-del" onclick="removeProductImg(${i})">✕</button>
    </div>`).join("");
}

function removeProductImg(i) {
  productFormImgs.splice(i, 1);
  renderProductImgThumbs();
}

async function saveProduct() {
  const name  = document.getElementById("pf-name").value.trim();
  const price = parseFloat(document.getElementById("pf-price").value);
  if (!name || !price) { toast("Nomi va narxni kiriting", "error"); return; }

  // Show progress
  document.getElementById("pf-upload-progress").style.display = "block";

  // Upload new images
  const uploadedUrls = [];
  let uploaded = 0;
  for (const img of productFormImgs) {
    if (img.file) {
      const { data, error } = await sb.storage.from("products")
        .upload(`${Date.now()}_${img.file.name}`, img.file, { upsert: true });
      if (!error) {
        const { data: pd } = sb.storage.from("products").getPublicUrl(data.path);
        uploadedUrls.push(pd.publicUrl);
      }
    } else if (img.url) {
      uploadedUrls.push(img.url);
    }
    uploaded++;
    const pct = Math.round((uploaded / productFormImgs.length) * 100);
    document.getElementById("pf-progress-bar").style.width = pct + "%";
    document.getElementById("pf-progress-text").textContent = `Yuklanmoqda ${pct}%...`;
  }

  const payload = {
    name,
    description:  document.getElementById("pf-desc").value.trim(),
    price,
    old_price:    parseFloat(document.getElementById("pf-old-price").value) || null,
    stock:        parseInt(document.getElementById("pf-stock").value) || 0,
    category_id:  document.getElementById("pf-category").value || null,
    phone_models: document.getElementById("pf-models").value.trim(),
    is_featured:  document.getElementById("pf-featured").checked,
    is_new:       document.getElementById("pf-new").checked,
    is_bestseller:document.getElementById("pf-bestseller").checked,
    is_premium:   document.getElementById("pf-premium").checked,
    images:       uploadedUrls,
    image_url:    uploadedUrls[0] || null,
    updated_at:   new Date().toISOString()
  };

  try {
    if (editingProductId) {
      await sb.from("products").update(payload).eq("id", editingProductId);
    } else {
      payload.created_at = new Date().toISOString();
      await sb.from("products").insert(payload);
    }
    await fetchProducts();
    renderAdminProducts();
    renderHomeSections();
    closeModal("modal-product-form");
    toast("✅ Mahsulot saqlandi", "success");
  } catch (e) {
    toast("❌ " + e.message, "error");
  }
  document.getElementById("pf-upload-progress").style.display = "none";
}

async function deleteProduct(id) {
  if (!confirm("Mahsulotni o'chirishni tasdiqlaysizmi?")) return;
  try {
    await sb.from("products").delete().eq("id", id);
    allProducts = allProducts.filter(p => p.id != id);
    renderAdminProducts();
    renderHomeSections();
    toast("🗑 O'chirildi", "info");
  } catch (e) { toast("❌ " + e.message, "error"); }
}

// ── Admin Categories ────────────────────────────────────
function renderAdminCategories() {
  const el = document.getElementById("a-categories-list");
  if (!el) return;
  el.innerHTML = allCategories.map(c => `
    <div class="admin-row">
      <div class="admin-row-head">
        <span style="font-size:20px">${c.icon||"📦"}</span>
        <span class="admin-row-name">${c.name}</span>
        <span style="font-size:10px;padding:3px 8px;border-radius:99px;background:${c.color||"#00c6ff"}22;color:${c.color||"#00c6ff"};border:1px solid ${c.color||"#00c6ff"}44">${c.color||""}</span>
      </div>
      <div class="admin-row-actions">
        <button class="btn-ghost" onclick="openCategoryForm('${c.id}')">✏️</button>
        <button class="btn-danger" onclick="deleteCategory('${c.id}')">🗑</button>
      </div>
    </div>`).join("") || `<div style="color:var(--text2);text-align:center;padding:24px">Kategoriya yo'q</div>`;
}

function openCategoryForm(id = null) {
  editingCategoryId = id;
  if (id) {
    const c = allCategories.find(x => x.id == id);
    document.getElementById("cf-id").value    = c.id;
    document.getElementById("cf-name").value  = c.name || "";
    document.getElementById("cf-icon").value  = c.icon || "";
    document.getElementById("cf-color").value = c.color || "#00c6ff";
  } else {
    ["cf-id","cf-name","cf-icon"].forEach(x => document.getElementById(x).value = "");
    document.getElementById("cf-color").value = "#00c6ff";
  }
  openModal("modal-cat-form");
}

async function saveCategory() {
  const name = document.getElementById("cf-name").value.trim();
  if (!name) { toast("Kategoriya nomini kiriting", "error"); return; }
  const payload = {
    name,
    icon:  document.getElementById("cf-icon").value || "📦",
    color: document.getElementById("cf-color").value,
    updated_at: new Date().toISOString()
  };
  try {
    if (editingCategoryId) {
      await sb.from("categories").update(payload).eq("id", editingCategoryId);
    } else {
      payload.created_at = new Date().toISOString();
      await sb.from("categories").insert(payload);
    }
    await fetchCategories();
    renderAdminCategories();
    renderCatPills("home-cats", allCategories);
    closeModal("modal-cat-form");
    toast("✅ Kategoriya saqlandi", "success");
  } catch (e) { toast("❌ " + e.message, "error"); }
}

async function deleteCategory(id) {
  if (!confirm("Kategoriyani o'chirish?")) return;
  await sb.from("categories").delete().eq("id", id);
  await fetchCategories();
  renderAdminCategories();
  toast("🗑 O'chirildi", "info");
}

// ── Admin Orders ────────────────────────────────────────
async function renderAdminOrders() {
  const el = document.getElementById("a-orders-list");
  if (!el) return;
  try {
    let orders = await query("orders", { order: "created_at" });
    if (adminOrderFilter !== "all") orders = orders.filter(o => o.status === adminOrderFilter);
    el.innerHTML = orders.length
      ? orders.map(o => {
          const items = Array.isArray(o.items) ? o.items : [];
          return `<div class="admin-row">
            <div class="admin-row-head">
              <div style="flex:1">
                <div class="admin-row-name">${o.user_name||"—"} · ${o.phone||""}</div>
                <div class="admin-row-sub">${o.address||""}</div>
                <div class="admin-row-sub">${items.map(i=>i.name+"×"+i.qty).join(", ")}</div>
              </div>
              <span class="order-status status-${o.status||"pending"}">${statusLabel(o.status)}</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
              <strong class="order-total">${fmtPrice(o.total)}</strong>
              <select class="status-select" onchange="updateOrderStatus('${o.id}',this.value)">
                <option value="pending" ${o.status==="pending"?"selected":""}>Kutilmoqda</option>
                <option value="confirmed" ${o.status==="confirmed"?"selected":""}>Tasdiqlangan</option>
                <option value="shipped" ${o.status==="shipped"?"selected":""}>Yuborilgan</option>
                <option value="delivered" ${o.status==="delivered"?"selected":""}>Yetkazilgan</option>
                <option value="cancelled" ${o.status==="cancelled"?"selected":""}>Bekor qilindi</option>
              </select>
            </div>
          </div>`;
        }).join("")
      : `<div style="color:var(--text2);text-align:center;padding:24px">Buyurtma yo'q</div>`;
  } catch (e) { el.innerHTML = `<div style="color:var(--danger)">Xatolik: ${e.message}</div>`; }
}

async function updateOrderStatus(id, status) {
  await sb.from("orders").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  toast("✅ Status yangilandi", "success");
  renderAdminOrders();
}

function filterAdminOrders(btn, filter) {
  adminOrderFilter = filter;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderAdminOrders();
}

// ── Admin Requests ──────────────────────────────────────
async function renderAdminRequests() {
  const el = document.getElementById("a-requests-list");
  if (!el) return;
  try {
    const reqs = await query("custom_requests", { order: "created_at" });
    el.innerHTML = reqs.length
      ? reqs.map(r => `
          <div class="admin-row">
            <div class="admin-row-head">
              <div style="flex:1">
                <div class="admin-row-name">${r.user_name||"—"} · ${r.contact||""}</div>
                <div class="admin-row-sub">${r.phone_model||""}</div>
                <div class="admin-row-sub">${r.description||""}</div>
              </div>
              <span class="badge badge-new" style="font-size:9px">${r.status||"new"}</span>
            </div>
            ${r.image_url ? `<img src="${r.image_url}" style="width:80px;height:80px;object-fit:cover;border-radius:10px;margin-top:8px;border:1px solid var(--border)" loading="lazy">` : ""}
            <div class="admin-row-actions">
              <button class="btn-ghost" onclick="markRequestDone('${r.id}')">✅ Ko'rib chiqildi</button>
            </div>
          </div>`).join("")
      : `<div style="color:var(--text2);text-align:center;padding:24px">So'rov yo'q</div>`;
  } catch (e) { el.innerHTML = `<div style="color:var(--danger)">Xatolik: ${e.message}</div>`; }
}

async function markRequestDone(id) {
  await sb.from("custom_requests").update({ status: "done" }).eq("id", id);
  toast("✅ Ko'rib chiqildi deb belgilandi", "success");
  renderAdminRequests();
}

// ── Admin Banners ───────────────────────────────────────
function renderAdminBanners() {
  const el = document.getElementById("a-banners-list");
  if (!el) return;
  el.innerHTML = allBanners.length
    ? allBanners.map(b => `
        <div class="admin-row">
          ${b.image_url ? `<img src="${b.image_url}" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px" loading="lazy">` : ""}
          <div class="admin-row-head">
            <span class="admin-row-name">${b.title||"Sarlavsiz"}</span>
            <span style="font-size:11px;color:${b.is_active?"var(--success)":"var(--text3)"}">${b.is_active?"Aktiv":"Nofaol"}</span>
          </div>
          <div class="admin-row-actions">
            <button class="btn-ghost" onclick="openBannerForm('${b.id}')">✏️</button>
            <button class="btn-danger" onclick="deleteBanner('${b.id}')">🗑</button>
          </div>
        </div>`).join("")
    : `<div style="color:var(--text2);text-align:center;padding:24px">Banner yo'q</div>`;
}

let bannerImgFile = null;
function previewBannerImg(inp) {
  bannerImgFile = inp.files[0];
  if (!bannerImgFile) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById("bf-img-ph").style.display = "none";
    const prev = document.getElementById("bf-img-prev");
    prev.src = e.target.result;
    prev.style.display = "block";
  };
  reader.readAsDataURL(bannerImgFile);
}

function openBannerForm(id = null) {
  editingBannerId = id;
  bannerImgFile = null;
  document.getElementById("bf-img-prev").style.display = "none";
  document.getElementById("bf-img-ph").style.display = "flex";

  if (id) {
    const b = allBanners.find(x => x.id == id);
    document.getElementById("bf-id").value    = b.id;
    document.getElementById("bf-title").value = b.title || "";
    document.getElementById("bf-sub").value   = b.subtitle || "";
    document.getElementById("bf-order").value = b.sort_order || 0;
    document.getElementById("bf-active").checked = b.is_active !== false;
    if (b.image_url) {
      document.getElementById("bf-img-prev").src = b.image_url;
      document.getElementById("bf-img-prev").style.display = "block";
      document.getElementById("bf-img-ph").style.display = "none";
    }
  } else {
    ["bf-id","bf-title","bf-sub"].forEach(x => document.getElementById(x).value = "");
    document.getElementById("bf-order").value = 0;
    document.getElementById("bf-active").checked = true;
  }
  openModal("modal-banner-form");
}

async function saveBanner() {
  const title = document.getElementById("bf-title").value.trim();
  let image_url = editingBannerId ? (allBanners.find(b => b.id == editingBannerId)?.image_url || "") : "";

  if (bannerImgFile) {
    const { data, error } = await sb.storage.from("banners")
      .upload(`${Date.now()}_${bannerImgFile.name}`, bannerImgFile, { upsert: true });
    if (!error) {
      const { data: pd } = sb.storage.from("banners").getPublicUrl(data.path);
      image_url = pd.publicUrl;
    }
  }

  const payload = {
    title,
    subtitle:   document.getElementById("bf-sub").value.trim(),
    sort_order: parseInt(document.getElementById("bf-order").value) || 0,
    is_active:  document.getElementById("bf-active").checked,
    image_url
  };

  try {
    if (editingBannerId) {
      await sb.from("banners").update(payload).eq("id", editingBannerId);
    } else {
      await sb.from("banners").insert(payload);
    }
    await fetchBanners();
    renderAdminBanners();
    setupHero();
    closeModal("modal-banner-form");
    toast("✅ Banner saqlandi", "success");
  } catch (e) { toast("❌ " + e.message, "error"); }
}

async function deleteBanner(id) {
  await sb.from("banners").delete().eq("id", id);
  await fetchBanners();
  renderAdminBanners();
  setupHero();
  toast("🗑 O'chirildi", "info");
}

// ── Broadcast ───────────────────────────────────────────
async function doBroadcast() {
  const text = document.getElementById("bc-text").value.trim();
  if (!text) { toast("Xabar matni bo'sh", "error"); return; }
  // In a real setup, the bot handles broadcast. Here we just record it.
  try {
    await sb.from("broadcasts").insert({
      text, created_by: user.id, created_at: new Date().toISOString()
    });
    document.getElementById("bc-text").value = "";
    toast("📢 Xabar bot orqali yuboriladi", "success");
  } catch {
    toast("ℹ️ Bot serverdan xabar yuboriladi", "info");
  }
}

// ══════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════
function openModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.add("open"); document.body.style.overflow = "hidden"; }
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.remove("open"); document.body.style.overflow = ""; }
}

function onOverlayClick(e, id) {
  if (e.target.id === id) closeModal(id);
}

function stopProp(e) { e.stopPropagation(); }

// ══════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════
function toast(msg, type = "info") {
  const wrap = document.getElementById("toasts");
  const el   = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add("removing");
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

// ══════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════
function fmtPrice(n) {
  if (!n) return "0 so'm";
  return Number(n).toLocaleString("ru-RU") + " so'm";
}

function fmtShort(n) {
  if (n >= 1e9) return (n/1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n/1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n/1e3).toFixed(0) + "K";
  return String(n||0);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("uz-UZ", { day:"2-digit", month:"2-digit", year:"2-digit" });
}

function statusLabel(s) {
  const map = { pending:"Kutilmoqda", confirmed:"Tasdiqlangan",
                shipped:"Yuborilgan", delivered:"Yetkazilgan", cancelled:"Bekor qilindi" };
  return map[s] || s || "Noma'lum";
}

// ══════════════════════════════════════════════════════
// DEMO DATA (Supabase bo'sh bo'lsa ishlaydi)
// ══════════════════════════════════════════════════════
function demoCategories() {
  return [
    { id:"c1", name:"Chehlalar",    icon:"📱", color:"#00c6ff" },
    { id:"c2", name:"Zaryadlovchi", icon:"⚡", color:"#f59e0b" },
    { id:"c3", name:"Quloqchin",    icon:"🎧", color:"#7c3aed" },
    { id:"c4", name:"Kabel",        icon:"🔌", color:"#34d399" },
    { id:"c5", name:"Power Bank",   icon:"🔋", color:"#ef4444" },
    { id:"c6", name:"Aksessuar",    icon:"💎", color:"#ec4899" },
    { id:"c7", name:"Gaming",       icon:"🎮", color:"#8b5cf6" },
    { id:"c8", name:"Smart Watch",  icon:"⌚", color:"#06b6d4" },
  ];
}

function demoBanners() {
  return [
    { id:"b1", title:"iPhone 15 Pro chehlalari", subtitle:"Eng zo'r himoya • MagSafe qo'llab-quvvatlaydi",
      icon:"📱", color:"linear-gradient(135deg,rgba(0,198,255,.25),rgba(124,58,237,.25))", is_active:true },
    { id:"b2", title:"150W Ultra Fast Charging", subtitle:"5 daqiqada 50% quvvat to'ldiring",
      icon:"⚡", color:"linear-gradient(135deg,rgba(245,158,11,.2),rgba(239,68,68,.2))", is_active:true },
    { id:"b3", title:"Premium Audio • 40% Chegirma", subtitle:"Sony, JBL, Marshall quloqchinlar",
      icon:"🎧", color:"linear-gradient(135deg,rgba(124,58,237,.25),rgba(236,72,153,.2))", is_active:true },
  ];
}

function demoProducts() {
  return [
    {
      id:"p1", name:"iPhone 15 Pro MagSafe Silikon Chehla", price:89000, old_price:120000,
      description:"Apple MagSafe texnologiyasini qo'llab-quvvatlovchi premium silikon chehla. IP68 suv o'tkazmaslik. 6 ta rang varianti mavjud.",
      category_id:"c1", stock:45, phone_models:"iPhone 15 Pro, iPhone 15 Pro Max",
      is_featured:true, is_new:true, is_bestseller:false, is_premium:true,
      images:[], image_url:"",
    },
    {
      id:"p2", name:"Samsung S24 Ultra Shisha Himoya", price:45000, old_price:null,
      description:"9H qattiqlikdagi tempered glass. Ekranni to'liq himoya qiladi.",
      category_id:"c1", stock:120, phone_models:"Samsung S24 Ultra",
      is_featured:true, is_new:false, is_bestseller:true, is_premium:false,
      images:[], image_url:"",
    },
    {
      id:"p3", name:"150W GaN Zaryadlovchi 4-Port", price:185000, old_price:220000,
      description:"4 portli GaN texnologiyali ultra tez zaryadlovchi. USB-C × 2, USB-A × 2.",
      category_id:"c2", stock:28, phone_models:"",
      is_featured:true, is_new:true, is_bestseller:false, is_premium:true,
      images:[], image_url:"",
    },
    {
      id:"p4", name:"JBL Tune 770NC Quloqchin", price:890000, old_price:1200000,
      description:"Aktiv shovqin bekor qilish. 70 soat quvvat. Bluetooth 5.3.",
      category_id:"c3", stock:8, phone_models:"",
      is_featured:false, is_new:false, is_bestseller:true, is_premium:true,
      images:[], image_url:"",
    },
    {
      id:"p5", name:"20000 mAh Power Bank 65W", price:320000, old_price:380000,
      description:"USB-C 65W PD, 2× USB-A. Noutbuk ham zaryadlaydi.",
      category_id:"c5", stock:35, phone_models:"",
      is_featured:false, is_new:true, is_bestseller:false, is_premium:false,
      images:[], image_url:"",
    },
    {
      id:"p6", name:"Type-C to Lightning Kabel 2m", price:35000, old_price:null,
      description:"MFi sertifikatlangan. 240W quvvat uzatish. Kuchli o'rama.",
      category_id:"c4", stock:200, phone_models:"iPhone 14, iPhone 13, iPhone 12",
      is_featured:false, is_new:false, is_bestseller:true, is_premium:false,
      images:[], image_url:"",
    },
    {
      id:"p7", name:"Xiaomi 14 Karbon Chehla", price:95000, old_price:null,
      description:"Haqiqiy karbon tolali ultra ingichka chehla. Og'irligi atigi 18g.",
      category_id:"c1", stock:15, phone_models:"Xiaomi 14, Xiaomi 14 Pro",
      is_featured:false, is_new:true, is_bestseller:false, is_premium:true,
      images:[], image_url:"",
    },
    {
      id:"p8", name:"Apple Watch 9 Metall Qayish", price:145000, old_price:180000,
      description:"Zanglamaydigan po'lat. 38mm/42mm mos keladi. 5 ta rang.",
      category_id:"c8", stock:0, phone_models:"Apple Watch 9, Apple Watch Ultra 2",
      is_featured:false, is_new:false, is_bestseller:false, is_premium:true,
      images:[], image_url:"",
    },
  ];
}
