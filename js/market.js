// Магазин, SEO-шаблоны категории и товара, диалог товара, корзина и оформление заказа.
import { api, ApiError, MOCK } from "./api.js?v=1";
import { cart, enhanceDialog, esc, icon, observeReveal, priceHtml, productBadges, productCard, safeImg, toast, urls } from "./app.js?v=1";
import {
  addDays,
  availabilityLine,
  cartRules,
  daysBetween,
  deliveryPrice,
  digits,
  effectivePrice,
  formatPrice,
  plural,
  slotOpen,
  slotsFor,
  tzLabel,
  validateOrder,
  zonedNow,
} from "./rules.js?v=1";

const SIZE_LABELS = { S: "Маленький", M: "Средний", L: "Большой" };
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAYS_FULL = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

const state = {
  catalog: { categories: [], products: [] },
  delivery: null,
  byId: new Map(),
};

const page = document.body.dataset.page;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/* ======================= Магазин ======================= */

const filters = {
  category: "",
  offers: false,
  q: "",
  min: "",
  max: "",
  flowers: new Set(),
  sizes: new Set(),
  where: "",
  sort: "default",
};

function readUrlFilters() {
  const params = new URLSearchParams(location.search);
  filters.category = params.get("category") ?? "";
  filters.offers = params.get("offers") === "1";
  filters.q = params.get("q") ?? "";
}

function writeUrlFilters() {
  const params = {};
  if (filters.offers) params.offers = 1;
  else if (filters.category) params.category = filters.category;
  if (filters.q) params.q = filters.q;
  history.replaceState(null, "", `${urls.shop(params)}${location.hash}`);
}

function matches(p) {
  if (filters.offers && !p.featured) return false;
  if (!filters.offers && filters.category && p.category !== filters.category) return false;
  if (filters.q && !`${p.title} ${p.description} ${p.flower_types.join(" ")}`.toLowerCase().includes(filters.q.toLowerCase())) return false;
  const price = effectivePrice(p);
  if (filters.min !== "" && price < Number(filters.min)) return false;
  if (filters.max !== "" && price > Number(filters.max)) return false;
  if (filters.flowers.size && !p.flower_types.some((f) => filters.flowers.has(f))) return false;
  if (filters.sizes.size && !filters.sizes.has(p.size)) return false;
  if (filters.where === "delivery" && p.no_delivery) return false;
  if (filters.where.startsWith("pickup:") && !p.pickup_branches.includes(filters.where.slice(7))) return false;
  return true;
}

const SORTS = {
  default: (a, b) => Number(b.featured) - Number(a.featured) || Number(b.showcase) - Number(a.showcase),
  cheap: (a, b) => effectivePrice(a) - effectivePrice(b),
  expensive: (a, b) => effectivePrice(b) - effectivePrice(a),
  new: (a, b) => Number(b.is_new) - Number(a.is_new) || b.created_at.localeCompare(a.created_at),
};

function renderShopChrome() {
  const { categories, products } = state.catalog;
  const chips = document.getElementById("category-chips");
  const chip = (label, attrs, pressed) =>
    `<button class="chip" type="button" ${attrs} aria-pressed="${pressed}">${esc(label)}</button>`;
  chips.innerHTML = [
    chip("Все", 'data-category=""', !filters.category && !filters.offers),
    products.some((p) => p.featured) ? chip("Предложения", "data-offers", filters.offers) : "",
    ...categories.map((c) => chip(c.name, `data-category="${esc(c.id)}"`, !filters.offers && filters.category === c.id)),
  ].join("");

  const flowerTypes = [...new Set(products.flatMap((p) => p.flower_types))].sort((a, b) => a.localeCompare(b, "ru"));
  document.getElementById("filter-flowers").innerHTML = flowerTypes.length
    ? flowerTypes
        .map((f) => `<label class="check check--sm"><input type="checkbox" value="${esc(f)}"${filters.flowers.has(f) ? " checked" : ""}> ${esc(f)}</label>`)
        .join("")
    : '<p class="hint">Нет данных о составе</p>';

  const sizes = [...new Set(products.map((p) => p.size).filter(Boolean))].sort((a, b) => "SML".indexOf(a) - "SML".indexOf(b));
  document.getElementById("filter-sizes").innerHTML = sizes
    .map((s) => `<label class="check check--sm"><input type="checkbox" value="${esc(s)}"${filters.sizes.has(s) ? " checked" : ""}> ${esc(SIZE_LABELS[s] ?? s)}</label>`)
    .join("");

  document.getElementById("filter-where").innerHTML = [
    '<option value="">Любой способ</option>',
    '<option value="delivery">Доставка</option>',
    ...state.delivery.pickup.filter((b) => !b.demo).map((b) => `<option value="pickup:${esc(b.id)}">Самовывоз: ${esc(b.short)}</option>`),
  ].join("");
  document.getElementById("filter-where").value = filters.where;
  document.getElementById("shop-search").value = filters.q;
}

function renderShop() {
  const { categories, products } = state.catalog;
  const category = categories.find((c) => c.id === filters.category);
  const title = filters.offers ? "Предложения" : category?.name ?? "Каталог";
  document.getElementById("shop-title").textContent = title;
  document.getElementById("shop-crumb").textContent = title;
  const lead = document.getElementById("shop-lead");
  lead.textContent = filters.offers ? "Букеты, которые студия предлагает сейчас." : category?.description ?? "Все букеты, коробки, растения и подарки.";
  const seoLink = document.getElementById("shop-seo-link");
  seoLink.hidden = !category || filters.offers;
  if (category) seoLink.href = urls.category(category.slug);
  document.title = `${title} — База цветов 24`;

  document.querySelectorAll("#category-chips .chip").forEach((el) => {
    const pressed = "offers" in el.dataset ? filters.offers : !filters.offers && el.dataset.category === filters.category;
    el.setAttribute("aria-pressed", String(pressed));
  });

  const list = products.filter(matches).sort(SORTS[filters.sort]);
  const grid = document.getElementById("shop-grid");
  grid.innerHTML = list.map((p) => productCard(p)).join("");
  document.getElementById("shop-empty").hidden = list.length > 0;
  document.getElementById("shop-count").textContent = `${list.length} ${plural(list.length, "товар", "товара", "товаров")}`;
  const active = activeFilterCount();
  document.getElementById("filters-count").textContent = active ? String(active) : "";
  observeReveal(grid);
}

function activeFilterCount() {
  return (filters.min !== "") + (filters.max !== "") + filters.flowers.size + filters.sizes.size + (filters.where !== "");
}

function resetFilters() {
  Object.assign(filters, { q: "", min: "", max: "", where: "", sort: "default" });
  filters.flowers.clear();
  filters.sizes.clear();
  document.getElementById("price-min").value = "";
  document.getElementById("price-max").value = "";
  document.getElementById("shop-sort").value = "default";
  renderShopChrome();
  writeUrlFilters();
  renderShop();
}

function initShop() {
  readUrlFilters();
  renderShopChrome();
  renderShop();

  document.getElementById("category-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    filters.offers = "offers" in btn.dataset;
    filters.category = filters.offers ? "" : btn.dataset.category;
    writeUrlFilters();
    renderShop();
  });

  let searchTimer;
  document.getElementById("shop-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.q = e.target.value.trim();
      writeUrlFilters();
      renderShop();
    }, 200);
  });
  document.getElementById("shop-sort").addEventListener("change", (e) => {
    filters.sort = e.target.value;
    renderShop();
  });
  const priceInput = (key) => (e) => {
    const v = digits(e.target.value);
    e.target.value = v;
    filters[key] = v;
    renderShop();
  };
  document.getElementById("price-min").addEventListener("input", priceInput("min"));
  document.getElementById("price-max").addEventListener("input", priceInput("max"));
  document.getElementById("filter-flowers").addEventListener("change", (e) => {
    e.target.checked ? filters.flowers.add(e.target.value) : filters.flowers.delete(e.target.value);
    renderShop();
  });
  document.getElementById("filter-sizes").addEventListener("change", (e) => {
    e.target.checked ? filters.sizes.add(e.target.value) : filters.sizes.delete(e.target.value);
    renderShop();
  });
  document.getElementById("filter-where").addEventListener("change", (e) => {
    filters.where = e.target.value;
    renderShop();
  });
  document.querySelectorAll("[data-reset-filters]").forEach((b) => b.addEventListener("click", resetFilters));

  const toggle = document.getElementById("filters-toggle");
  const panel = document.getElementById("shop-filters");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    panel.classList.toggle("is-open", open);
  });
}

/* ======================= SEO-шаблоны (этап 1: заполняются из мока по ?slug=) ======================= */

function setMeta(title, description) {
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", description);
}

function paragraphs(text) {
  return String(text ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");
}

function notFound(root, what) {
  root.innerHTML = `<div class="container section"><h1>${esc(what)} не найден${what === "Товар" ? "" : "а"}</h1>
    <p class="muted">Возможно, ссылка устарела.</p><a class="btn" href="${urls.shop()}">В каталог</a></div>`;
}

function initCategoryPage() {
  const slug = new URLSearchParams(location.search).get("slug") ?? "";
  const root = document.getElementById("seo-root");
  const category = state.catalog.categories.find((c) => c.slug === slug);
  if (!category) return notFound(root, "Категория");

  const products = state.catalog.products.filter((p) => p.category === category.id);
  const h1 = category.seo_h1 || category.name;
  setMeta(
    category.seo_title || `${category.name} — купить в Москве | База цветов 24`,
    category.seo_description || `${category.name} в магазине «База цветов 24», Москва, Алтуфьевское шоссе, 56.`,
  );
  root.innerHTML = `
    <div class="container seo-page">
      <nav class="crumbs" aria-label="Хлебные крошки"><ol>
        <li><a href="index.html">Главная</a></li><li><a href="${urls.shop()}">Каталог</a></li><li aria-current="page">${esc(category.name)}</li>
      </ol></nav>
      <header class="seo-head">
        <h1>${esc(h1)}</h1>
        ${category.description ? `<p class="seo-lead">${esc(category.description)}</p>` : ""}
        <p class="muted">${products.length} ${plural(products.length, "товар", "товара", "товаров")}</p>
      </header>
      ${products.length ? `<div class="product-grid">${products.map((p) => productCard(p)).join("")}</div>` : '<p class="muted">В этой коллекции пока нет товаров.</p>'}
      ${category.seo_text ? `<section class="seo-text" aria-label="О коллекции"><h2>О коллекции</h2>${paragraphs(category.seo_text)}</section>` : ""}
      <p><a class="btn btn--ghost" href="${urls.shop({ category: category.id })}">Фильтры и весь каталог</a></p>
    </div>`;
  observeReveal(root);
}

function initProductPage() {
  const slug = new URLSearchParams(location.search).get("slug") ?? "";
  const root = document.getElementById("seo-root");
  const p = state.catalog.products.find((x) => x.slug === slug);
  if (!p) return notFound(root, "Товар");
  const category = state.catalog.categories.find((c) => c.id === p.category);
  setMeta(
    p.seo_title || `${p.title} — ${formatPrice(effectivePrice(p))} | База цветов 24`,
    p.seo_description || `${p.title}${category ? `, ${category.name.toLowerCase()}` : ""}. ${availabilityLine(p, state.delivery)}.`,
  );
  root.innerHTML = `
    <div class="container seo-page">
      <nav class="crumbs" aria-label="Хлебные крошки"><ol>
        <li><a href="index.html">Главная</a></li><li><a href="${urls.shop()}">Каталог</a></li>
        ${category ? `<li><a href="${urls.category(category.slug)}">${esc(category.name)}</a></li>` : ""}
        <li aria-current="page">${esc(p.title)}</li>
      </ol></nav>
      <article class="product-page">${productDetailHtml(p, "page")}</article>
    </div>`;
  bindDetail(root, p);
}

/* ======================= Товар: диалог и страница ======================= */

function productDetailHtml(p, mode) {
  const Heading = mode === "page" ? "h1" : "h2";
  return `
    <div class="detail__media">
      <img src="${esc(safeImg(p.image_url))}" alt="${esc(p.image_alt || p.title)}" width="800" height="1000">
      <span class="product-card__badges">${productBadges(p)}</span>
    </div>
    <div class="detail__body">
      <${Heading} class="detail__title" id="detail-title">${esc(p.title)}</${Heading}>
      <p class="detail__price">${priceHtml(p)}</p>
      <p class="detail__availability">${icon(p.no_delivery ? "store" : "truck")}<span>${esc(availabilityLine(p, state.delivery))}</span></p>
      ${p.description ? `<div class="detail__text">${paragraphs(p.description)}</div>` : ""}
      <dl class="detail__facts">
        ${p.flower_types.length ? `<div><dt>Состав</dt><dd>${esc(p.flower_types.join(", "))}</dd></div>` : ""}
        ${p.size ? `<div><dt>Размер</dt><dd>${esc(SIZE_LABELS[p.size] ?? p.size)}</dd></div>` : ""}
      </dl>
      <div class="detail__buy">
        <div class="qty" role="group" aria-label="Количество">
          <button class="icon-btn" type="button" data-qty="-1" aria-label="Меньше">${icon("minus")}</button>
          <output class="qty__value" data-qty-value aria-live="polite">1</output>
          <button class="icon-btn" type="button" data-qty="1" aria-label="Больше">${icon("plus")}</button>
        </div>
        <button class="btn" type="button" data-add-to-cart>${icon("cart")} В корзину</button>
      </div>
      ${mode === "dialog" ? `<a class="detail__page-link" href="${urls.product(p.slug)}">Страница товара</a>` : ""}
    </div>`;
}

function bindDetail(root, p, onAdded) {
  let qty = 1;
  const out = root.querySelector("[data-qty-value]");
  root.querySelectorAll("[data-qty]").forEach((b) =>
    b.addEventListener("click", () => {
      qty = Math.min(50, Math.max(1, qty + Number(b.dataset.qty)));
      out.textContent = String(qty);
    }),
  );
  root.querySelector("[data-add-to-cart]").addEventListener("click", (e) => {
    cart.add(p.id, qty);
    toast(`«${p.title}» в корзине`);
    onAdded?.();
    openCart(e.currentTarget);
  });
}

function openDetail(p, trigger) {
  const dialog = document.getElementById("detail");
  dialog.querySelector(".detail").innerHTML = productDetailHtml(p, "dialog");
  bindDetail(dialog, p, () => dialog.close());
  dialog.openFrom(trigger);
}

function initDetailLinks() {
  const dialog = document.getElementById("detail");
  enhanceDialog(dialog);
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[data-product-id]");
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const p = state.byId.get(link.dataset.productId);
    if (!p) return;
    e.preventDefault();
    openDetail(p, link);
  });
}

/* ======================= Корзина ======================= */

function cartLines() {
  const lines = cart.read();
  const valid = lines.filter((l) => state.byId.has(l.id));
  if (valid.length !== lines.length) {
    cart.write(valid);
    toast("Часть товаров больше недоступна — убрали их из корзины");
  }
  return valid.map((l) => ({ ...l, product: state.byId.get(l.id) }));
}

function itemsTotal(lines) {
  return lines.reduce((s, l) => s + effectivePrice(l.product) * l.qty, 0);
}

function renderCart() {
  const lines = cartLines();
  const list = document.getElementById("cart-items");
  const empty = document.getElementById("cart-empty");
  const footer = document.getElementById("cart-footer");
  empty.hidden = lines.length > 0;
  footer.hidden = lines.length === 0;
  list.innerHTML = lines
    .map(
      ({ product: p, qty }) => `<li class="cart-line">
        <img src="${esc(safeImg(p.image_thumb_url || p.image_url))}" alt="" width="72" height="90">
        <div class="cart-line__info">
          <p class="cart-line__title">${esc(p.title)}</p>
          <p class="cart-line__price">${priceHtml(p)}</p>
          ${p.no_delivery ? '<p class="cart-line__note">Только самовывоз</p>' : ""}
        </div>
        <div class="qty qty--sm" role="group" aria-label="Количество: ${esc(p.title)}">
          <button class="icon-btn" type="button" data-line-qty="${esc(p.id)}" data-delta="-1" aria-label="Меньше">${icon("minus")}</button>
          <span class="qty__value">${qty}</span>
          <button class="icon-btn" type="button" data-line-qty="${esc(p.id)}" data-delta="1" aria-label="Больше">${icon("plus")}</button>
        </div>
        <button class="icon-btn cart-line__remove" type="button" data-line-remove="${esc(p.id)}" aria-label="Убрать «${esc(p.title)}»">${icon("trash")}</button>
      </li>`,
    )
    .join("");
  document.getElementById("cart-subtotal").textContent = formatPrice(itemsTotal(lines));
  if (!lines.length && !document.getElementById("order").hidden) showCartStep("cart");
  if (!document.getElementById("order").hidden) refreshOrder();
}

function showCartStep(step) {
  document.getElementById("cart-view").hidden = step !== "cart";
  document.getElementById("order").hidden = step !== "order";
  document.getElementById("order-success").hidden = step !== "success";
  document.getElementById("cart-title").textContent = step === "order" ? "Оформление заказа" : step === "success" ? "Заказ принят" : "Корзина";
  document.getElementById("cart").scrollTop = 0;
}

function openCart(trigger) {
  const dialog = document.getElementById("cart");
  if (!dialog.open) showCartStep("cart");
  renderCart();
  dialog.openFrom(trigger);
}

function initCart() {
  const dialog = document.getElementById("cart");
  enhanceDialog(dialog);
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  document.addEventListener("cart:open", (e) => openCart(e.detail?.trigger));
  document.addEventListener("cart:change", () => dialog.open && renderCart());

  document.getElementById("cart-items").addEventListener("click", (e) => {
    const q = e.target.closest("[data-line-qty]");
    if (q) {
      const line = cart.read().find((l) => l.id === q.dataset.lineQty);
      if (line) cart.setQty(line.id, Math.max(0, line.qty + Number(q.dataset.delta)));
      return;
    }
    const r = e.target.closest("[data-line-remove]");
    if (r) cart.remove(r.dataset.lineRemove);
  });
  document.getElementById("cart-checkout").addEventListener("click", () => {
    showCartStep("order");
    refreshOrder(true);
    document.querySelector('#order input[name="delivery_method"]:not(:disabled)')?.focus();
  });
  document.getElementById("order-back").addEventListener("click", () => showCartStep("cart"));
  document.getElementById("success-close").addEventListener("click", () => dialog.close());

  if (location.hash === "#cart") openCart();
}

/* ======================= Оформление заказа ======================= */

const order = {
  date: "",
  month: "",
};

const $ = (id) => document.getElementById(id);

function method() {
  return document.querySelector('#order input[name="delivery_method"]:checked')?.value ?? "";
}

function renderOrderStatic() {
  const d = state.delivery;
  const zoneOption = (z) => `<option value="${esc(z.id)}">${esc(z.name)} — ${formatPrice(z.price)}</option>`;
  $("delivery-zone").innerHTML = `<option value="">Выберите район</option>${d.zones.map(zoneOption).join("")}`;
  $("surprise-zone").innerHTML = `<option value="">Выберите</option>${d.surprise_zones.map(zoneOption).join("")}`;
  $("zone-hint").textContent = d.free_from ? `Бесплатно от ${formatPrice(d.free_from)}` : "";
  $("slots-label").textContent = `Время · ${tzLabel(d.timezone)}`;
}

function renderPickup(common) {
  $("pickup-list").innerHTML = state.delivery.pickup
    .map((b) => {
      const ok = common.includes(b.id);
      return `<label class="pickup-option${ok ? "" : " is-disabled"}">
        <input type="radio" name="pickup_branch" value="${esc(b.id)}"${ok ? "" : " disabled"}>
        <span class="pickup-option__body">
          <strong>${esc(b.name)}</strong>
          <span>${esc(b.address)}</span>
          <span class="muted">${esc(b.hours)}</span>
          ${b.demo && b.details ? `<span class="muted">${esc(b.details)}</span>` : ""}
          ${ok ? "" : '<span class="pickup-option__flag">Здесь есть не все товары из корзины</span>'}
        </span>
      </label>`;
    })
    .join("");
}

// Пересчитывает доступные способы, студии, слоты и итог. first — при входе в форму.
function refreshOrder(first = false) {
  const lines = cartLines();
  const products = lines.map((l) => l.product);
  const rules = cartRules(products, state.delivery.pickup);
  const note = $("method-note");
  const radios = [...document.querySelectorAll('#order input[name="delivery_method"]')];

  radios.forEach((r) => {
    r.disabled = r.value !== "pickup" && rules.noDelivery;
    r.closest(".method").classList.toggle("is-disabled", r.disabled);
  });
  const pickupRadio = radios.find((r) => r.value === "pickup");
  pickupRadio.disabled = rules.commonPickup.length === 0;
  pickupRadio.closest(".method").classList.toggle("is-disabled", pickupRadio.disabled);

  const notes = [];
  if (rules.noDelivery) notes.push("В корзине есть товар только для самовывоза — доставка и сюрприз недоступны.");
  if (rules.commonPickup.length === 0) {
    notes.push(
      rules.noDelivery
        ? "Товары из корзины есть в разных студиях, а один из них нельзя доставить. Оформите их отдельными заказами."
        : "Товары из корзины есть в разных студиях — для самовывоза нет общей студии. Выберите доставку или оформите отдельными заказами.",
    );
  }
  note.hidden = notes.length === 0;
  note.innerHTML = notes.map((n) => `<span>${esc(n)}</span>`).join(" ");

  const checked = radios.find((r) => r.checked);
  if (!checked || checked.disabled) {
    radios.forEach((r) => (r.checked = false));
    const firstAvailable = radios.find((r) => !r.disabled);
    if (firstAvailable) firstAvailable.checked = true;
  }

  const prevBranch = document.querySelector('#order input[name="pickup_branch"]:checked')?.value;
  renderPickup(rules.commonPickup);
  const keep = prevBranch && rules.commonPickup.includes(prevBranch) ? prevBranch : rules.commonPickup.length === 1 ? rules.commonPickup[0] : "";
  if (keep) document.querySelector(`#order input[name="pickup_branch"][value="${CSS.escape(keep)}"]`).checked = true;

  const m = method();
  document.querySelectorAll("#order [data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== m));
  $("when-legend").textContent = m === "pickup" ? "Когда забрать" : "Когда доставить";
  $("recipient-field").hidden = $("self-recipient").checked;
  $("order-submit").disabled = !m;

  if (first || !order.date) pickDefaultDate();
  renderCalendar();
  renderSlots();
  renderSummary(lines);
}

function renderSummary(lines) {
  const total = itemsTotal(lines);
  const m = method();
  const zone = m === "surprise" ? $("surprise-zone").value : $("delivery-zone").value;
  const dPrice = m ? deliveryPrice(m, zone, total, state.delivery) : null;
  const deliveryText = m === "pickup" ? "Самовывоз — 0 ₽" : dPrice === null ? "выберите район" : dPrice === 0 ? "бесплатно" : formatPrice(dPrice);
  $("sum-items").textContent = formatPrice(total);
  $("sum-delivery").textContent = deliveryText;
  $("sum-total").textContent = formatPrice(total + (dPrice ?? 0));
  $("order-submit-total").textContent = formatPrice(total + (dPrice ?? 0));
}

function dateHasSlots(iso) {
  return slotsFor(method() || "delivery", state.delivery).some((s) => slotOpen(s, iso, state.delivery));
}

function pickDefaultDate() {
  const today = zonedNow(state.delivery.timezone).date;
  if (order.date && daysBetween(today, order.date) >= 0 && dateHasSlots(order.date)) return;
  for (let i = 0; i < state.delivery.booking_days; i++) {
    const iso = addDays(today, i);
    if (dateHasSlots(iso)) {
      order.date = iso;
      order.month = iso.slice(0, 7);
      return;
    }
  }
}

function renderCalendar() {
  const d = state.delivery;
  const today = zonedNow(d.timezone).date;
  const last = addDays(today, d.booking_days - 1);
  order.month ||= today.slice(0, 7);
  const [y, mo] = order.month.split("-").map(Number);
  const firstIso = `${order.month}-01`;
  const offset = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span class="cal__pad" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = addDays(firstIso, day - 1);
    const inRange = iso >= today && iso <= last;
    const enabled = inRange && dateHasSlots(iso);
    const selected = iso === order.date;
    const wd = (offset + day - 1) % 7;
    cells.push(
      `<button class="cal__day${iso === today ? " is-today" : ""}" type="button" data-date="${iso}" aria-pressed="${selected}"
        aria-label="${day} ${MONTHS_GEN[mo - 1]}, ${WEEKDAYS_FULL[wd]}${iso === today ? ", сегодня" : ""}${enabled ? "" : ", недоступно"}"
        tabindex="${selected ? 0 : -1}"${enabled ? "" : " disabled"}>${day}</button>`,
    );
  }
  const prevDisabled = order.month <= today.slice(0, 7);
  const nextDisabled = order.month >= last.slice(0, 7);
  $("calendar").innerHTML = `
    <div class="cal__head">
      <button class="icon-btn" type="button" data-cal-nav="-1" aria-label="Предыдущий месяц"${prevDisabled ? " disabled" : ""}>${icon("chevron-left")}</button>
      <p class="cal__month" aria-live="polite">${MONTHS[mo - 1]} ${y}</p>
      <button class="icon-btn" type="button" data-cal-nav="1" aria-label="Следующий месяц"${nextDisabled ? " disabled" : ""}>${icon("chevron-right")}</button>
    </div>
    <div class="cal__grid" role="group" aria-label="Дата">
      ${WEEKDAYS.map((w) => `<span class="cal__wd" aria-hidden="true">${w}</span>`).join("")}
      ${cells.join("")}
    </div>`;
  if (!$("calendar").querySelector('.cal__day[tabindex="0"]')) {
    $("calendar").querySelector(".cal__day:not(:disabled)")?.setAttribute("tabindex", "0");
  }
  $("delivery-date").value = order.date;
}

function renderSlots() {
  const m = method() || "delivery";
  const prev = document.querySelector('#order input[name="delivery_slot"]:checked')?.value;
  const slots = slotsFor(m, state.delivery);
  $("slots").innerHTML = order.date
    ? slots
        .map((s) => {
          const open = slotOpen(s, order.date, state.delivery);
          return `<label class="slot${open ? "" : " is-disabled"}"><input type="radio" name="delivery_slot" value="${esc(s.label)}"${open ? "" : " disabled"}${open && s.label === prev ? " checked" : ""}><span>${esc(s.label)}</span></label>`;
        })
        .join("")
    : '<p class="hint">Сначала выберите дату</p>';
}

function initCalendarEvents() {
  const cal = $("calendar");
  cal.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-cal-nav]");
    if (nav) {
      const [y, m] = order.month.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1 + Number(nav.dataset.calNav), 1));
      order.month = dt.toISOString().slice(0, 7);
      renderCalendar();
      return;
    }
    const day = e.target.closest(".cal__day");
    if (day && !day.disabled) {
      order.date = day.dataset.date;
      renderCalendar();
      renderSlots();
      clearError("delivery_date");
      cal.querySelector(`[data-date="${order.date}"]`)?.focus();
    }
  });
  cal.addEventListener("keydown", (e) => {
    const day = e.target.closest(".cal__day");
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!day || !step) return;
    e.preventDefault();
    const days = [...cal.querySelectorAll(".cal__day")];
    let i = days.indexOf(day) + step;
    while (days[i] && days[i].disabled) i += Math.sign(step);
    if (days[i]) {
      days.forEach((d) => d.setAttribute("tabindex", "-1"));
      days[i].setAttribute("tabindex", "0");
      days[i].focus();
    }
  });
}

/* ---------- Ошибки у полей ---------- */

const ERROR_TARGETS = {
  phone: () => "phone",
  name: () => "name",
  email: () => "email",
  delivery_method: () => "dm-delivery",
  delivery_zone: () => (method() === "surprise" ? "surprise-zone" : "delivery-zone"),
  address: () => "address",
  recipient_phone: () => (method() === "surprise" ? "surprise-phone" : "recipient-phone"),
  pickup_branch: () => "pickup-list",
  delivery_date: () => "calendar",
  delivery_slot: () => "slots",
  data_consent: () => "data-consent",
  offer_accepted: () => "offer-accepted",
};

function errorTarget(key) {
  return ERROR_TARGETS[key] ? $(ERROR_TARGETS[key]()) : null;
}

function clearError(key) {
  const target = errorTarget(key);
  if (!target) return;
  target.removeAttribute("aria-invalid");
  const errEl = $(`${target.id}-error`);
  if (errEl) errEl.textContent = "";
}

function clearAllErrors() {
  document.querySelectorAll("#order [aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  document.querySelectorAll("#order .field-error").forEach((el) => (el.textContent = ""));
  $("order-status").textContent = "";
}

function showErrors(errors) {
  clearAllErrors();
  const keys = Object.keys(errors);
  let firstTarget = null;
  keys.forEach((key) => {
    const target = errorTarget(key);
    if (!target) return;
    target.setAttribute("aria-invalid", "true");
    const errEl = $(`${target.id}-error`);
    if (errEl) errEl.textContent = errors[key];
    firstTarget ??= target;
  });
  const n = keys.length;
  $("order-status").textContent = `Проверьте ${n} ${plural(n, "поле", "поля", "полей")}: ${keys.map((k) => errors[k]).join("; ")}.`;
  if (firstTarget) {
    const focusable = firstTarget.matches("input, select, textarea, button")
      ? firstTarget
      : firstTarget.querySelector("input:not(:disabled), button:not(:disabled)[tabindex='0'], button:not(:disabled)");
    (focusable ?? firstTarget).focus({ preventScroll: true });
    firstTarget.scrollIntoView({ block: "center", behavior: reducedMotion.matches ? "auto" : "smooth" });
  }
}

function buildPayload() {
  const m = method();
  const phone = $("phone").value.trim();
  const base = {
    name: $("name").value.trim(),
    phone,
    email: $("email").value.trim(),
    address: "",
    delivery_method: m,
    delivery_zone: "",
    pickup_branch: "",
    delivery_date: order.date,
    delivery_slot: document.querySelector('#order input[name="delivery_slot"]:checked')?.value ?? "",
    recipient_phone: "",
    comment: $("comment").value.trim(),
    items: cart.read().map((l) => ({ product_id: l.id, quantity: l.qty })),
    data_consent: $("data-consent").checked,
    offer_accepted: $("offer-accepted").checked,
  };
  const version = $("order").dataset.legalVersion;
  Object.assign(base, { consent_version: version, privacy_version: version, offer_version: version });
  if (m === "delivery") {
    base.delivery_zone = $("delivery-zone").value;
    base.address = $("address").value.trim();
    base.recipient_phone = $("self-recipient").checked ? phone : $("recipient-phone").value.trim();
  } else if (m === "surprise") {
    base.delivery_zone = $("surprise-zone").value;
    base.address = $("surprise-address").value.trim();
    base.recipient_phone = $("surprise-phone").value.trim();
  } else if (m === "pickup") {
    base.pickup_branch = document.querySelector('#order input[name="pickup_branch"]:checked')?.value ?? "";
  }
  return base;
}

function mapServerErrors(fields) {
  const out = { ...fields };
  if (method() === "delivery" && $("self-recipient").checked && out.recipient_phone) {
    out.phone = out.phone ?? out.recipient_phone;
    delete out.recipient_phone;
  }
  return out;
}

async function submitOrder(e) {
  e.preventDefault();
  const payload = buildPayload();
  const products = payload.items.map((it) => state.byId.get(it.product_id)).filter(Boolean);
  const errors = mapServerErrors(validateOrder(payload, { products, delivery: state.delivery }));
  delete errors.items;
  if (Object.keys(errors).length) return showErrors(errors);

  const btn = $("order-submit");
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  $("order-status").textContent = "Отправляем заказ…";
  try {
    const res = await api("/api/orders", { method: "POST", body: payload });
    cart.clear();
    $("success-number").textContent = res.order_id;
    $("success-when").textContent = `${formatDate(payload.delivery_date)}, ${payload.delivery_slot}`;
    $("order").reset();
    order.date = "";
    clearAllErrors();
    showCartStep("success");
    $("success-close").focus();
  } catch (err) {
    if (err instanceof ApiError && Object.keys(err.fields).length) showErrors(mapServerErrors(err.fields));
    else $("order-status").textContent = err.message || "Не получилось отправить заказ. Попробуйте ещё раз или позвоните нам.";
  } finally {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
  }
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return `${d} ${MONTHS_GEN[m - 1]}, ${WEEKDAYS_FULL[wd]}`;
}

function initOrderForm() {
  const form = $("order");
  renderOrderStatic();
  initCalendarEvents();

  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "delivery_method") {
      clearError("delivery_method");
      refreshOrder();
    } else if (t.id === "self-recipient") {
      $("recipient-field").hidden = t.checked;
      if (t.checked) clearError("recipient_phone");
    } else if (t.name === "delivery_slot") {
      clearError("delivery_slot");
    } else if (t.name === "pickup_branch") {
      clearError("pickup_branch");
    } else if (t.id === "delivery-zone" || t.id === "surprise-zone") {
      clearError("delivery_zone");
      renderSummary(cartLines());
    } else if (t.id === "data-consent") {
      clearError("data_consent");
    } else if (t.id === "offer-accepted") {
      clearError("offer_accepted");
    }
  });
  form.addEventListener("input", (e) => {
    const key = { phone: "phone", name: "name", email: "email", address: "address", "recipient-phone": "recipient_phone", "surprise-phone": "recipient_phone" }[e.target.id];
    if (key && e.target.getAttribute("aria-invalid")) clearError(key);
  });
  form.addEventListener("submit", submitOrder);
  $("order-mode").hidden = !MOCK;

  // Слоты «за 60 минут» зависят от текущего времени студии — обновляем раз в минуту.
  setInterval(() => {
    if (!form.hidden) {
      renderCalendar();
      renderSlots();
    }
  }, 60000);
}

/* ======================= Разметка диалогов ======================= */

// ID полей — контракт с бэкендом этапа 2 (MOCKS.md); при правках не переименовывать.
function dialogsMarkup() {
  const closeBtn = `<button class="icon-btn dialog-close" type="button" aria-label="Закрыть">${icon("close")}</button>`;
  return `
  <dialog class="dialog dialog--sheet detail-dialog" id="detail" aria-labelledby="detail-title">
    ${closeBtn}
    <div class="detail"></div>
  </dialog>

  <dialog class="dialog dialog--sheet cart-dialog" id="cart" aria-labelledby="cart-title">
    ${closeBtn}
    <div class="cart-wrap">
      <h2 class="cart-title" id="cart-title">Корзина</h2>

      <div id="cart-view">
        <ul class="cart-items" id="cart-items"></ul>
        <div class="cart-empty" id="cart-empty" hidden>
          ${icon("flower", "cart-empty__icon")}
          <p>В корзине пока пусто.</p>
          <a class="btn btn--ghost" href="${urls.shop()}">Выбрать букет</a>
        </div>
        <div class="cart-footer" id="cart-footer" data-dock-avoid>
          <p class="cart-subtotal"><span>Товары</span> <strong id="cart-subtotal">0 ₽</strong></p>
          <p class="hint">Доставка считается на следующем шаге.</p>
          <button class="btn btn--block" type="button" id="cart-checkout">Оформить заказ</button>
        </div>
      </div>

      <form class="order" id="order" novalidate data-legal-version="draft" hidden>
        <p class="status-test" id="order-mode">Тестовый режим: заказ никуда не уйдёт</p>

        <fieldset class="order-block">
          <legend>Как получить</legend>
          <div class="methods">
            <label class="method"><input type="radio" name="delivery_method" value="delivery" id="dm-delivery" aria-describedby="dm-delivery-error method-note">
              <span class="method__body">${icon("truck")}<strong>Доставка</strong><small>по адресу</small></span></label>
            <label class="method"><input type="radio" name="delivery_method" value="surprise" id="dm-surprise">
              <span class="method__body">${icon("gift")}<strong>Сюрприз</strong><small>мы позвоним получателю</small></span></label>
            <label class="method"><input type="radio" name="delivery_method" value="pickup" id="dm-pickup">
              <span class="method__body">${icon("store")}<strong>Самовывоз</strong><small>из студии</small></span></label>
          </div>
          <p class="field-error" id="dm-delivery-error"></p>
          <p class="order-note" id="method-note" hidden></p>

          <div class="method-panel" data-panel="delivery">
            <div class="field">
              <label for="delivery-zone">Район доставки</label>
              <select class="select" id="delivery-zone" name="delivery_zone" aria-describedby="zone-hint delivery-zone-error"></select>
              <p class="hint" id="zone-hint"></p>
              <p class="field-error" id="delivery-zone-error"></p>
            </div>
            <div class="field">
              <label for="address">Адрес доставки</label>
              <input class="input" id="address" name="address" autocomplete="street-address" placeholder="Улица, дом, подъезд, квартира" aria-describedby="address-error">
              <p class="field-error" id="address-error"></p>
            </div>
            <label class="check"><input type="checkbox" id="self-recipient" checked> Получу сам</label>
            <div class="field" id="recipient-field" hidden>
              <label for="recipient-phone">Телефон получателя</label>
              <input class="input" id="recipient-phone" type="tel" inputmode="tel" autocomplete="off" placeholder="+7" aria-describedby="recipient-phone-error">
              <p class="field-error" id="recipient-phone-error"></p>
            </div>
          </div>

          <div class="method-panel" data-panel="surprise" hidden>
            <p class="order-hint">${icon("info")}<span>Не знаете адрес? Оставьте телефон получателя — мы позвоним ему, уточним адрес и время, не раскрывая сюрприз.</span></p>
            <div class="field">
              <label for="surprise-zone">Куда</label>
              <select class="select" id="surprise-zone" aria-describedby="surprise-zone-error"></select>
              <p class="field-error" id="surprise-zone-error"></p>
            </div>
            <div class="field">
              <label for="surprise-phone">Телефон получателя</label>
              <input class="input" id="surprise-phone" type="tel" inputmode="tel" autocomplete="off" placeholder="+7" aria-describedby="surprise-phone-error">
              <p class="field-error" id="surprise-phone-error"></p>
            </div>
            <div class="field">
              <label for="surprise-address">Что знаете об адресе · необязательно</label>
              <textarea class="textarea" id="surprise-address" rows="2" placeholder="Например: район или место работы"></textarea>
            </div>
          </div>

          <div class="method-panel" data-panel="pickup" hidden>
            <div class="pickup-list" id="pickup-list" role="radiogroup" aria-label="Студия" aria-describedby="pickup-list-error" tabindex="-1"></div>
            <p class="field-error" id="pickup-list-error"></p>
          </div>
        </fieldset>

        <fieldset class="order-block">
          <legend id="when-legend">Когда доставить</legend>
          <input type="hidden" id="delivery-date" name="delivery_date">
          <div class="cal" id="calendar" tabindex="-1" aria-describedby="calendar-error"></div>
          <p class="field-error" id="calendar-error"></p>
          <p class="field-label" id="slots-label">Время</p>
          <div class="slots" id="slots" role="radiogroup" aria-labelledby="slots-label" aria-describedby="slots-error" tabindex="-1"></div>
          <p class="field-error" id="slots-error"></p>
        </fieldset>

        <fieldset class="order-block">
          <legend>Контакты</legend>
          <div class="field">
            <label for="phone">Телефон</label>
            <input class="input" id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7" required aria-describedby="phone-error">
            <p class="field-error" id="phone-error"></p>
          </div>
          <div class="field">
            <label for="email">Email <span class="muted">· для чека</span></label>
            <input class="input" id="email" name="email" type="email" autocomplete="email" aria-describedby="email-error">
            <p class="field-error" id="email-error"></p>
          </div>
          <div class="field">
            <label for="name">Имя</label>
            <input class="input" id="name" name="name" autocomplete="name" required aria-describedby="name-error">
            <p class="field-error" id="name-error"></p>
          </div>
          <div class="field">
            <label for="comment">Пожелания или текст открытки · <span class="muted">необязательно</span></label>
            <textarea class="textarea" id="comment" name="comment" rows="3"></textarea>
          </div>
        </fieldset>

        <dl class="order-summary">
          <div><dt>Товары</dt><dd id="sum-items">0 ₽</dd></div>
          <div><dt>Доставка</dt><dd id="sum-delivery">—</dd></div>
          <div class="order-summary__total"><dt>Итого</dt><dd id="sum-total">0 ₽</dd></div>
        </dl>

        <div class="order-consents">
          <label class="check"><input type="checkbox" id="data-consent" name="data_consent" aria-describedby="data-consent-error">
            <span>Согласен(на) на <a href="consent.html" target="_blank" rel="noopener">обработку персональных данных</a></span></label>
          <p class="field-error" id="data-consent-error"></p>
          <label class="check"><input type="checkbox" id="offer-accepted" name="offer_accepted" aria-describedby="offer-accepted-error">
            <span>Принимаю условия <a href="offer.html" target="_blank" rel="noopener">публичной оферты</a></span></label>
          <p class="field-error" id="offer-accepted-error"></p>
          <p class="hint">Данные нужны только для заказа, без рассылок. <a href="privacy.html" target="_blank" rel="noopener">Политика обработки данных</a></p>
        </div>

        <p class="form-status" id="order-status" role="status" aria-live="polite"></p>

        <div class="order-actions" data-dock-avoid>
          <button class="btn btn--ghost" type="button" id="order-back">${icon("chevron-left")} Корзина</button>
          <button class="btn" type="submit" id="order-submit">Оформить · <span id="order-submit-total">0 ₽</span></button>
        </div>
      </form>

      <div class="order-success" id="order-success" hidden>
        ${icon("check", "order-success__icon")}
        <p class="order-success__title">Заказ <strong id="success-number"></strong> принят</p>
        <p id="success-when"></p>
        <p class="status-test">Тестовый режим</p>
        <p class="muted">Оплата через ЮKassa и уведомления в Telegram подключатся на этапе 2. Заказ никуда не отправляется и не сохраняется.</p>
        <button class="btn" type="button" id="success-close">Готово</button>
      </div>
    </div>
  </dialog>`;
}

/* ======================= Запуск ======================= */

async function init() {
  if (!document.getElementById("cart")) document.body.insertAdjacentHTML("beforeend", dialogsMarkup());
  try {
    const [catalog, delivery] = await Promise.all([api("/api/catalog"), api("/api/delivery")]);
    state.catalog = catalog;
    state.delivery = delivery;
    state.byId = new Map(catalog.products.map((p) => [p.id, p]));
  } catch (err) {
    console.error(err);
    toast("Не получилось загрузить каталог. Обновите страницу.", "error");
    return;
  }
  if (page === "shop") initShop();
  if (page === "category") initCategoryPage();
  if (page === "product") initProductPage();
  if (page !== "product") initDetailLinks();
  initCart();
  initOrderForm();
}

init();
