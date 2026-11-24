# Manual de utilização

## Modos de operação

O selo no topo indica o modo atual.

- **MODO TESTE** (padrão): marketplace e fornecedor simulados. Use o **Simulador** para gerar vendas, envios, cancelamentos e devoluções. Nada sai do sistema.
- **PRODUÇÃO**: conta real do Mercado Livre e fornecedores reais. Só pode ser ativado quando as credenciais do ML estiverem configuradas, a conta conectada, houver um fornecedor real e um perfil de taxas. Ao entrar em produção, as automações são desligadas e precisam ser religadas conscientemente.

Os dados de cada modo ficam separados: o painel em produção não mistura vendas simuladas.

## Papéis

| Papel | Pode |
|---|---|
| Administrador | Tudo: modo de operação, automações, integrações, usuários, registro de atividades |
| Operador | Importar, publicar, operar pedidos e problemas, simulador |
| Visualizador | Somente consultar |

## Telas

**Painel** — faturamento, lucro estimado, produtos ativos e sem estoque, contagem de pedidos por etapa (recebidos, enviados ao fornecedor, aguardando despacho, enviados, entregues, com problemas, devoluções), gráficos de 7/30/90 dias, últimos pedidos e alertas.

**Importar produtos** — escolha o fornecedor, envie arquivo ou busque pela API, selecione os itens e importe. Veja [FORNECEDORES.md](FORNECEDORES.md).

**Produtos** — busca e filtros (fornecedor, status, estoque). No produto: editar dados, ajustar estoque por variação, ver fotos e características, **simular preço e lucro** e publicar.

**Publicar** — escolha categoria (há sugestão pela API), tipo de anúncio e regra de preço (ou preço manual). A tela mostra preço, comissão, tarifa fixa, frete, custos, **lucro líquido estimado** e pendências (sem foto, sem estoque, prejuízo). Os atributos obrigatórios da categoria são exigidos antes de publicar.

**Anúncios** — anúncios vinculados, lucro estimado, sincronizar estoque/preço, pausar/reativar, importar anúncios existentes da conta e vincular anúncios sem produto.

**Pedidos** — lista com filtros. No pedido:
- itens e vínculo com produto/fornecedor;
- encaminhamento: **Aprovar e encaminhar**, mensagem pronta para fornecedores manuais, registrar confirmação/preparação/despacho/recusa, marcar pagamento ao fornecedor;
- rastreamento oficial, etiqueta oficial (produção) e linha do tempo;
- resultado do pedido (venda − taxas − frete − custo);
- dados do comprador ocultos; exibir o nome fica registrado (LGPD);
- **Reanalisar** consulta novamente o marketplace e o estoque (use depois de repor estoque ou vincular o anúncio).

**Rastreamento** — todas as vendas com a etapa atual: recebido → encaminhado → confirmado → em preparação → despachado → em trânsito → entregue.

**Problemas** — reclamações, cancelamentos, devoluções e mediações com pedido, produto, motivo, data, prazo (vencidos em vermelho), fornecedor e situação. Na ocorrência: histórico de atendimento, status interno e registro da devolução ao fornecedor. Reembolsos e cancelamentos são feitos **no Mercado Livre**.

**Financeiro** — faturamento, custo dos produtos, taxas, custos logísticos, despesas, lucro estimado, lucro realizado (entregues sem reclamação), valores pagos e pendentes a fornecedores, gráficos e relatórios por produto e fornecedor, lançamento de despesas.

**Alertas** — sem estoque, item sem vínculo, fornecedor sem confirmar no prazo, recusa, falha de envio, cancelamento após encaminhamento, reclamações, falhas de tarefas automáticas.

**Configurações**
- *Geral e automação:* modo, encaminhamento automático, publicação automática, sincronização de estoque/preço, margem de segurança de estoque, arredondamento (,90), retenção de dados do comprador.
- *Mercado Livre:* status das credenciais, endereços para cadastrar no app, conectar conta, consultar taxa oficial.
- *Taxas e preços:* perfis de taxas (comissão e tarifas fixas por faixa) e regras de preço (margem em R$, margem %, preço fixo, multiplicador) + calculadora.
- *Usuários* e *Minha conta*.

**Registro de atividades** (admin) — auditoria de ações, notificações recebidas do marketplace e fila de tarefas com erros.

## Calculadora de preço

Lucro líquido = preço − comissão − tarifa fixa − frete do vendedor − outros custos − custos % sobre a venda − custo do fornecedor.

Exemplo do projeto: custo R$ 30, custos R$ 10, margem desejada R$ 20 → **R$ 60**. Com comissão de 12%, o preço sobe para R$ 68,18 para manter os R$ 20 de lucro.

Modos: margem em reais, margem percentual (sobre o preço de venda), preço fixo e multiplicador sobre o custo.

## Rotina sugerida

1. Diariamente: Painel → Alertas → Pedidos "Aguardando encaminhamento" → Problemas com prazo.
2. Semanalmente: atualizar catálogo/estoque dos fornecedores por arquivo, conferir financeiro e pagamentos a fornecedores.
3. Mensalmente: conferir taxas do Mercado Livre e atualizar os perfis.
