// Общий слой страниц: шапка, корзина в localStorage, экранирование, иконки, ссылки, появление блоков.
import { MOCK } from "./api.js?v=1";
import { formatPrice } from "./rules.js?v=2";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ESC[ch]);
}

// Картинки принимаем только со своего сайта. Путь без ведущего слэша,
// чтобы страницы открывались и с корня, и с GitHub Pages (/baza-cvetov-24/).
export function safeImg(url, fallback = "assets/photos/studio.jpg") {
  const s = String(url ?? "");
  const path = s.startsWith("/") ? s.slice(1) : s;
  const fb = fallback.startsWith("/") ? fallback.slice(1) : fallback;
  return /^(assets|uploads)\//.test(path) ? path : fb;
}

export function icon(name, cls = "") {
  return `<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="assets/icons/sprite.svg#i-${name}"></use></svg>`;
}

// На этапе 2 сервер отдаёт /shop, /catalog/<slug>, /product/<slug>; тогда PRETTY_URLS = true.
const PRETTY_URLS = false;

export const urls = {
  home: () => "index.html",
  shop(params = {}) {
    const q = new URLSearchParams(params).toString();
    return `${PRETTY_URLS ? "/shop" : "shop.html"}${q ? `?${q}` : ""}`;
  },
  category: (slug) => (PRETTY_URLS ? `/catalog/${encodeURIComponent(slug)}` : `catalog.html?slug=${encodeURIComponent(slug)}`),
  product: (slug) => (PRETTY_URLS ? `/product/${encodeURIComponent(slug)}` : `product.html?slug=${encodeURIComponent(slug)}`),
};

/* ---------- Карточка товара (главная, магазин, страница категории) ---------- */

export function priceHtml(p, qty = 1) {
  const count = Number.isInteger(qty) && qty > 0 ? Math.min(qty, 50) : 1;
  const prefix = p.price_prefix ? `${esc(p.price_prefix)} ` : "";
  const onSale = Boolean(p.discount_active && p.sale_price);
  const current = (onSale ? p.sale_price : p.price) * count;
  const note = count > 1 ? `<span class="price-qty">за ${count} шт.</span>` : "";
  if (onSale) {
    return `<span class="price price--sale">${prefix}${formatPrice(current)}</span> <s class="price-old"><span class="visually-hidden">Было </span>${formatPrice(p.price * count)}</s>${note}`;
  }
  return `<span class="price">${prefix}${formatPrice(current)}</span>${note}`;
}

export function productBadges(p) {
  const out = [];
  if (p.discount_active && p.discount_label) out.push(`<span class="badge badge--sale">${esc(p.discount_label)}</span>`);
  if (p.is_new) out.push('<span class="badge badge--new">Новинка</span>');
  if (p.showcase) out.push('<span class="badge badge--ready">Готов сейчас</span>');
  if (p.badge) out.push(`<span class="badge">${esc(p.badge)}</span>`);
  return out.join("");
}

export function productCard(p, { reveal = true } = {}) {
  return `<article class="product-card"${reveal ? " data-reveal" : ""}>
    <a class="product-card__link" href="${urls.product(p.slug)}" data-product-id="${esc(p.id)}">
      <span class="product-card__media">
        <img src="${esc(safeImg(p.image_thumb_url || p.image_url))}" alt="${esc(p.image_alt || p.title)}" width="640" height="800" loading="lazy" decoding="async">
        <span class="product-card__badges">${productBadges(p)}</span>
      </span>
      <span class="product-card__body">
        <span class="product-card__title">${esc(p.title)}</span>
        <span class="product-card__price">${priceHtml(p)}</span>
        ${p.no_delivery ? '<span class="product-card__note">Только самовывоз</span>' : ""}
      </span>
    </a>
  </article>`;
}

/* ---------- Корзина: в localStorage только id и количество ---------- */

const CART_KEY = "cart:v1";

export const cart = {
  read() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) ?? "[]");
      return Array.isArray(raw)
        ? raw.filter((l) => typeof l?.id === "string" && Number.isInteger(l.qty) && l.qty > 0).map((l) => ({ id: l.id, qty: Math.min(l.qty, 50) }))
        : [];
    } catch {
      return [];
    }
  },
  write(lines) {
    localStorage.setItem(CART_KEY, JSON.stringify(lines.map((l) => ({ id: l.id, qty: l.qty }))));
    document.dispatchEvent(new CustomEvent("cart:change"));
  },
  add(id, qty = 1) {
    const lines = cart.read();
    const line = lines.find((l) => l.id === id);
    if (line) line.qty = Math.min(line.qty + qty, 50);
    else lines.push({ id, qty });
    cart.write(lines);
  },
  setQty(id, qty) {
    const lines = cart.read()
      .map((l) => (l.id === id ? { ...l, qty: Math.min(qty, 50) } : l))
      .filter((l) => l.qty > 0);
    cart.write(lines);
  },
  remove(id) {
    cart.write(cart.read().filter((l) => l.id !== id));
  },
  clear() {
    cart.write([]);
  },
  count() {
    return cart.read().reduce((s, l) => s + l.qty, 0);
  },
};

function updateCartBadge() {
  const n = cart.count();
  document.querySelectorAll("[data-cart-count]").forEach((el) => {
    el.textContent = String(n);
    el.hidden = n === 0;
  });
  document.querySelectorAll("[data-cart-open]").forEach((el) => {
    el.setAttribute("aria-label", n ? `Корзина, товаров: ${n}` : "Корзина пуста");
  });
}

/* ---------- Шапка и мобильное меню ---------- */

function initHeader() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  const toggle = header.querySelector(".nav-toggle");
  const nav = header.querySelector(".site-nav");
  if (!toggle || !nav) return;

  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
    header.classList.toggle("is-menu-open", open);
    if (open) nav.querySelector("a")?.focus();
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && header.classList.contains("is-menu-open")) {
      setOpen(false);
      toggle.focus();
    }
  });
  window.matchMedia("(min-width: 900px)").addEventListener("change", (mq) => mq.matches && setOpen(false));

  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

function initTestBanner() {
  if (!MOCK || document.querySelector(".test-banner")) return;
  const bar = document.createElement("p");
  bar.className = "test-banner";
  bar.innerHTML = "<strong>Тестовый режим.</strong> Товары, цены и зоны доставки — примеры, заказы никуда не отправляются.";
  document.body.prepend(bar);
}

/* ---------- Появление блоков: подъём из лёгкого размытия ---------- */

let revealObserver = null;

export function observeReveal(root = document) {
  const items = root.querySelectorAll("[data-reveal]:not(.is-visible)");
  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    items.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  revealObserver ??= new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  items.forEach((el) => revealObserver.observe(el));
}

/* ---------- Сообщения ---------- */

export function toast(message, tone = "info") {
  let region = document.querySelector(".toast-region");
  if (!region) {
    region = document.createElement("div");
    region.className = "toast-region";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  const item = document.createElement("p");
  item.className = `toast toast--${tone}`;
  item.textContent = message;
  region.append(item);
  setTimeout(() => {
    item.classList.add("is-leaving");
    setTimeout(() => item.remove(), 400);
  }, 3200);
}

// Диалоги: закрытие по клику на подложку и возврат фокуса на кнопку, которая открыла.
export function enhanceDialog(dialog) {
  if (!dialog || dialog.dataset.enhanced) return;
  dialog.dataset.enhanced = "1";
  let opener = null;
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("has-dialog");
    opener?.focus?.();
    opener = null;
  });
  dialog.openFrom = (trigger) => {
    opener = trigger ?? document.activeElement;
    if (!dialog.open) dialog.showModal();
    document.documentElement.classList.add("has-dialog");
  };
}

function initCartLinks() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-cart-open]");
    if (!link) return;
    const dialog = document.getElementById("cart");
    if (dialog?.openFrom) {
      e.preventDefault();
      document.dispatchEvent(new CustomEvent("cart:open", { detail: { trigger: link } }));
    }
  });
}

initTestBanner();
initHeader();
initCartLinks();
updateCartBadge();
document.addEventListener("cart:change", updateCartBadge);
window.addEventListener("storage", (e) => e.key === CART_KEY && updateCartBadge());
document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = String(new Date().getFullYear())));
observeReveal();
