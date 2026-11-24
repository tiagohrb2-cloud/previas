import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/modules/auth/session";
import { can } from "@/modules/auth/permissions";
import { queryOne } from "@/lib/db";
import { audit } from "@/lib/audit";
import { mlRaw } from "@/modules/marketplace/mercadolivre/client";

export const dynamic = "force-dynamic";

/** Baixa a etiqueta OFICIAL do Mercado Livre para repassar ao fornecedor. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ shipmentId: string }> }) {
  const user = await currentUser();
  if (!user || !can(user.role, "orders.operate")) return NextResponse.json({ error: "sem permissão" }, { status: 403 });
  const { shipmentId } = await params;
  if (!/^\d{5,20}$/.test(shipmentId)) return NextResponse.json({ error: "envio inválido" }, { status: 400 });
  const order = await queryOne<{ id: string; account_id: string | null }>(
    "select id, account_id from orders where marketplace = 'mercadolivre' and external_shipment_id = $1", [shipmentId]);
  if (!order?.account_id) return NextResponse.json({ error: "envio não encontrado" }, { status: 404 });
  const res = await mlRaw(order.account_id, `/shipment_labels?shipment_ids=${shipmentId}&response_type=pdf`);
  if (!res.ok) return NextResponse.json({ error: `Mercado Livre respondeu ${res.status}. A etiqueta só fica disponível quando o envio está pronto para despacho.` }, { status: 502 });
  await audit({ userId: user.id, action: "shipment.label_download", entityType: "order", entityId: order.id });
  return new NextResponse(res.body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="etiqueta-${shipmentId}.pdf"`, "Cache-Control": "no-store" } });
}
