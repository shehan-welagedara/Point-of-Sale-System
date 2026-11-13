/**
 * Industry models: one Polymath platform, set up for each kind of business.
 *
 * Every business runs the same system (one codebase, one release, managed in the Polymath Console).
 * Its industry model decides what it starts with and how it reads: the modules switched on, the
 * way the POS sells (tables, counter, retail scanning, appointments), the words on screens (check,
 * bill, sale, order, ticket; menu, catalogue, services; guests, customers, clients) and the demo
 * data. The licence still decides what a business may use.
 */
import type { ModuleKey } from "./modules.js";

export type IndustryKey = "restaurant" | "cafe" | "bar" | "bakery" | "hotel" | "retail" | "fashion" | "wholesale" | "salon" | "tattoo" | "services";

/** How the POS sells: dine-in with tables, counter/takeaway, retail scanning, or appointments. */
export type PosMode = "table" | "quick" | "retail" | "appointments" | "none";

export interface IndustryTerms {
  /** One sale on the POS: Check, Bill, Sale, Order, Ticket. */
  check: string;
  checks: string;
  /** What is sold: Menu item, Product, Style, Service. */
  item: string;
  items: string;
  /** The list of what is sold: Menu, Catalogue, Services. */
  menu: string;
  /** People served: Guests, Customers, Clients, Buyers. */
  customer: string;
  customers: string;
  /** Covers / guests per sale, or null where it doesn't apply. */
  covers: string | null;
}

export interface IndustryModel {
  key: IndustryKey;
  name: string;
  group: "Food & drink" | "Retail & trade" | "Beauty & services" | "Hospitality";
  icon: string;
  description: string;
  posMode: PosMode;
  /** Switched on when a business starts with this model (within its licence). */
  modules: ModuleKey[];
  terms: IndustryTerms;
  /** Demo business to explore the model (sample-data). */
  sample?: string;
  /** available: ready; preview: core works, its own screens (appointments…) are on the roadmap; edition: a separate product. */
  status: "available" | "preview" | "edition";
}

const FOOD: IndustryTerms = { check: "Check", checks: "Checks", item: "Menu item", items: "Menu items", menu: "Menu", customer: "Guest", customers: "Guests", covers: "Covers" };
const SHOP: IndustryTerms = { check: "Sale", checks: "Sales", item: "Product", items: "Products", menu: "Catalogue", customer: "Customer", customers: "Customers", covers: null };
const SERVICE: IndustryTerms = { check: "Ticket", checks: "Tickets", item: "Service", items: "Services", menu: "Services", customer: "Client", customers: "Clients", covers: null };

export const INDUSTRY_MODELS: readonly IndustryModel[] = [
  { key: "restaurant", name: "Restaurant", group: "Food & drink", icon: "🍽", description: "Dine-in with tables and covers, takeaway and delivery, kitchen tickets, recipes and food cost.", posMode: "table", modules: ["pos", "tables", "recipes", "inventory", "purchasing", "crm", "revenue", "lankaqr"], terms: FOOD, sample: "noura-kitchen", status: "available" },
  { key: "cafe", name: "Café & coffee shop", group: "Food & drink", icon: "☕", description: "Fast counter service with names on orders, loyalty points, recipes and stock.", posMode: "quick", modules: ["pos", "recipes", "inventory", "crm", "loyalty", "revenue", "lankaqr"], terms: { ...FOOD, check: "Order", checks: "Orders", customer: "Customer", customers: "Customers", covers: null }, status: "available" },
  { key: "bar", name: "Bar & pub", group: "Food & drink", icon: "🍸", description: "Tabs by name or table, bar tickets, pour costs and stock.", posMode: "table", modules: ["pos", "tables", "recipes", "inventory", "purchasing", "crm", "revenue"], terms: { ...FOOD, check: "Tab", checks: "Tabs" }, status: "available" },
  { key: "bakery", name: "Bakery & pastry", group: "Food & drink", icon: "🥐", description: "Counter sales, daily production of batches, wastage and recipes.", posMode: "quick", modules: ["pos", "recipes", "inventory", "purchasing", "crm", "revenue"], terms: { ...FOOD, check: "Sale", checks: "Sales", customer: "Customer", customers: "Customers", covers: null }, status: "available" },
  { key: "hotel", name: "Hotel & resort", group: "Hospitality", icon: "🏨", description: "Rooms, guests and outlets: the Enterprise Hotel Edition (property management with POS, ERP and accounting).", posMode: "table", modules: ["pos", "tables", "recipes", "inventory", "purchasing", "accounting", "crm", "revenue"], terms: FOOD, status: "edition" },
  { key: "retail", name: "Retail shop", group: "Retail & trade", icon: "🛍", description: "Scan and sell at the counter, products with barcodes, stock, suppliers and loyalty.", posMode: "retail", modules: ["pos", "inventory", "purchasing", "crm", "loyalty", "revenue", "lankaqr"], terms: SHOP, status: "available" },
  { key: "fashion", name: "Clothing & apparel", group: "Retail & trade", icon: "👕", description: "Styles in sizes and colours, barcodes, returns and exchanges, stock by variant.", posMode: "retail", modules: ["pos", "wholesale", "inventory", "purchasing", "crm", "loyalty", "revenue"], terms: { ...SHOP, item: "Style", items: "Styles" }, status: "available" },
  { key: "wholesale", name: "Wholesale & distribution", group: "Retail & trade", icon: "📦", description: "Sell to shops and resellers: styles with sizes and colours, quantity and customer prices, quotations, orders, deliveries with COD, credit and cheques, WhatsApp ordering.", posMode: "none", modules: ["wholesale", "whatsappCommerce", "inventory", "purchasing", "accounting", "crm", "revenue"], terms: { ...SHOP, check: "Order", checks: "Orders", item: "Style", items: "Styles", customer: "Customer", customers: "Customers" }, sample: "colombo-tees", status: "available" },
  { key: "salon", name: "Salon & spa", group: "Beauty & services", icon: "💇", description: "Services and products, staff and commissions, client history; appointments on the roadmap.", posMode: "appointments", modules: ["pos", "inventory", "crm", "loyalty", "revenue", "lankaqr"], terms: SERVICE, status: "preview" },
  { key: "tattoo", name: "Tattoo & piercing studio", group: "Beauty & services", icon: "🖋", description: "Services with deposits, artist commissions and client history; consent forms and bookings on the roadmap.", posMode: "appointments", modules: ["pos", "crm", "revenue", "lankaqr"], terms: SERVICE, status: "preview" },
  { key: "services", name: "Other services", group: "Beauty & services", icon: "🧰", description: "Sell services and products with tickets, customers and books.", posMode: "quick", modules: ["pos", "crm", "accounting", "revenue"], terms: SERVICE, status: "preview" },
];

export function industryModel(key: string | undefined): IndustryModel {
  return INDUSTRY_MODELS.find((m) => m.key === key) ?? INDUSTRY_MODELS[0]!;
}

/** The words a business's screens use (restaurant words when it has no model yet). */
export function industryTerms(key: string | undefined): IndustryTerms {
  return industryModel(key).terms;
}
