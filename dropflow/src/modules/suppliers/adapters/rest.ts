import { z } from "zod";
import { rowsToProducts, type ColumnMapping } from "@/modules/catalog/mapping";
import { SupplierIntegrationError, type SupplierAdapter, type SupplierContext, type SupplierOrderResponse, type SupplierOrderState } from "./types";

/**
 * Adaptador REST CONFIGURÁVEL. Serve para fornecedores que publicam uma API
 * documentada (JSON). O administrador preenche, a partir da documentação
 * oficial do fornecedor, a URL, autenticação, caminhos e mapeamento de campos.
 * Nenhum endpoint é presumido: sem configuração, nada é chamado.
 *
 * Se o fornecedor exigir um formato muito específico (assinatura, SOAP etc.),
 * crie um adaptador dedicado implementando SupplierAdapter.
 */
const statusMap = z.record(z.string(), z.enum(["submitted", "confirmed", "preparing", "dispatched", "rejected", "cancelled"])).default({});

export const restConfigSchema = z.object({
  baseUrl: z.string().url("URL base inválida").refine((u) => u.startsWith("https://"), "Use HTTPS"),
  documentationUrl: z.string().url("Informe o link da documentação oficial do fornecedor"),
  auth: z.object({
    type: z.enum(["bearer", "header", "basic", "query", "none"]),
    headerName: z.string().optional(),
    queryParam: z.string().optional(),
  }),
  timeoutMs: z.number().int().min(1000).max(60000).default(15000),
  catalog: z
    .object({
      path: z.string().startsWith("/"),
      itemsPath: z.string().default(""),
      pageParam: z.string().optional(),
      pageSizeParam: z.string().optional(),
      pageSize: z.number().int().positive().default(100),
      nextCursorPath: z.string().optional(),
      fieldMap: z.record(z.string(), z.string()),
      weightUnit: z.enum(["kg", "g"]).default("kg"),
    })
    .optional(),
  stock: z
    .object({
      path: z.string().startsWith("/"), // pode conter {skus}
      itemsPath: z.string().default(""),
      skuField: z.string(),
      quantityField: z.string(),
    })
    .optional(),
  orders: z
    .object({
      createPath: z.string().startsWith("/"),
      idempotencyHeader: z.string().default("Idempotency-Key"),
      responseIdPath: z.string(),
      responseStatusPath: z.string().optional(),
      statusPath: z.string().startsWith("/").optional(), // ex.: /orders/{id}
      statusField: z.string().optional(),
      statusMap,
    })
    .optional(),
});

export type RestConfig = z.infer<typeof restConfigSchema>;

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

function flattenObject(obj: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flattenObject(v as Record<string, unknown>, key, out);
    else out[key] = Array.isArray(v) && v.every((x) => typeof x !== "object") ? v.join("|") : v;
  }
  return out;
}

function parseConfig(ctx: SupplierContext): RestConfig {
  const parsed = restConfigSchema.safeParse(ctx.config);
  if (!parsed.success) {
    throw new SupplierIntegrationError(`Integração REST não configurada corretamente: ${parsed.error.issues.map((i) => i.message).join("; ")}`, false);
  }
  return parsed.data;
}

async function call(ctx: SupplierContext, cfg: RestConfig, method: string, pathAndQuery: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const url = new URL(pathAndQuery, cfg.baseUrl);
  const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };
  const secret = ctx.secrets.token ?? "";
  switch (cfg.auth.type) {
    case "bearer": headers.Authorization = `Bearer ${secret}`; break;
    case "header": headers[cfg.auth.headerName || "X-Api-Key"] = secret; break;
    case "basic": headers.Authorization = `Basic ${Buffer.from(`${ctx.secrets.username ?? ""}:${ctx.secrets.password ?? ""}`).toString("base64")}`; break;
    case "query": url.searchParams.set(cfg.auth.queryParam || "api_key", secret); break;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(cfg.timeoutMs) });
  } catch (e) {
    throw new SupplierIntegrationError(`Fornecedor inacessível: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new SupplierIntegrationError(`Fornecedor respondeu HTTP ${res.status}: ${text.slice(0, 300)}`, res.status >= 500 || res.status === 429);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new SupplierIntegrationError("Resposta do fornecedor não é JSON válido", false);
  }
}

function mapStatus(cfg: RestConfig, raw: unknown): SupplierOrderState {
  const key = raw === undefined || raw === null ? "" : String(raw);
  return (cfg.orders?.statusMap[key] as SupplierOrderState | undefined) ?? "submitted";
}

export const restAdapter: SupplierAdapter = {
  type: "rest",
  label: "API do fornecedor (REST/JSON documentada)",
  description:
    "Conexão com a API oficial do fornecedor, configurada a partir da documentação que ele disponibiliza (URL, autenticação, caminhos e campos).",
  capabilities: { catalog: true, stock: true, submitOrder: true, orderStatus: true },

  async testConnection(ctx) {
    const cfg = parseConfig(ctx);
    if (!cfg.catalog) return { ok: false, message: "Configure ao menos o endpoint de catálogo para testar a conexão." };
    const page = await this.fetchCatalog!(ctx, null);
    return { ok: true, message: `Conexão OK: ${page.products.length} produto(s) lidos na primeira página.` };
  },

  async fetchCatalog(ctx, cursor) {
    const cfg = parseConfig(ctx);
    if (!cfg.catalog) throw new SupplierIntegrationError("Endpoint de catálogo não configurado", false);
    const c = cfg.catalog;
    const url = new URL(c.path, cfg.baseUrl);
    if (c.pageParam) url.searchParams.set(c.pageParam, cursor ?? "1");
    if (c.pageSizeParam) url.searchParams.set(c.pageSizeParam, String(c.pageSize));
    const data = await call(ctx, cfg, "GET", url.pathname + url.search);
    const items = getPath(data, c.itemsPath);
    if (!Array.isArray(items)) throw new SupplierIntegrationError(`Caminho de itens "${c.itemsPath}" não retornou uma lista`, false);
    const rows = items.map((i) => flattenObject(i as Record<string, unknown>));
    const parsed = rowsToProducts(rows, { mapping: c.fieldMap as ColumnMapping, weightUnit: c.weightUnit });
    let nextCursor: string | null = null;
    if (c.nextCursorPath) {
      const n = getPath(data, c.nextCursorPath);
      nextCursor = n ? String(n) : null;
    } else if (c.pageParam && items.length >= c.pageSize) {
      nextCursor = String(Number(cursor ?? "1") + 1);
    }
    return { products: parsed.products, nextCursor, errors: parsed.errors.map((e) => ({ sku: e.sku, message: e.message })) };
  },

  async fetchStock(ctx, skus) {
    const cfg = parseConfig(ctx);
    if (!cfg.stock) throw new SupplierIntegrationError("Endpoint de estoque não configurado", false);
    const path = cfg.stock.path.replace("{skus}", encodeURIComponent(skus.join(",")));
    const data = await call(ctx, cfg, "GET", path);
    const items = getPath(data, cfg.stock.itemsPath);
    if (!Array.isArray(items)) throw new SupplierIntegrationError("Resposta de estoque inesperada", false);
    const out: Record<string, number> = {};
    for (const it of items) {
      const sku = getPath(it, cfg.stock.skuField);
      const qty = Number(getPath(it, cfg.stock.quantityField));
      if (sku !== undefined && Number.isFinite(qty)) out[String(sku)] = Math.max(0, Math.floor(qty));
    }
    return out;
  },

  async submitOrder(ctx, order): Promise<SupplierOrderResponse> {
    const cfg = parseConfig(ctx);
    if (!cfg.orders) throw new SupplierIntegrationError("Endpoint de pedidos não configurado", false);
    const body = {
      external_id: order.idempotencyKey,
      reference: order.orderCode,
      marketplace_order_id: order.marketplaceOrderId,
      items: order.items.map((i) => ({ sku: i.supplierSku, quantity: i.quantity })),
      logistics: order.logistics,
      delivery: order.delivery ?? undefined,
    };
    const data = await call(ctx, cfg, "POST", cfg.orders.createPath, body, { [cfg.orders.idempotencyHeader]: order.idempotencyKey });
    const ref = getPath(data, cfg.orders.responseIdPath);
    if (!ref) throw new SupplierIntegrationError("Fornecedor não retornou o número do pedido", false);
    const st = cfg.orders.responseStatusPath ? getPath(data, cfg.orders.responseStatusPath) : undefined;
    return { status: mapStatus(cfg, st), externalReference: String(ref) };
  },

  async getOrderStatus(ctx, externalReference) {
    const cfg = parseConfig(ctx);
    if (!cfg.orders?.statusPath || !cfg.orders.statusField) throw new SupplierIntegrationError("Consulta de status não configurada", false);
    const data = await call(ctx, cfg, "GET", cfg.orders.statusPath.replace("{id}", encodeURIComponent(externalReference)));
    return { status: mapStatus(cfg, getPath(data, cfg.orders.statusField)), externalReference };
  },
};
