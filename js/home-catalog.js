// Главная: слайдер, «Готовы прямо сейчас», коллекции, студии с картой, зоны доставки.
import { api } from "./api.js?v=1";
import { esc, icon, observeReveal, productCard, safeImg, urls } from "./app.js?v=2";
import { formatPrice, tzLabel } from "./rules.js?v=2";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function initHero(slides) {
  const wrap = document.getElementById("hero-slides");
  const dotsWrap = document.getElementById("hero-dots");
  if (!wrap || !slides.length) return;

  wrap.innerHTML = slides
    .map(
      (s, i) => `<figure class="hero__slide${i === 0 ? " is-active" : ""}" aria-roledescription="слайд" aria-label="${i + 1} из ${slides.length}"${i ? ' aria-hidden="true"' : ""}>
        <picture>
          ${s.mobile_image_url ? `<source media="(max-width: 767px)" srcset="${esc(safeImg(s.mobile_image_url))}">` : ""}
          <img src="${esc(safeImg(s.image_url))}" alt="${esc(s.alt)}" width="1600" height="900"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}>
        </picture>
      </figure>`,
    )
    .join("");

  if (slides.length < 2) return;
  dotsWrap.innerHTML = slides
    .map((_, i) => `<button class="hero__dot" type="button" aria-label="Слайд ${i + 1}"${i === 0 ? ' aria-current="true"' : ""}></button>`)
    .join("");

  const items = [...wrap.children];
  const dots = [...dotsWrap.children];
  let current = 0;
  let timer = null;
  let paused = false;

  const show = (index) => {
    current = (index + items.length) % items.length;
    items.forEach((el, i) => {
      el.classList.toggle("is-active", i === current);
      el.toggleAttribute("aria-hidden", i !== current);
    });
    dots.forEach((d, i) => (i === current ? d.setAttribute("aria-current", "true") : d.removeAttribute("aria-current")));
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };
  const start = () => {
    stop();
    if (!paused && !reducedMotion.matches && !document.hidden) timer = setInterval(() => show(current + 1), 6000);
  };

  dots.forEach((d, i) =>
    d.addEventListener("click", () => {
      show(i);
      start();
    }),
  );
  const hero = wrap.closest(".hero");
  const pause = (value) => {
    paused = value;
    start();
  };
  hero.addEventListener("mouseenter", () => pause(true));
  hero.addEventListener("mouseleave", () => pause(false));
  hero.addEventListener("focusin", () => pause(true));
  hero.addEventListener("focusout", (e) => !hero.contains(e.relatedTarget) && pause(false));
  document.addEventListener("visibilitychange", start);
  reducedMotion.addEventListener("change", start);
  start();
}

function renderReady(products) {
  const ready = products.filter((p) => p.showcase);
  const section = document.getElementById("ready");
  if (!ready.length) {
    section.hidden = true;
    return;
  }
  document.getElementById("ready-grid").innerHTML = ready.map((p) => productCard(p)).join("");
  section.hidden = false;
}

function renderCollections(categories, products, site) {
  const grid = document.getElementById("collections-grid");
  const counts = new Map();
  products.forEach((p) => counts.set(p.category, (counts.get(p.category) ?? 0) + 1));

  const cards = categories.map(
    (c) => `<a class="collection-card" href="${urls.shop({ category: c.id })}" data-reveal>
      <span class="collection-card__media"><img src="${esc(safeImg(c.image_url, "/assets/photos/category-composite.jpg"))}" alt="${esc(c.image_alt || c.name)}" width="800" height="600" loading="lazy"></span>
      <span class="collection-card__body">
        <h3 class="collection-card__title">${esc(c.name)}</h3>
        <span class="collection-card__text">${esc(c.description)}</span>
        <span class="collection-card__more">${counts.get(c.id) ? "Смотреть" : "Скоро"} ${icon("chevron-right")}</span>
      </span>
    </a>`,
  );

  if (products.some((p) => p.featured)) {
    cards.unshift(`<a class="collection-card collection-card--offers" href="${urls.shop({ offers: 1 })}" data-reveal>
      <span class="collection-card__media"><img src="${esc(safeImg(site.offers_image_url, "/assets/photos/offers.jpg"))}" alt="Предложения" width="800" height="600" loading="lazy"></span>
      <span class="collection-card__body">
        <h3 class="collection-card__title">Предложения</h3>
        <span class="collection-card__text">Букеты, которые студия предлагает сейчас</span>
        <span class="collection-card__more">Смотреть ${icon("chevron-right")}</span>
      </span>
    </a>`);
  }
  grid.innerHTML = cards.join("");
}

function mapSrc([lat, lng]) {
  return `https://yandex.ru/map-widget/v1/?ll=${lng}%2C${lat}&z=16&pt=${lng}%2C${lat}%2Cpm2rdm`;
}

function renderStudios(branches) {
  const list = document.getElementById("studios-list");
  const map = document.getElementById("studio-map");
  const link = document.getElementById("map-link");
  const loadBtn = document.getElementById("map-load");
  let active = branches.find((b) => b.coords) ?? branches[0];

  list.innerHTML = branches
    .map(
      (b) => `<li class="studio-card${b === active ? " is-active" : ""}" data-branch="${esc(b.id)}" data-reveal>
        <h3 class="studio-card__name">${esc(b.name)}</h3>
        <p class="studio-card__row">${icon("pin")}<span>${esc(b.address)}${b.details ? `<br><span class="muted">${esc(b.details)}</span>` : ""}</span></p>
        <p class="studio-card__row">${icon("clock")}<span>${esc(b.hours)}</span></p>
        ${b.phone ? `<p class="studio-card__row">${icon("phone")}<a href="tel:+${esc(b.phone.replace(/\D/g, ""))}">${esc(b.phone)}</a></p>` : ""}
        <div class="studio-card__actions">
          ${b.coords ? `<button class="btn btn--ghost btn--sm" type="button" data-show-map="${esc(b.id)}">Показать на карте</button>` : '<span class="hint">Координаты не указаны</span>'}
        </div>
      </li>`,
    )
    .join("");

  const select = (branch) => {
    active = branch;
    list.querySelectorAll(".studio-card").forEach((el) => el.classList.toggle("is-active", el.dataset.branch === branch.id));
    if (branch.map_url) link.href = branch.map_url;
    const frame = map.querySelector("iframe");
    if (frame && branch.coords) frame.src = mapSrc(branch.coords);
  };

  const load = () => {
    if (!active?.coords || map.querySelector("iframe")) return;
    const frame = document.createElement("iframe");
    frame.title = `Карта: ${active.name}`;
    frame.loading = "lazy";
    frame.referrerPolicy = "no-referrer-when-downgrade";
    frame.src = mapSrc(active.coords);
    map.prepend(frame);
    map.classList.add("is-loaded");
  };

  loadBtn.addEventListener("click", load);
  list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-show-map]");
    if (!btn) return;
    select(branches.find((b) => b.id === btn.dataset.showMap));
    load();
    map.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "nearest" });
  });
}

function renderDelivery(delivery) {
  const zoneRow = (z) => `<li><span>${esc(z.name)}</span><strong>${formatPrice(z.price)}</strong></li>`;
  document.getElementById("zone-list").innerHTML = delivery.zones.map(zoneRow).join("");
  document.getElementById("surprise-list").innerHTML = delivery.surprise_zones.map(zoneRow).join("");

  const min = Math.min(...delivery.zones.map((z) => z.price));
  document.getElementById("advantage-delivery").textContent = delivery.free_from
    ? `От ${formatPrice(min)}, бесплатно от ${formatPrice(delivery.free_from)}`
    : `От ${formatPrice(min)} — район выбирается при оформлении`;

  const span = (slots) => `${slots[0].start}–${slots.at(-1).label.split("–")[1]}`;
  document.getElementById("delivery-hours").textContent =
    `Доставка ${span(delivery.slots)}, самовывоз ${span(delivery.pickup_slots)} · время ${tzLabel(delivery.timezone)}.`;
}

async function init() {
  try {
    const [site, catalog, delivery, branches] = await Promise.all([
      api("/api/site"),
      api("/api/catalog"),
      api("/api/delivery"),
      api("/api/branches"),
    ]);
    initHero(site.hero_slides);
    renderReady(catalog.products);
    renderCollections(catalog.categories, catalog.products, site);
    renderStudios(branches.branches);
    renderDelivery(delivery);
    observeReveal();
  } catch (err) {
    console.error(err);
  }
}

init();
