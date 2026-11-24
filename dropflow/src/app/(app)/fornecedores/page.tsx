import Link from "next/link";
import type { Metadata } from "next";
import { Card, PageHeader, Table, Td, Th, Badge, EmptyState, LinkButton } from "@/components/ui";
import { IntegrationBadge } from "@/components/status";
import { requireUser } from "@/modules/auth/session";
import { listSuppliers } from "@/modules/suppliers/service";
import { getAdapter } from "@/modules/suppliers/adapters/registry";
import { formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Fornecedores" };

export default async function SuppliersPage() {
  await requireUser("suppliers.view");
  const suppliers = await listSuppliers();
  return (
    <>
      <PageHeader title="Fornecedores" description="Fornecedores nacionais, método de integração e desempenho de atendimento." actions={<LinkButton href="/fornecedores/novo">Novo fornecedor</LinkButton>} />
      {suppliers.length ? (
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Fornecedor</Th><Th>Integração</Th><Th>Status</Th><Th className="text-right">Produtos</Th><Th className="text-right">Pedidos</Th><Th className="text-right">Taxa de atendimento</Th><Th>Despacho</Th></tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/fornecedores/${s.id}`} className="font-medium text-slate-900 hover:text-brand-700">{s.name}</Link>
                    <p className="text-xs text-slate-500">{s.cnpj ? s.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : "Sem CNPJ"}{!s.active && " · inativo"}</p>
                  </Td>
                  <Td>{getAdapter(s.integration_type).label}</Td>
                  <Td><IntegrationBadge status={s.integration_status} />{s.logistics_verified_at && <span className="ml-1"><Badge tone="brand">Logística ok</Badge></span>}</Td>
                  <Td className="num text-right">{s.products_count}</Td>
                  <Td className="num text-right">{s.orders_count}</Td>
                  <Td className="num text-right">{formatPercent(s.fulfillment_rate)}</Td>
                  <Td className="whitespace-nowrap">{s.avg_dispatch_days} dia(s)</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <EmptyState title="Nenhum fornecedor cadastrado" description="Cadastre fornecedores nacionais e escolha como cada um envia catálogo e recebe pedidos." action={<LinkButton href="/fornecedores/novo">Cadastrar fornecedor</LinkButton>} />
      )}
    </>
  );
}
