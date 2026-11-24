-- =====================================================================
-- DropFlow — migração 0001: estrutura inicial
-- Compatível com PostgreSQL 14+ e Supabase.
-- Valores monetários em centavos (bigint). Datas em timestamptz (UTC).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Função utilitária: updated_at automático
-- ---------------------------------------------------------------------
create or replace function df_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- USUÁRIOS, SESSÕES, PERMISSÕES
-- ---------------------------------------------------------------------
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email = lower(email)),
  name          text not null,
  password_hash text not null,
  role          text not null default 'operator' check (role in ('admin','operator','viewer')),
  active        boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_users_touch before update on users for each row execute function df_touch_updated_at();

create table sessions (
  id          text primary key,            -- sha256 do token (o token em si nunca é salvo)
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index idx_sessions_user on sessions(user_id);

create table login_attempts (
  id          bigserial primary key,
  email       text not null,
  ip          text,
  success     boolean not null,
  created_at  timestamptz not null default now()
);
create index idx_login_attempts_email on login_attempts(email, created_at desc);

-- ---------------------------------------------------------------------
-- LOGS DE ATIVIDADE (auditoria)
-- ---------------------------------------------------------------------
create table audit_logs (
  id          bigserial primary key,
  user_id     uuid references users(id) on delete set null,
  actor       text not null default 'user',  -- user | system | webhook | worker
  action      text not null,
  entity_type text,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index idx_audit_created on audit_logs(created_at desc);
create index idx_audit_entity on audit_logs(entity_type, entity_id);

-- ---------------------------------------------------------------------
-- CONFIGURAÇÕES (chave/valor)
-- ---------------------------------------------------------------------
create table settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid references users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

insert into settings(key, value) values
  ('operation_mode', '"test"'),               -- test | production
  ('auto_publish_enabled', 'false'),          -- publicação automática de anúncios
  ('auto_forward_orders_enabled', 'false'),   -- encaminhamento automático ao fornecedor
  ('auto_stock_sync_enabled', 'false'),       -- sincronização automática de estoque/preço
  ('stock_safety_margin', '0'),               -- unidades reservadas como margem de segurança
  ('buyer_data_retention_days', '180'),       -- LGPD: dias de retenção após entrega
  ('price_rounding', '"none"');               -- none | ninety (x,90)

-- ---------------------------------------------------------------------
-- FORNECEDORES
-- ---------------------------------------------------------------------
create table suppliers (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null,
  legal_name                 text,
  cnpj                       text,
  contact_name               text,
  email                      text,
  phone                      text,
  address                    jsonb not null default '{}'::jsonb,
  avg_dispatch_days          integer not null default 2 check (avg_dispatch_days >= 0),
  confirmation_timeout_hours integer not null default 24 check (confirmation_timeout_hours > 0),
  integration_type           text not null default 'manual'
                               check (integration_type in ('manual','file','rest','simulated')),
  integration_config         jsonb not null default '{}'::jsonb,  -- sem segredos
  integration_secret_enc     text,                                -- segredos criptografados (AES-256-GCM)
  integration_status         text not null default 'not_configured'
                               check (integration_status in ('not_configured','configured','verified','error','disabled')),
  integration_verified_at    timestamptz,
  integration_last_error     text,
  logistics_verified_at      timestamptz,   -- fluxo logístico comprovado pelo administrador
  order_channel_notes        text,          -- como o pedido é enviado (e-mail, WhatsApp, portal…)
  active                     boolean not null default true,
  notes                      text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create unique index uq_suppliers_cnpj on suppliers(cnpj) where cnpj is not null and cnpj <> '';
create trigger trg_suppliers_touch before update on suppliers for each row execute function df_touch_updated_at();

-- Catálogo do fornecedor (área de preparação antes da importação)
create table supplier_catalog_items (
  id                   uuid primary key default gen_random_uuid(),
  supplier_id          uuid not null references suppliers(id) on delete cascade,
  supplier_sku         text not null,
  title                text not null,
  cost_cents           bigint,
  stock                integer,
  data                 jsonb not null,  -- produto normalizado (NormalizedProduct)
  source               text not null check (source in ('api','file','manual','simulated')),
  import_job_id        uuid,
  imported_product_id  uuid,
  fetched_at           timestamptz not null default now(),
  unique (supplier_id, supplier_sku)
);
create index idx_catalog_supplier on supplier_catalog_items(supplier_id, fetched_at desc);

create table import_jobs (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references suppliers(id) on delete cascade,
  source        text not null check (source in ('api','file','manual','simulated')),
  file_name     text,
  status        text not null default 'running' check (status in ('running','completed','failed')),
  total_rows    integer not null default 0,
  ok_rows       integer not null default 0,
  error_rows    integer not null default 0,
  errors        jsonb not null default '[]'::jsonb,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

-- ---------------------------------------------------------------------
-- PRODUTOS, VARIAÇÕES, IMAGENS, ESTOQUE
-- ---------------------------------------------------------------------
create table products (
  id                 uuid primary key default gen_random_uuid(),
  supplier_id        uuid not null references suppliers(id) on delete restrict,
  supplier_sku       text not null,
  sku                text not null unique,          -- SKU interno (enviado como SELLER_SKU)
  title              text not null,
  description        text not null default '',
  brand              text,
  gtin               text,
  cost_cents         bigint not null check (cost_cents >= 0),
  weight_g           integer check (weight_g >= 0),
  length_cm          numeric(8,2),
  width_cm           numeric(8,2),
  height_cm          numeric(8,2),
  attributes         jsonb not null default '{}'::jsonb,   -- características técnicas
  ml_category_id     text,
  condition          text not null default 'new' check (condition in ('new','used')),
  status             text not null default 'draft' check (status in ('draft','active','inactive')),
  source             text not null check (source in ('api','file','manual','simulated')),
  pricing_override   jsonb,           -- regra de preço específica do produto
  seller_shipping_cost_cents bigint not null default 0 check (seller_shipping_cost_cents >= 0),
  last_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (supplier_id, supplier_sku)
);
create index idx_products_supplier on products(supplier_id);
create index idx_products_title on products using gin (to_tsvector('portuguese', title));
create trigger trg_products_touch before update on products for each row execute function df_touch_updated_at();

create table product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  url         text not null check (url ~* '^https?://'),
  position    integer not null default 0,
  unique (product_id, url)
);

create table product_variants (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  supplier_sku  text not null,
  sku           text not null unique,
  gtin          text,
  attributes    jsonb not null default '{}'::jsonb,   -- {"Cor":"Azul","Tamanho":"M"}
  cost_cents    bigint check (cost_cents >= 0),      -- null = usa o custo do produto
  is_default    boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, supplier_sku)
);
create trigger trg_variants_touch before update on product_variants for each row execute function df_touch_updated_at();

create table inventory (
  variant_id   uuid primary key references product_variants(id) on delete cascade,
  quantity     integer not null default 0 check (quantity >= 0),   -- disponível no fornecedor
  reserved     integer not null default 0 check (reserved >= 0),   -- comprometido em pedidos
  source       text not null default 'manual',
  updated_at   timestamptz not null default now()
);

create table inventory_movements (
  id           bigserial primary key,
  variant_id   uuid not null references product_variants(id) on delete cascade,
  delta        integer not null,
  reason       text not null,   -- import | sync | order_reserve | order_release | manual
  reference    text,
  quantity_after integer,
  created_at   timestamptz not null default now()
);
create index idx_inv_mov_variant on inventory_movements(variant_id, created_at desc);

-- ---------------------------------------------------------------------
-- PRECIFICAÇÃO E TAXAS
-- ---------------------------------------------------------------------
create table fee_profiles (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  listing_type_id     text not null,              -- ex.: gold_special (Clássico), gold_pro (Premium)
  category_id         text,                       -- null = padrão para todas as categorias
  commission_percent  numeric(6,3) not null check (commission_percent >= 0 and commission_percent < 100),
  fixed_fee_tiers     jsonb not null default '[]'::jsonb,  -- [{"below_cents":7900,"fee_cents":650}]
  source              text not null default 'manual' check (source in ('manual','ml_api')),
  notes               text,
  verified_at         timestamptz,                -- quando o administrador conferiu com o ML
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_fee_touch before update on fee_profiles for each row execute function df_touch_updated_at();

create table pricing_rules (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  mode                   text not null check (mode in ('margin_fixed','margin_percent','fixed_price','multiplier')),
  value                  numeric(14,4) not null check (value >= 0),  -- centavos | % | centavos | fator
  fee_profile_id         uuid references fee_profiles(id) on delete set null,
  extra_cost_cents       bigint not null default 0 check (extra_cost_cents >= 0),   -- embalagem, operação…
  extra_cost_percent     numeric(6,3) not null default 0 check (extra_cost_percent >= 0), -- impostos sobre a venda
  supplier_id            uuid references suppliers(id) on delete cascade,
  is_default             boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index uq_pricing_default on pricing_rules(is_default) where is_default;
create trigger trg_rules_touch before update on pricing_rules for each row execute function df_touch_updated_at();

-- ---------------------------------------------------------------------
-- CONTAS DO MERCADO LIVRE
-- ---------------------------------------------------------------------
create table ml_accounts (
  id                 uuid primary key default gen_random_uuid(),
  ml_user_id         bigint not null unique,
  nickname           text,
  site_id            text not null default 'MLB',
  access_token_enc   text not null,
  refresh_token_enc  text,
  token_expires_at   timestamptz not null,
  scopes             text,
  status             text not null default 'active' check (status in ('active','expired','revoked','error')),
  last_error         text,
  connected_by       uuid references users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_mlacc_touch before update on ml_accounts for each row execute function df_touch_updated_at();

create table oauth_states (
  state              text primary key,
  code_verifier_enc  text not null,
  user_id            uuid references users(id) on delete cascade,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ANÚNCIOS
-- ---------------------------------------------------------------------
create table listings (
  id                uuid primary key default gen_random_uuid(),
  marketplace       text not null default 'mercadolivre' check (marketplace in ('mercadolivre','simulated')),
  account_id        uuid references ml_accounts(id) on delete set null,
  product_id        uuid references products(id) on delete set null,
  external_id       text,                     -- ex.: MLB1234567890
  title             text not null,
  status            text not null default 'draft'
                      check (status in ('draft','pending','active','paused','closed','under_review','error','unlinked')),
  price_cents       bigint,
  available_quantity integer,
  listing_type_id   text,
  category_id       text,
  permalink         text,
  pricing_snapshot  jsonb,                    -- cálculo de preço e lucro no momento da publicação
  last_synced_at    timestamptz,
  sync_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (marketplace, external_id)
);
create index idx_listings_product on listings(product_id);
create trigger trg_listings_touch before update on listings for each row execute function df_touch_updated_at();

create table listing_variations (
  id                      uuid primary key default gen_random_uuid(),
  listing_id              uuid not null references listings(id) on delete cascade,
  variant_id              uuid references product_variants(id) on delete set null,
  external_variation_id   text,
  seller_sku              text,
  unique (listing_id, external_variation_id)
);

-- ---------------------------------------------------------------------
-- PEDIDOS
-- ---------------------------------------------------------------------
create table orders (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,                 -- identificador interno legível (DF-000123)
  marketplace         text not null check (marketplace in ('mercadolivre','simulated')),
  account_id          uuid references ml_accounts(id) on delete set null,
  external_order_id   text not null,
  external_pack_id    text,
  external_status     text,
  status              text not null default 'received' check (status in (
                         'received','awaiting_forward','forwarded','supplier_confirmed','preparing',
                         'dispatched','in_transit','delivered','cancelled','returned','problem')),
  problem_reason      text,      -- out_of_stock | mapping_missing | supplier_timeout | supplier_rejected | cancelled_after_forward | claim
  total_cents         bigint not null default 0,
  marketplace_fee_cents bigint not null default 0,
  shipping_cost_cents bigint not null default 0,   -- custo de frete pago pelo vendedor
  currency            text not null default 'BRL',
  buyer_nickname      text,
  buyer_data_enc      text,     -- LGPD: nome/documento/endereço criptografados; apagados após retenção
  buyer_data_purged_at timestamptz,
  external_shipment_id text,
  ordered_at          timestamptz not null,
  paid_at             timestamptz,
  forwarded_at        timestamptz,
  delivered_at        timestamptz,
  cancelled_at        timestamptz,
  raw                 jsonb,     -- último payload oficial (dados pessoais removidos)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (marketplace, external_order_id)
);
create index idx_orders_status on orders(status);
create index idx_orders_ordered on orders(ordered_at desc);
create sequence order_code_seq start 1000;
create trigger trg_orders_touch before update on orders for each row execute function df_touch_updated_at();

create table order_items (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references orders(id) on delete cascade,
  external_item_id      text not null,
  external_variation_id text,
  seller_sku            text,
  title                 text not null,
  quantity              integer not null check (quantity > 0),
  unit_price_cents      bigint not null,
  sale_fee_cents        bigint not null default 0,
  variant_id            uuid references product_variants(id) on delete set null,
  product_id            uuid references products(id) on delete set null,
  supplier_id           uuid references suppliers(id) on delete set null,
  unit_cost_cents       bigint,          -- custo do fornecedor no momento da venda
  unique (order_id, external_item_id, external_variation_id)
);
create unique index uq_order_items_novar on order_items(order_id, external_item_id) where external_variation_id is null;

-- Pedido encaminhado ao fornecedor (um por fornecedor envolvido no pedido)
create table supplier_orders (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references orders(id) on delete cascade,
  supplier_id          uuid not null references suppliers(id) on delete restrict,
  idempotency_key      text not null unique,
  status               text not null default 'pending' check (status in (
                         'pending','awaiting_approval','submitted','manual_required','confirmed',
                         'preparing','dispatched','rejected','cancelled','failed')),
  external_reference   text,      -- número do pedido no fornecedor
  total_cost_cents     bigint not null default 0,
  payment_status       text not null default 'pending' check (payment_status in ('pending','paid','refunded','not_applicable')),
  paid_at              timestamptz,
  submitted_at         timestamptz,
  confirmed_at         timestamptz,
  dispatched_at        timestamptz,
  confirmation_due_at  timestamptz,
  attempts             integer not null default 0,
  last_error           text,
  message              text,      -- instruções geradas para envio manual
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (order_id, supplier_id)
);
create trigger trg_so_touch before update on supplier_orders for each row execute function df_touch_updated_at();

-- ---------------------------------------------------------------------
-- ENVIOS E RASTREAMENTO
-- ---------------------------------------------------------------------
create table shipments (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references orders(id) on delete cascade,
  external_shipment_id text,
  logistic_type        text,     -- definido pelo marketplace (ex.: drop_off, xd_drop_off, cross_docking, fulfillment)
  mode                 text,     -- me2, me1, custom…
  status               text,     -- status oficial do marketplace
  substatus            text,
  tracking_number      text,     -- somente vindo do marketplace
  tracking_method      text,
  carrier              text,
  label_available      boolean not null default false,
  last_synced_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (order_id),
  unique (external_shipment_id)
);
create trigger trg_ship_touch before update on shipments for each row execute function df_touch_updated_at();

create table tracking_events (
  id            bigserial primary key,
  order_id      uuid not null references orders(id) on delete cascade,
  stage         text not null check (stage in (
                  'received','forwarded','confirmed','preparing','dispatched','in_transit','delivered','cancelled','returned','problem')),
  description   text,
  source        text not null check (source in ('marketplace','supplier','system','manual')),
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (order_id, stage, source, occurred_at)
);
create index idx_tracking_order on tracking_events(order_id, occurred_at);

-- ---------------------------------------------------------------------
-- RECLAMAÇÕES E DEVOLUÇÕES
-- ---------------------------------------------------------------------
create table claims (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid references orders(id) on delete set null,
  marketplace        text not null default 'mercadolivre',
  external_claim_id  text,
  type               text not null check (type in ('claim','cancellation','return','mediation','other')),
  reason             text,
  status             text not null default 'open' check (status in ('open','in_progress','waiting_marketplace','resolved','closed')),
  external_status    text,
  opened_at          timestamptz not null default now(),
  due_at             timestamptz,
  supplier_id        uuid references suppliers(id) on delete set null,
  resolution         text,
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (marketplace, external_claim_id)
);
create trigger trg_claims_touch before update on claims for each row execute function df_touch_updated_at();

create table claim_events (
  id          bigserial primary key,
  claim_id    uuid not null references claims(id) on delete cascade,
  kind        text not null default 'note',  -- note | status_change | sync | return_update
  message     text not null,
  user_id     uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table returns (
  id                      uuid primary key default gen_random_uuid(),
  claim_id                uuid references claims(id) on delete set null,
  order_id                uuid references orders(id) on delete set null,
  supplier_id             uuid references suppliers(id) on delete set null,
  status                  text not null default 'requested' check (status in (
                            'requested','in_transit_to_seller','received','sent_to_supplier','received_by_supplier','closed')),
  tracking_reference      text,
  sent_to_supplier_at     timestamptz,
  received_by_supplier_at timestamptz,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger trg_returns_touch before update on returns for each row execute function df_touch_updated_at();

-- ---------------------------------------------------------------------
-- FINANCEIRO
-- ---------------------------------------------------------------------
create table costs (                       -- despesas operacionais
  id            uuid primary key default gen_random_uuid(),
  description   text not null,
  category      text not null default 'operational',
  amount_cents  bigint not null check (amount_cents >= 0),
  incurred_on   date not null,
  recurring     boolean not null default false,
  supplier_id   uuid references suppliers(id) on delete set null,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table transactions (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references orders(id) on delete cascade,
  supplier_id   uuid references suppliers(id) on delete set null,
  type          text not null check (type in (
                  'sale','marketplace_fee','shipping_cost','product_cost','supplier_payment','refund','expense','adjustment')),
  amount_cents  bigint not null,    -- positivo = entrada, negativo = saída
  status        text not null default 'estimated' check (status in ('estimated','realized','pending','cancelled')),
  occurred_at   timestamptz not null default now(),
  description   text,
  dedupe_key    text unique,
  created_at    timestamptz not null default now()
);
create index idx_tx_order on transactions(order_id);
create index idx_tx_occurred on transactions(occurred_at);

-- ---------------------------------------------------------------------
-- NOTIFICAÇÕES RECEBIDAS (webhooks) E ALERTAS
-- ---------------------------------------------------------------------
create table marketplace_notifications (
  id               bigserial primary key,
  marketplace      text not null default 'mercadolivre',
  notification_id  text not null,        -- _id enviado pelo ML (ou hash do conteúdo)
  topic            text not null,
  resource         text not null,
  external_user_id text,
  attempts         integer,
  payload          jsonb not null,
  status           text not null default 'pending' check (status in ('pending','processed','ignored','failed')),
  error            text,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  unique (marketplace, notification_id)
);

create table alerts (
  id           uuid primary key default gen_random_uuid(),
  severity     text not null default 'warning' check (severity in ('info','warning','critical')),
  type         text not null,
  title        text not null,
  message      text,
  entity_type  text,
  entity_id    text,
  dedupe_key   text unique,
  read_at      timestamptz,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index idx_alerts_open on alerts(created_at desc) where resolved_at is null;

-- ---------------------------------------------------------------------
-- FILA DE TAREFAS (jobs) — processada pelo worker com SKIP LOCKED
-- ---------------------------------------------------------------------
create table jobs (
  id            bigserial primary key,
  type          text not null,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'queued' check (status in ('queued','running','done','failed')),
  dedupe_key    text,
  run_at        timestamptz not null default now(),
  attempts      integer not null default 0,
  max_attempts  integer not null default 5,
  last_error    text,
  locked_at     timestamptz,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create unique index uq_jobs_dedupe_active on jobs(dedupe_key) where dedupe_key is not null and status in ('queued','running');
create index idx_jobs_ready on jobs(run_at) where status = 'queued';

-- Armazenamento do marketplace/fornecedor simulados (somente MODO TESTE)
create table simulation_store (
  kind         text not null,
  external_id  text not null,
  data         jsonb not null,
  updated_at   timestamptz not null default now(),
  primary key (kind, external_id)
);

-- ---------------------------------------------------------------------
-- SEGURANÇA NO SUPABASE
-- RLS ativado em todas as tabelas, sem políticas para anon/authenticated:
-- a API REST pública do Supabase não consegue ler nem gravar nada.
-- O servidor do DropFlow conecta como dono das tabelas (conexão direta).
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end $$;
