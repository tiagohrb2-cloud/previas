# Conectar o Mercado Livre

O DropFlow usa **exclusivamente a API oficial** do Mercado Livre, com autorização OAuth 2.0 (Authorization Code + PKCE).

> ⚠️ **Validação pendente.** Durante o desenvolvimento, o ambiente não tinha acesso à internet para `api.mercadolibre.com` nem à documentação oficial (`developers.mercadolivre.com.br`). O cliente foi implementado com base na API pública conhecida, com todos os endpoints centralizados em `src/modules/marketplace/mercadolivre/`. **Antes de ativar o modo produção, confira cada endpoint da tabela abaixo com a documentação vigente** e faça os testes da seção "Homologação".

## 1. Criar o aplicativo

1. Acesse https://developers.mercadolivre.com.br e entre com a conta do Mercado Livre que vende.
2. Em **Minhas aplicações › Criar aplicação**, preencha nome e descrição.
3. **URI de redirecionamento:** `https://SEU_DOMINIO/api/ml/oauth/callback` (exatamente igual ao `APP_URL`).
4. **Notificações (callbacks):** `https://SEU_DOMINIO/api/webhooks/mercadolivre?key=SEU_ML_WEBHOOK_KEY`
5. **Tópicos:** selecione pedidos (`orders_v2`), envios (`shipments`), itens (`items`) e pós-venda/reclamações (`claims`).
6. Habilite PKCE, se a tela oferecer a opção.
7. Copie o **App ID** para `ML_CLIENT_ID` e a **Secret Key** para `ML_CLIENT_SECRET`. Reinicie a aplicação.

Os endereços exatos para copiar aparecem em **Configurações › Mercado Livre** dentro do DropFlow.

## 2. Conectar a conta

1. Entre como administrador e abra **Configurações › Mercado Livre**.
2. Clique em **Conectar conta do Mercado Livre**, autorize na página oficial e você voltará ao DropFlow.
3. Os tokens são criptografados (AES-256-GCM) e renovados automaticamente antes de expirar, com trava no banco para evitar uso duplo do refresh token.

## 3. O que o DropFlow faz com a API

| Recurso | Endpoint | Onde está no código |
|---|---|---|
| Autorização | `auth.mercadolivre.com.br/authorization`, `POST /oauth/token` | `mercadolivre/oauth.ts` |
| Dados da conta | `GET /users/me` | `oauth.ts` |
| Pedido | `GET /orders/{id}` | `adapter.ts` → `getOrder` |
| Envio | `GET /shipments/{id}` (cabeçalho `x-format-new: true`) | `getShipment` |
| Etiqueta oficial | `GET /shipment_labels?shipment_ids=&response_type=pdf` | `api/ml/labels/[shipmentId]` |
| Reclamação | `GET /post-purchase/v1/claims/{id}` | `getClaim` |
| Publicar | `POST /items`, `POST /items/{id}/description` | `publishItem` |
| Preço / estoque / pausar | `PUT /items/{id}` | `updateItem` |
| Importar anúncios | `GET /users/{id}/items/search`, `GET /items/{id}` | `listItemIds`, `getItem` |
| Categoria | `GET /sites/MLB/domain_discovery/search` | `predictCategory` |
| Atributos obrigatórios | `GET /categories/{id}/attributes` | `getCategoryAttributes` |
| Taxas oficiais | `GET /sites/MLB/listing_prices` | `getListingFee` |

Campos de resposta são convertidos em `mercadolivre/mappers.ts` (funções puras com testes em `tests/mercadolivre-mappers.test.ts`). Se a documentação vigente mostrar outro nome de campo, ajuste apenas ali.

**Pontos de atenção conhecidos:**
- O Mercado Livre vem migrando anúncios com variações para o modelo "User Products" em algumas categorias. Se a publicação com `variations` for recusada, a mensagem do ML aparece na tela; publique por variação ou ajuste `buildItemBody`.
- Taxas, faixas de tarifa fixa e regras de frete grátis mudam: use **Consultar taxa oficial** e mantenha os perfis de taxas atualizados.

## 4. Como uma venda é processada

1. O ML envia a notificação → o DropFlow valida a chave da URL, o `application_id` e se a conta está conectada, grava a notificação (sem duplicar) e responde 200.
2. A fila consulta **o pedido na API oficial** (o corpo da notificação nunca é usado como dado).
3. O pedido é vinculado ao produto/variação pelo anúncio e pelo `SELLER_SKU`.
4. Estoque verificado; sem estoque → alerta e **o pedido não é encaminhado**.
5. Pedido ao fornecedor criado com chave única (idempotência). Encaminhamento automático só ocorre se autorizado em Configurações **e** se o fornecedor tiver integração e logística comprovadas; caso contrário, aguarda aprovação.
6. Envio, rastreio e etiqueta vêm do Mercado Livre. O fornecedor deve usar a **etiqueta oficial** e não pode trocar etiqueta, transportadora ou modalidade.

## 5. Homologação antes da produção

1. Conecte a conta e importe os anúncios existentes (**Anúncios › Importar anúncios da conta**).
2. Consulte uma taxa oficial e compare com o painel do vendedor.
3. Publique **um** produto de teste e confira atributos, preço e estoque no ML; pause-o pelo DropFlow.
4. Faça uma compra real de baixo valor (ou use usuários de teste do ML, se disponíveis para sua conta) e acompanhe em **Registro de atividades › Notificações recebidas**.
5. Baixe a etiqueta oficial pelo pedido e faça o fluxo completo com o fornecedor.
6. Só então marque a logística do fornecedor como comprovada e ligue as automações.

## Não faz (por segurança)

- Não cancela vendas, não faz reembolsos e não responde reclamações automaticamente — essas ações são feitas no Mercado Livre pelo administrador.
- Não publica anúncios automaticamente sem a opção estar ativada.
- Não gera códigos de rastreio.
