// Чистые правила магазина. Ими пользуются и интерфейс, и мок-сервер в api.js;
// бэкенд этапа 2 повторяет их же (MOCKS.md), чтобы строки и проверки совпадали.

export const DOC_VERSIONS = { consent: "draft", privacy: "draft", offer: "draft" };

const NBSP = "\u00A0";

export function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatPrice(value) {
  const n = Math.round(Number(value) || 0);
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}₽`;
}

export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function zonedNow(timeZone, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  const a = Date.UTC(...fromIso.split("-").map((v, i) => (i === 1 ? v - 1 : +v)));
  const b = Date.UTC(...toIso.split("-").map((v, i) => (i === 1 ? v - 1 : +v)));
  return Math.round((b - a) / 86400000);
}

const ZONE_CITY = {
  "Europe/Moscow": "по Москве",
  "Asia/Yekaterinburg": "по Екатеринбургу",
};

export function tzLabel(timeZone) {
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const utc = offset.replace("GMT", "UTC") || "UTC";
  return `${ZONE_CITY[timeZone] ?? timeZone} (${utc})`;
}

export function slotStartMinutes(slot) {
  const [h, m] = slot.start.split(":").map(Number);
  return h * 60 + m;
}

export function slotOpen(slot, dateIso, delivery, at = new Date()) {
  const now = zonedNow(delivery.timezone, at);
  const diff = daysBetween(now.date, dateIso);
  if (diff < 0 || diff >= delivery.booking_days) return false;
  if (diff > 0) return true;
  return slotStartMinutes(slot) - now.minutes >= delivery.lead_minutes;
}

export function slotsFor(method, delivery) {
  return method === "pickup" ? delivery.pickup_slots : delivery.slots;
}

export function discountState(product, todayIso) {
  const off = { discount_active: false, sale_price: null, discount_label: "" };
  if (!product.discount_enabled || !(product.discount_value > 0)) return off;
  if (product.discount_start && todayIso < product.discount_start) return off;
  if (product.discount_end && todayIso > product.discount_end) return off;
  const value = Math.round(product.discount_value);
  const sale =
    product.discount_type === "fixed"
      ? product.price - value
      : Math.round((product.price * (100 - value)) / 100);
  if (sale <= 0 || sale >= product.price) return off;
  return {
    discount_active: true,
    sale_price: sale,
    discount_label: product.discount_type === "fixed" ? `−${formatPrice(value)}` : `−${value}%`,
  };
}

export function effectivePrice(product) {
  return product.discount_active && product.sale_price ? product.sale_price : product.price;
}

export function branchNames(ids, pickup) {
  return ids
    .map((id) => pickup.find((b) => b.id === id))
    .filter(Boolean)
    .map((b) => b.short);
}

export function availabilityLine(product, delivery) {
  const pickup = (delivery.pickup ?? []).filter((b) => !b.demo);
  const ids = (product.pickup_branches ?? []).filter((id) => pickup.some((b) => b.id === id));
  if (product.no_delivery) {
    const where = ids.map((id) => pickup.find((b) => b.id === id).address).join("; ");
    return where
      ? `Без доставки — только самовывоз из студии: ${where}`
      : "Без доставки. Сейчас нет в наличии в студиях";
  }
  const minZone = Math.min(...delivery.zones.map((z) => z.price));
  let line = `Доставка по городу от ${formatPrice(minZone)}`;
  if (delivery.free_from) line += `, бесплатно от ${formatPrice(delivery.free_from)}`;
  line += ". ";
  if (ids.length === 0) line += "Самовывоз недоступен";
  else if (ids.length === 1) line += `Самовывоз: ${pickup.find((b) => b.id === ids[0]).address}`;
  else if (ids.length === pickup.length) line += "Самовывоз из всех студий";
  else line += `Самовывоз только из студии ${branchNames(ids, pickup).join(", ")}`;
  return line;
}

export function cartRules(products, pickup) {
  const noDelivery = products.some((p) => p.no_delivery);
  const common = pickup
    .map((b) => b.id)
    .filter((id) => products.every((p) => (p.pickup_branches ?? []).includes(id)));
  return { noDelivery, commonPickup: common };
}

export function deliveryPrice(method, zoneId, itemsTotal, delivery) {
  if (method === "pickup") return 0;
  const list = method === "surprise" ? delivery.surprise_zones : delivery.zones;
  const zone = list.find((z) => z.id === zoneId);
  if (!zone) return null;
  if (method === "delivery" && delivery.free_from && itemsTotal >= delivery.free_from) return 0;
  return zone.price;
}

// Возвращает { поле: текст ошибки }; пустой объект — всё в порядке.
// ctx: { products: товары корзины (из каталога), delivery }
export function validateOrder(payload, ctx, at = new Date()) {
  const e = {};
  const { delivery } = ctx;
  if (digits(payload.phone).length < 10) e.phone = "Укажите телефон — не меньше 10 цифр";
  if (String(payload.name ?? "").trim().length < 2) e.name = "Укажите имя — хотя бы 2 буквы";
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) e.email = "Проверьте адрес почты";

  const method = payload.delivery_method;
  const rules = cartRules(ctx.products, delivery.pickup);
  if (!["delivery", "surprise", "pickup"].includes(method)) {
    e.delivery_method = "Выберите способ получения";
  } else if (method !== "pickup" && rules.noDelivery) {
    e.delivery_method = "В корзине есть товар только для самовывоза";
  }

  if (method === "delivery") {
    if (!delivery.zones.some((z) => z.id === payload.delivery_zone)) e.delivery_zone = "Выберите район доставки";
    if (String(payload.address ?? "").trim().length < 3) e.address = "Укажите адрес доставки";
    if (digits(payload.recipient_phone).length < 10) e.recipient_phone = "Телефон получателя — не меньше 10 цифр";
  }
  if (method === "surprise") {
    if (!delivery.surprise_zones.some((z) => z.id === payload.delivery_zone)) e.delivery_zone = "Выберите, куда везти сюрприз";
    if (digits(payload.recipient_phone).length < 10) e.recipient_phone = "Телефон получателя обязателен — не меньше 10 цифр";
  }
  if (method === "pickup") {
    if (!payload.pickup_branch) e.pickup_branch = "Выберите студию";
    else if (!rules.commonPickup.includes(payload.pickup_branch)) e.pickup_branch = "В этой студии есть не все товары корзины";
  }

  if (!payload.delivery_date) {
    e.delivery_date = "Выберите дату";
  } else {
    const slot = slotsFor(method, delivery).find((s) => s.label === payload.delivery_slot);
    if (!slot) e.delivery_slot = "Выберите время";
    else if (!slotOpen(slot, payload.delivery_date, delivery, at)) e.delivery_slot = "Это время уже недоступно — выберите другое";
  }

  if (payload.data_consent !== true) e.data_consent = "Нужно согласие на обработку персональных данных";
  if (payload.offer_accepted !== true) e.offer_accepted = "Нужно принять условия оферты";
  if (!Array.isArray(payload.items) || payload.items.length === 0) e.items = "Корзина пуста";
  return e;
}

const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}

// Вынимает код подтверждения из метатега, имени HTML-файла или самого кода.
export function extractVerification(raw, kind) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const meta = s.match(/content\s*=\s*["']([^"']+)["']/i);
  if (meta) return meta[1].trim();
  const file = kind === "yandex" ? s.match(/yandex_([a-z0-9]+)\.html/i) : s.match(/(google[a-z0-9]+)\.html/i);
  if (file) return file[1];
  return /^[A-Za-z0-9_-]{6,120}$/.test(s) ? s : "";
}
