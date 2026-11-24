# Arquitetura

## Visão geral

Monolito modular em Next.js (App Router). As telas e as Server Actions ficam em `src/app`; toda a regra de negócio fica em `src/modules`, independente da interface (e testável sem navegador).

```
Mercado Livre ──notificação──▶ /api/webhooks/mercadolivre ──▶ marketplace_notifications (idempotente)
                                                               │
                                                               ▼
                                     jobs (fila no PostgreSQL, SKIP LOCKED, backoff)
                                                               │  worker / cron / after()
             ┌─────────────────────┬───────────────────────────┼───────────────────────┐
             ▼                     ▼                           ▼                       ▼
   order.sync (API oficial)   shipment.sync              claim.sync          supplier_order.submit
   vínculo + estoque          rastreio oficial           reclamações         adaptador do fornecedor
             └──────────────▶ orders / supplier_orders / tracking_events / alerts ◀────┘
```

## Pastas

```
db/migrations/           migrações SQL versionadas
scripts/                 migrate, worker, create-admin
src/lib/                 db, env, crypto (AES-GCM, scrypt, PKCE), jobs, alerts, audit, settings, money
src/modules/
  auth/                  sessões, papéis e permissões
  catalog/               formato normalizado, parsers (CSV/XML/XLSX/JSON), importação, estoque
  suppliers/adapters/    contrato SupplierAdapter + manual, arquivo, REST, simulado
  marketplace/           contrato MarketplaceAdapter + Mercado Livre (oauth, client, mappers) + simulado
  pricing/               calculadora (pura) e perfis/regras
  listings/              publicação, sincronização, importação e vínculo de anúncios
  orders/                processamento, status consolidado, encaminhamento, timeout
  issues/                reclamações, devoluções, histórico
  finance/ dashboard/    indicadores e relatórios
  notifications/         entrada das notificações
  simulator/             eventos do modo teste
  worker/                registro de tarefas e rotinas periódicas
src/app/                 telas, Server Actions e rotas de API
tests/                   testes (unitários e de integração com PostgreSQL real)
```

## Banco de dados

| Domínio | Tabelas |
|---|---|
| Usuários e segurança | `users`, `sessions`, `login_attempts`, `audit_logs` (logs), `settings` |
| Fornecedores | `suppliers`, `supplier_catalog_items`, `import_jobs` |
| Produtos | `products`, `product_variants` (variações), `product_images`, `inventory` (estoque), `inventory_movements` |
| Preço | `fee_profiles`, `pricing_rules` |
| Mercado Livre | `ml_accounts`, `oauth_states`, `listings` (anúncios), `listing_variations` |
| Pedidos | `orders`, `order_items`, `supplier_orders` |
| Logística | `shipments` (envios), `tracking_events` (rastreamento) |
| Pós-venda | `claims` (reclamações), `claim_events`, `returns` (devoluções) |
| Financeiro | `costs` (custos), `transactions` |
| Operação | `marketplace_notifications` (notificações), `alerts`, `jobs`, `simulation_store` |

Valores monetários em centavos (`bigint`); datas em `timestamptz` exibidas em America/Sao_Paulo.

## Idempotência e consistência

- Notificação: única por `(marketplace, notification_id)`.
- Pedido: único por `(marketplace, external_order_id)`; processamento com `SELECT … FOR UPDATE`.
- Pedido ao fornecedor: único por `(order_id, supplier_id)` e `idempotency_key` enviada ao fornecedor.
- Tarefas: `dedupe_key` impede duplicatas na fila; falhas têm backoff exponencial e geram alerta ao esgotar tentativas.
- Estoque: reserva com lock na linha de inventário; liberação em cancelamento/recusa; consumo na confirmação.
- O status do pedido é **derivado** (`deriveOrderStatus`) do marketplace e dos fornecedores — não há atualização manual que deixe estados incoerentes.

## Segurança

- Senhas com scrypt; sessões com token aleatório (só o hash fica no banco), cookie HttpOnly/SameSite/Secure.
- Bloqueio após 5 tentativas de login em 15 minutos.
- Proteção de rotas em duas camadas: `src/proxy.ts` (sem sessão → login) e verificação de permissão em cada página e Server Action.
- Tokens do ML e segredos de fornecedores criptografados (AES-256-GCM). Nenhum segredo no código; `.env.example` documenta tudo.
- Webhook protegido por segredo na URL + validação de `application_id` e conta conectada; dados sempre consultados na API oficial.
- Validação com zod; SQL sempre parametrizado; cabeçalhos de segurança (X-Frame-Options, nosniff, Referrer-Policy).
- RLS ativo em todas as tabelas (Supabase).
- Auditoria de ações relevantes, sem dados sensíveis.

## LGPD

- Somente apelido, nome (criptografado) e IDs do comprador são guardados; pagamentos e documentos são removidos do payload salvo.
- Endereço não é armazenado: o envio usa a etiqueta oficial do Mercado Livre.
- O nome só é exibido sob demanda, com registro de acesso.
- Dados pessoais são apagados automaticamente após o prazo de retenção configurado.

## Adicionar um fornecedor

1. Crie `src/modules/suppliers/adapters/meu-fornecedor.ts` implementando `SupplierAdapter` (só os métodos que a API real oferece).
2. Converta os dados para `NormalizedProduct` (`catalog/types.ts`).
3. Registre em `adapters/registry.ts` e adicione o tipo à constraint `integration_type` numa nova migração.
4. Escreva testes com respostas simuladas (veja `tests/integrations.test.ts`).

## Adicionar um marketplace

Implemente `MarketplaceAdapter` (`marketplace/types.ts`), registre em `marketplace/registry.ts`, adicione o valor às constraints `marketplace` numa migração e crie a rota de notificações correspondente.
