// Единственная точка доступа к данным. На этапе 2 меняется только MOCK = false:
// тогда api() ходит на настоящий /api/* того же сайта. Больше нигде fetch не вызывается.
import {
  DOC_VERSIONS,
  deliveryPrice,
  discountState,
  effectivePrice,
  validateOrder,
  zonedNow,
} from "./rules.js?v=1";

export const MOCK = true;

export class ApiError extends Error {
  constructor(status, message, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export async function api(path, options = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = { ...(options.headers ?? {}) };
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== "string") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  if (MOCK) return mockRequest(method, path, headers, options.body);

  const res = await fetch(path, { method, headers, body, credentials: "same-origin" });
  const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Не получилось выполнить запрос", data?.fields ?? {});
  return data;
}

/* ---------- Мок-сервер: каталог в памяти. Заказ не пишется в файл и не отдаётся списком. ---------- */

const MOCK_FILES = ["catalog", "delivery", "branches", "site"];
let store = null;
let orderSeq = 1000;

const clone = (v) => structuredClone(v);
const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

async function load() {
  if (store) return store;
  const entries = await Promise.all(
    MOCK_FILES.map(async (name) => {
      const res = await fetch(new URL(`../mock/${name}.json`, import.meta.url));
      return [name, await res.json()];
    }),
  );
  store = Object.fromEntries(entries);
  return store;
}

function today() {
  return zonedNow(store.delivery.timezone).date;
}

function withDiscount(p) {
  return { ...p, ...discountState(p, today()) };
}

function publicCatalog() {
  const categories = [...store.catalog.categories].sort((a, b) => a.position - b.position);
  const products = store.catalog.products.filter((p) => !p.hidden).map(withDiscount);
  return clone({ categories, products });
}

async function mockRequest(method, rawPath, headers, body) {
  await load();
  await delay();
  const url = new URL(rawPath, location.origin);
  const path = url.pathname;
  const key = `${method} ${path}`;

  if (key === "GET /api/catalog") return publicCatalog();
  if (key === "GET /api/delivery") return clone(store.delivery);
  if (key === "GET /api/branches") return clone(store.branches);
  if (key === "GET /api/site") return clone(store.site);
  if (key === "POST /api/orders") return createOrder(body);

  throw new ApiError(404, "Не найдено");
}

function createOrder(body) {
  const payload = body ?? {};
  const catalog = publicCatalog();
  const lines = (payload.items ?? []).map((it) => ({ item: it, product: catalog.products.find((p) => p.id === it.product_id) }));
  if (lines.some((l) => !l.product || !(Number.isInteger(l.item.quantity) && l.item.quantity > 0 && l.item.quantity <= 50))) {
    throw new ApiError(400, "Состав корзины изменился — обновите страницу");
  }
  const products = lines.map((l) => l.product);
  const fields = validateOrder(payload, { products, delivery: store.delivery });
  if (Object.keys(fields).length) throw new ApiError(400, "Проверьте поля формы", fields);

  const items = lines.map(({ item, product }) => ({
    product_id: product.id,
    title: product.title,
    price: effectivePrice(product),
    quantity: item.quantity,
    image_thumb_url: product.image_thumb_url,
  }));
  const itemsTotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
  const method = payload.delivery_method;
  const dPrice = deliveryPrice(method, payload.delivery_zone, itemsTotal, store.delivery) ?? 0;
  const zones = method === "surprise" ? store.delivery.surprise_zones : store.delivery.zones;
  const branch = store.delivery.pickup.find((b) => b.id === payload.pickup_branch);
  const now = new Date().toISOString();
  const orderId = `T-${++orderSeq}`;
  const order = {
    id: orderId,
    created_at: now,
    payment_status: "pending",
    name: payload.name.trim(),
    phone: payload.phone,
    email: payload.email ?? "",
    delivery_method: method,
    delivery_zone: method === "pickup" ? "" : payload.delivery_zone,
    delivery_zone_name: method === "pickup" ? "" : zones.find((z) => z.id === payload.delivery_zone)?.name ?? "",
    delivery_price: dPrice,
    address: method === "pickup" ? "" : payload.address ?? "",
    self_recipient: method === "delivery" && payload.recipient_phone === payload.phone,
    recipient_phone: method === "pickup" ? "" : payload.recipient_phone,
    pickup_branch: method === "pickup" ? branch.id : "",
    pickup_branch_name: method === "pickup" ? branch.name : "",
    delivery_date: payload.delivery_date,
    delivery_slot: payload.delivery_slot,
    comment: payload.comment ?? "",
    items,
    items_total: itemsTotal,
    total: itemsTotal + dPrice,
    data_consent: true,
    data_consent_at: now,
    offer_accepted: true,
    offer_accepted_at: now,
    consent_version: payload.consent_version ?? DOC_VERSIONS.consent,
    privacy_version: payload.privacy_version ?? DOC_VERSIONS.privacy,
    offer_version: payload.offer_version ?? DOC_VERSIONS.offer,
    archived: false,
  };
  return { success: true, order_id: order.id };
}
