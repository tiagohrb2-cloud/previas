# Cadastrar fornecedores

## 1. Cadastro

**Fornecedores › Novo fornecedor**: nome, razão social, CNPJ (validado), contato, e-mail, telefone, endereço, prazo médio de despacho, prazo para confirmar pedidos (gera alerta quando vence) e o canal de envio de pedidos (e-mail, WhatsApp, portal…).

## 2. Método de integração

Na página do fornecedor, escolha um dos métodos:

| Método | Catálogo | Estoque | Pedidos | Quando usar |
|---|---|---|---|---|
| **Manual** | Cadastro manual | Manual | Mensagem pronta para enviar | Fornecedor sem API e sem arquivo |
| **Arquivo** | Upload CSV/XML/XLSX/JSON | Reenvio do arquivo | Mensagem pronta para enviar | Fornecedor envia planilha ou feed |
| **API (REST documentada)** | Automático | Automático | Por API, com chave de idempotência | Fornecedor fornece documentação e credenciais |
| **Simulado** | Demonstração | Demonstração | Automático | Apenas modo teste |

> O DropFlow não usa scraping e não presume APIs. Se o fornecedor não tem integração, isso fica claro na tela e você usa arquivo ou cadastro manual.

### Arquivo (CSV, XML, planilha, JSON)

Baixe a planilha modelo em **Importar produtos**. Colunas reconhecidas automaticamente (português ou inglês):

`sku`, `sku_pai` (agrupa variações), `nome`, `descricao`, `marca`, `ean`, `preco_custo`, `estoque`, `peso_kg` (ou `peso_g`), `comprimento`, `largura`, `altura`, `imagens` (URLs separadas por `|`), `cor`, `tamanho`, `categoria` e qualquer `attr_Nome` (vira característica técnica).

- Preços aceitam `R$ 1.234,56`, `1234,56` ou `1234.56`.
- EAN é validado pelo dígito verificador.
- Feeds XML no padrão **Google Merchant** (`g:id`, `g:item_group_id`, `g:price`…) funcionam direto.
- Nomes de colunas diferentes? Use **Mapeamento de colunas** na tela de importação.
- Erros aparecem por linha; linhas válidas são importadas mesmo assim.

### API do fornecedor

Peça ao fornecedor a documentação oficial e as credenciais. Preencha:
- URL base (HTTPS), link da documentação, tipo de autenticação e token/usuário/senha (salvos criptografados).
- **Catálogo:** caminho, onde está a lista de itens na resposta, paginação e o caminho de cada campo (ex.: `preco.custo`).
- **Estoque (opcional):** caminho com `{skus}`, campo SKU e campo quantidade.
- **Pedidos (opcional):** caminho de criação, cabeçalho de idempotência, campo do número do pedido, consulta de status e mapa de status (`{"APROVADO":"confirmed","ENVIADO":"dispatched"}`).

Clique em **Testar conexão**. Se o fornecedor tiver um formato muito específico (SOAP, assinatura de requisição…), crie um adaptador próprio — veja [ARQUITETURA.md](ARQUITETURA.md#adicionar-um-fornecedor).

## 3. Importar o catálogo

**Importar produtos** → escolha o fornecedor → envie o arquivo ou clique em **Buscar catálogo pela API**. Os itens ficam numa área de preparação; selecione e clique em **Importar selecionados**. Reimportar atualiza custo, dados e estoque sem duplicar (chave: fornecedor + SKU).

## 4. Liberar a automação

O encaminhamento automático de pedidos só funciona para fornecedores com:
1. Integração de pedidos por API **verificada** (teste de conexão ok);
2. **Logística comprovada** — marque somente depois de um pedido real em que o fornecedor despachou com a etiqueta oficial do Mercado Livre, sem trocar etiqueta ou modalidade;
3. Automação ligada em **Configurações**.

Os demais fornecedores continuam funcionando com aprovação manual: o DropFlow gera a mensagem do pedido, você envia e registra a confirmação/despacho.

## 5. Indicadores

A página do fornecedor mostra produtos vinculados, pedidos encaminhados, **taxa de atendimento** (confirmados ÷ encaminhados), tempo médio de confirmação, valores a pagar e histórico de pedidos.
