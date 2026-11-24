import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool, queryOne } from "@/lib/db";
import { resetDatabase } from "./helpers/db";
import { ingestNotification } from "@/modules/notifications/intake";
import { restAdapter } from "@/modules/suppliers/adapters/rest";
import { createSupplier, saveIntegration, getSupplier } from "@/modules/suppliers/service";
import { decrypt } from "@/lib/crypto";
import { POST as webhook } from "@/app/api/webhooks/mercadolivre/route";
import { NextRequest } from "next/server";

beforeAll(resetDatabase);
afterAll(closePool);
afterEach(() => vi.unstubAllGlobals());

describe("webhook do Mercado Livre", () => {
  const req = (key: string, body: unknown) => new NextRequest(`http://localhost/api/webhooks/mercadolivre?key=${key}`, { method: "POST", body: JSON.stringify(body) });

  it("recusa chave inválida", async () => {
    const r = await webhook(req("errada", {}));
    expect(r.status).toBe(401);
  });

  it("ignora notificação de conta não conectada e de outro aplicativo", async () => {
    const r = await webhook(req("test-webhook-key", { _id: "n1", resource: "/orders/1", user_id: 123, topic: "orders_v2", application_id: "test-client-id" }));
    expect(await r.json()).toMatchObject({ ok: true, status: "ignored" });
    expect((await ingestNotification({ _id: "n2", resource: "/orders/1", user_id: 123, topic: "orders_v2", application_id: "OUTRO" })).status).toBe("ignored");
  });

  it("enfileira pedido de conta conectada, sem duplicar", async () => {
    await queryOne("insert into ml_accounts(ml_user_id, access_token_enc, token_expires_at) values (555, 'x', now() + interval '1 hour')");
    const n = { _id: "n3", resource: "/orders/2000009", user_id: 555, topic: "orders_v2", application_id: "test-client-id" };
    expect((await ingestNotification(n)).status).toBe("queued");
    expect((await ingestNotification(n)).status).toBe("duplicate");
    const job = await queryOne<{ type: string; payload: { externalOrderId: string } }>("select type, payload from jobs where type='order.sync'");
    expect(job).toMatchObject({ type: "order.sync", payload: { externalOrderId: "2000009" } });
  });
});

describe("adaptador REST de fornecedor", () => {
  const ctx = {
    supplierId: "s", supplierName: "Forn", mode: "production" as const, secrets: { token: "segredo" },
    config: {
      baseUrl: "https://api.fornecedor.test", documentationUrl: "https://docs.fornecedor.test", auth: { type: "bearer" },
      catalog: { path: "/produtos", itemsPath: "data", pageParam: "page", pageSize: 2, fieldMap: { sku: "codigo", title: "nome", cost: "preco.custo", stock: "saldo", images: "fotos" } },
      orders: { createPath: "/pedidos", responseIdPath: "pedido.numero", responseStatusPath: "pedido.situacao", statusMap: { RECEBIDO: "confirmed" } },
    },
  };

  it("lê catálogo paginado com mapeamento de campos e autenticação", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init.headers).get("authorization") });
      return new Response(JSON.stringify({ data: [
        { codigo: "A1", nome: "Produto A", preco: { custo: "10,50" }, saldo: 3, fotos: ["https://img/a.jpg"] },
        { codigo: "A2", nome: "Produto B", preco: { custo: 7 }, saldo: 0 },
      ] }), { status: 200 });
    });
    const page = await restAdapter.fetchCatalog!(ctx, null);
    expect(page.products.map((p) => [p.supplierSku, p.costCents, p.stock])).toEqual([["A1", 1050, 3], ["A2", 700, 0]]);
    expect(page.nextCursor).toBe("2");
    expect(calls[0].url).toBe("https://api.fornecedor.test/produtos?page=1");
    expect(calls[0].auth).toBe("Bearer segredo");
  });

  it("envia pedido com chave de idempotência e mapeia status", async () => {
    let headers: Headers | null = null;
    vi.stubGlobal("fetch", async (_url: URL, init: RequestInit) => {
      headers = new Headers(init.headers);
      return new Response(JSON.stringify({ pedido: { numero: 991, situacao: "RECEBIDO" } }), { status: 201 });
    });
    const r = await restAdapter.submitOrder!(ctx, { idempotencyKey: "DF-1-abc", orderCode: "DF-1", marketplaceOrderId: "1", items: [], logistics: { marketplace: "mercadolivre", labelInstructions: "" } });
    expect(r).toEqual({ status: "confirmed", externalReference: "991" });
    expect(headers!.get("idempotency-key")).toBe("DF-1-abc");
  });

  it("recusa configuração sem HTTPS ou sem documentação", async () => {
    await expect(restAdapter.fetchCatalog!({ ...ctx, config: { ...ctx.config, baseUrl: "http://inseguro" } }, null)).rejects.toThrow(/HTTPS/);
    await expect(restAdapter.fetchCatalog!({ ...ctx, config: { ...ctx.config, documentationUrl: undefined } }, null)).rejects.toThrow(/documentação/);
  });

  it("guarda o segredo do fornecedor criptografado", async () => {
    const id = await createSupplier({ name: "API Real" }, null);
    await saveIntegration(id, "rest", ctx.config, { token: "token-super-secreto" }, null);
    const s = (await getSupplier(id))!;
    expect(s.integration_secret_enc).not.toContain("token-super-secreto");
    expect(JSON.parse(decrypt(s.integration_secret_enc!)).token).toBe("token-super-secreto");
    expect(JSON.stringify(s.integration_config)).not.toContain("token-super-secreto");
  });
});
