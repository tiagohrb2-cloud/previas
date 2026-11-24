import { z } from "zod";
import { query, queryOne, type Queryable } from "@/lib/db";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { getMode } from "@/lib/settings";
import { getAdapter } from "./adapters/registry";
import { restConfigSchema } from "./adapters/rest";
import type { IntegrationType, SupplierContext } from "./adapters/types";

export interface SupplierRow {
  id: string;
  name: string;
  legal_name: string | null;
  cnpj: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: Record<string, string>;
  avg_dispatch_days: number;
  confirmation_timeout_hours: number;
  integration_type: IntegrationType;
  integration_config: Record<string, unknown>;
  integration_secret_enc: string | null;
  integration_status: "not_configured" | "configured" | "verified" | "error" | "disabled";
  integration_verified_at: string | null;
  integration_last_error: string | null;
  logistics_verified_at: string | null;
  order_channel_notes: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
}

/** Valida CNPJ pelos dígitos verificadores. */
export function isValidCnpj(value: string): boolean {
  const c = value.replace(/\D/g, "");
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((s, w, i) => s + Number(c[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

const optionalText = z.string().trim().optional().transform((v) => (v ? v : null));

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do fornecedor"),
  legal_name: optionalText,
  cnpj: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.replace(/\D/g, "") : null))
    .refine((v) => v === null || isValidCnpj(v), "CNPJ inválido"),
  contact_name: optionalText,
  email: z.string().trim().optional().transform((v) => (v ? v.toLowerCase() : null)).refine((v) => v === null || z.email().safeParse(v).success, "E-mail inválido"),
  phone: optionalText,
  address: z.object({
    street: z.string().optional(), number: z.string().optional(), district: z.string().optional(),
    city: z.string().optional(), state: z.string().optional(), zip: z.string().optional(),
  }).default({}),
  avg_dispatch_days: z.coerce.number().int().min(0).max(60).default(2),
  confirmation_timeout_hours: z.coerce.number().int().min(1).max(240).default(24),
  order_channel_notes: optionalText,
  notes: optionalText,
  active: z.boolean().default(true),
});

export type SupplierInput = z.input<typeof supplierSchema>;

export async function createSupplier(input: SupplierInput, userId: string | null) {
  const d = supplierSchema.parse(input);
  const row = await queryOne<{ id: string }>(
    `insert into suppliers(name, legal_name, cnpj, contact_name, email, phone, address, avg_dispatch_days,
       confirmation_timeout_hours, order_channel_notes, notes, active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [d.name, d.legal_name, d.cnpj, d.contact_name, d.email, d.phone, JSON.stringify(d.address), d.avg_dispatch_days,
     d.confirmation_timeout_hours, d.order_channel_notes, d.notes, d.active],
  );
  await audit({ userId, action: "supplier.create", entityType: "supplier", entityId: row!.id, details: { name: d.name } });
  return row!.id;
}

export async function updateSupplier(id: string, input: SupplierInput, userId: string | null) {
  const d = supplierSchema.parse(input);
  await query(
    `update suppliers set name=$2, legal_name=$3, cnpj=$4, contact_name=$5, email=$6, phone=$7, address=$8,
       avg_dispatch_days=$9, confirmation_timeout_hours=$10, order_channel_notes=$11, notes=$12, active=$13
     where id=$1`,
    [id, d.name, d.legal_name, d.cnpj, d.contact_name, d.email, d.phone, JSON.stringify(d.address), d.avg_dispatch_days,
     d.confirmation_timeout_hours, d.order_channel_notes, d.notes, d.active],
  );
  await audit({ userId, action: "supplier.update", entityType: "supplier", entityId: id });
}

export async function getSupplier(id: string, client?: Queryable): Promise<SupplierRow | null> {
  return queryOne<SupplierRow>("select * from suppliers where id = $1", [id], client);
}

export interface SupplierListRow extends SupplierRow {
  products_count: number;
  orders_count: number;
  fulfilled_count: number;
  fulfillment_rate: number | null;
}

export async function listSuppliers(): Promise<SupplierListRow[]> {
  const rows = await query<SupplierListRow>(
    `select s.*,
       (select count(*) from products p where p.supplier_id = s.id)::int as products_count,
       (select count(*) from supplier_orders so where so.supplier_id = s.id and so.status not in ('pending','awaiting_approval'))::int as orders_count,
       (select count(*) from supplier_orders so where so.supplier_id = s.id and so.status in ('confirmed','preparing','dispatched'))::int as fulfilled_count
     from suppliers s order by s.active desc, s.name`,
  );
  return rows.map((r) => ({ ...r, fulfillment_rate: r.orders_count ? (r.fulfilled_count / r.orders_count) * 100 : null }));
}

export async function supplierContext(s: SupplierRow, client?: Queryable): Promise<SupplierContext> {
  return {
    supplierId: s.id,
    supplierName: s.name,
    config: s.integration_config ?? {},
    secrets: decryptJson<Record<string, string>>(s.integration_secret_enc) ?? {},
    mode: await getMode(client),
  };
}

/** Salva o método de integração. Segredos são criptografados; campos vazios mantêm o segredo atual. */
export async function saveIntegration(
  id: string,
  type: IntegrationType,
  config: Record<string, unknown>,
  secrets: Record<string, string>,
  userId: string | null,
) {
  const current = await getSupplier(id);
  if (!current) throw new Error("Fornecedor não encontrado");
  if (type === "simulated" && (await getMode()) !== "test") throw new Error("Fornecedor simulado só pode ser usado no modo teste.");
  let cfg: Record<string, unknown> = {};
  if (type === "rest") cfg = restConfigSchema.parse(config) as Record<string, unknown>;
  const existing = decryptJson<Record<string, string>>(current.integration_secret_enc) ?? {};
  const merged = { ...existing };
  for (const [k, v] of Object.entries(secrets)) if (v) merged[k] = v;
  const status = type === "manual" || type === "file" ? "configured" : "configured";
  await query(
    `update suppliers set integration_type=$2, integration_config=$3, integration_secret_enc=$4,
       integration_status=$5, integration_verified_at=null, integration_last_error=null
     where id=$1`,
    [id, type, JSON.stringify(cfg), Object.keys(merged).length ? encryptJson(merged) : null, status],
  );
  await audit({ userId, action: "supplier.integration_save", entityType: "supplier", entityId: id, details: { type, secretKeys: Object.keys(merged) } });
}

/** Testa a integração com uma chamada real (ou simulada no modo teste). */
export async function testIntegration(id: string, userId: string | null) {
  const s = await getSupplier(id);
  if (!s) throw new Error("Fornecedor não encontrado");
  const adapter = getAdapter(s.integration_type);
  if (!adapter.testConnection) {
    return { ok: true, message: "Este método de integração não possui teste automático (fluxo manual/arquivo)." };
  }
  try {
    const r = await adapter.testConnection(await supplierContext(s));
    await query(
      `update suppliers set integration_status=$2, integration_verified_at = case when $3 then now() else null end, integration_last_error=$4 where id=$1`,
      [id, r.ok ? "verified" : "error", r.ok, r.ok ? null : r.message],
    );
    await audit({ userId, action: "supplier.integration_test", entityType: "supplier", entityId: id, details: { ok: r.ok } });
    return r;
  } catch (e) {
    const message = (e as Error).message;
    await query("update suppliers set integration_status='error', integration_last_error=$2 where id=$1", [id, message]);
    return { ok: false, message };
  }
}

/** O administrador declara que o fluxo logístico (etiqueta ML, coleta/postagem) foi comprovado com este fornecedor. */
export async function setLogisticsVerified(id: string, verified: boolean, userId: string | null) {
  await query("update suppliers set logistics_verified_at = case when $2 then now() else null end where id=$1", [id, verified]);
  await audit({ userId, action: verified ? "supplier.logistics_verified" : "supplier.logistics_unverified", entityType: "supplier", entityId: id });
}

/** Encaminhamento automático só é permitido para fornecedor com integração e logística comprovadas. */
export function canAutoForward(s: Pick<SupplierRow, "integration_type" | "integration_status" | "logistics_verified_at" | "active">, mode: "test" | "production") {
  if (!s.active) return { ok: false, reason: "Fornecedor inativo" };
  if (s.integration_type === "simulated") return mode === "test" ? { ok: true } : { ok: false, reason: "Fornecedor simulado no modo produção" };
  if (!getAdapter(s.integration_type).capabilities.submitOrder || s.integration_type !== "rest") {
    return { ok: false, reason: "Fornecedor sem API de pedidos: encaminhamento manual" };
  }
  if (s.integration_status !== "verified") return { ok: false, reason: "Integração do fornecedor não verificada" };
  if (!s.logistics_verified_at) return { ok: false, reason: "Fluxo logístico ainda não comprovado" };
  return { ok: true };
}
