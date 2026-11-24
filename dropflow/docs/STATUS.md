# Status das funcionalidades

Legenda: ✅ pronto e testado · 🟡 pronto, **depende de validação com serviço externo real** · ⏳ pendente / próxima etapa

## Testes executados

- **45 testes automatizados** (`npm test`) — calculadora, dinheiro, criptografia, parsers de arquivo, conversores do ML, webhook, adaptador REST, status do pedido e **fluxo completo com PostgreSQL real** (importação → publicação → venda → estoque → fornecedor → rastreio → devolução, duplicidade, falta de estoque, cancelamento, variações, fornecedor manual com timeout).
- **Build de produção** do Next.js sem erros (34 rotas).
- **Teste de ponta a ponta no navegador** (Playwright, desktop e iPhone): primeiro acesso, login, fornecedor, importação, taxas, publicação, venda, aprovação, envio, devolução, bloqueio do modo produção sem pré-requisitos; sem rolagem horizontal no celular.

## Módulos

| Módulo | Situação |
|---|---|
| A — Painel (indicadores, gráficos, responsivo) | ✅ |
| B — Importador: CSV, XML (inclui Google Merchant), XLSX, JSON, mapeamento de colunas, variações, erros por linha | ✅ |
| B — Importador por API de fornecedor (adaptador REST configurável) | 🟡 testado com respostas simuladas; cada fornecedor real precisa de documentação e credenciais |
| B — Cadastro manual | ✅ |
| C — Precificação (4 modos, comissão, tarifas por faixa, frete, custos, impostos, arredondamento, lucro antes de publicar) | ✅ |
| C — Taxas oficiais via `listing_prices` | 🟡 implementado, aguardando conta conectada |
| D — OAuth com PKCE, renovação de token, contas | 🟡 implementado, aguardando credenciais do app ML |
| D — Notificações, pedidos, envios, publicação, preço/estoque, importação de anúncios, categorias/atributos | 🟡 implementado e validado com o marketplace simulado; endpoints a conferir com a documentação vigente |
| E — Processamento de pedidos (idempotência, estoque, encaminhamento, timeout, cancelamento) | ✅ (simulado) · 🟡 (com ML real) |
| F — Fornecedores (cadastro, CNPJ, integração, taxa de atendimento, histórico) | ✅ |
| G — Rastreamento (etapas, linha do tempo, etiqueta oficial) | ✅ simulado · 🟡 etiqueta e status reais |
| H — Reclamações e devoluções (registro, prazos, histórico, retorno ao fornecedor) | ✅ simulado · 🟡 endpoint de claims real |
| I — Financeiro (faturamento ≠ lucro, realizado, fornecedores, relatórios, despesas) | ✅ |
| Segurança (auth, papéis, criptografia, auditoria, RLS, LGPD) | ✅ |
| Modo teste / produção com travas | ✅ |

## Depende de você (integração externa)

1. **Aplicativo no Mercado Livre** — `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, URL pública HTTPS. Ver [MERCADO_LIVRE.md](MERCADO_LIVRE.md).
2. **Validação dos endpoints do ML** — o ambiente de desenvolvimento não tinha acesso à API nem à documentação do Mercado Livre. Siga o roteiro de homologação antes de vender.
3. **Fornecedores reais** — documentação da API e credenciais de cada um, ou o formato de arquivo que eles enviam.
4. **Valores de taxas** — cadastre comissões e tarifas conferidas no seu painel do ML (não há valores fixos no sistema).
5. **Hospedagem** — servidor com o worker rodando, ou cron chamando `/api/cron/process`.

## Pendências e melhorias sugeridas (⏳)

- Envio automático do pedido ao fornecedor por **e-mail** (hoje: mensagem pronta para copiar; a API REST já envia automaticamente).
- Upload de fotos próprias (hoje: URLs de imagens fornecidas pelo fornecedor).
- Edição de atributos técnicos e variações pela tela (hoje: via importação).
- Conciliação com o extrato do **Mercado Pago** para lucro realizado exato.
- Respostas a reclamações e mensagens pós-venda pela API (decisão consciente: hoje são feitas no ML).
- Suporte ao modelo "User Products" do ML caso a categoria exija.
- Testes e2e automatizados no repositório (o roteiro Playwright usado nesta entrega pode ser incorporado).
- Notificações de alerta por e-mail/WhatsApp.
