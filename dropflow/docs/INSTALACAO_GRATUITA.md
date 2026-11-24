# Instalação gratuita, feita pelo celular

Sem servidor próprio e sem pagar nada. Tudo é feito pelo navegador do celular (Chrome no Android ou Safari no iPhone).

| Parte | Serviço gratuito | Para quê |
|---|---|---|
| Banco de dados | **Supabase** (plano Free) | Guarda produtos, pedidos, fornecedores |
| Sistema ligado 24h | **Render** (plano Free) | Recebe as vendas do Mercado Livre e roda o DropFlow |
| Rotina automática | **cron-job.org** | Processa a fila a cada 10 min e mantém o sistema acordado |
| Uso no dia a dia | Seu celular | Ícone do DropFlow na tela inicial |

> **Limites do grátis (regras atuais desses serviços, que podem mudar):**
> - O Render grátis "dorme" após 15 minutos sem acesso. A rotina do cron-job.org a cada 10 minutos evita isso. O Render dá 750 horas grátis por mês, o suficiente para 1 sistema ligado o mês todo.
> - O Supabase grátis tem 500 MB de banco, o que dá para milhares de produtos e pedidos. Ele pausa projetos parados há 7 dias; com a rotina acessando o banco, isso não acontece. Se pausar, basta clicar em **Restore** no painel.
> - O Mercado Livre não cobra para criar o aplicativo nem usar a API. Você paga só as tarifas normais das vendas.

Tempo estimado: 30 a 40 minutos.

---

## Passo 1 — Banco de dados (Supabase)

1. Acesse **supabase.com** → **Start your project** → entre com sua conta do **GitHub**.
2. **New project**:
   - Name: `dropflow`
   - Database Password: clique em **Generate a password** e **copie e guarde essa senha** (bloco de notas do celular).
   - Region: **South America (São Paulo)**
   - Plano: **Free**
3. Aguarde ~2 minutos até o projeto ficar pronto.
4. Toque em **Connect** (no topo) → aba **Connection String** → em **Method**, escolha **Session pooler**.
5. Copie o endereço. Ele se parece com:
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`
6. No bloco de notas, troque `[YOUR-PASSWORD]` pela senha que você guardou (sem os colchetes). Esse é o seu **DATABASE_URL**.

> Use o **Session pooler**: a conexão "Direct" do Supabase não funciona a partir do Render grátis.

Não precisa criar tabelas: o DropFlow cria tudo sozinho na primeira vez que ligar.

## Passo 2 — Colocar o DropFlow no ar (Render)

1. Acesse **render.com** → **Get Started** → entre com o **GitHub** e autorize o acesso ao repositório `previas`.
2. Toque em **New +** → **Blueprint**.
3. Escolha o repositório **previas** e a branch **claude/dropflow-dropshipping-platform-c2mvwp**.
4. O Render lê o arquivo `render.yaml` e mostra o serviço **dropflow (Free)**. Ele pede:
   - **DATABASE_URL** → cole o endereço do Passo 1.
   - **ML_CLIENT_ID** e **ML_CLIENT_SECRET** → deixe em branco por enquanto (Passo 6).
5. Toque em **Apply** / **Deploy**. A primeira instalação leva de 5 a 10 minutos.
6. Quando aparecer **Live**, copie o endereço do topo da página, ex.: `https://dropflow-abcd.onrender.com`. Esse é o **seu DropFlow**.

As chaves secretas (`ENCRYPTION_KEY`, `SETUP_TOKEN`, `CRON_SECRET`, `ML_WEBHOOK_KEY`) são criadas automaticamente pelo Render. Para ver uma delas: serviço **dropflow** → **Environment** → toque no olho ao lado do nome.

> **Nunca apague nem troque a `ENCRYPTION_KEY`.** Ela protege os acessos ao Mercado Livre e aos fornecedores.

## Passo 3 — Criar seu acesso

1. No Render, abra **Environment** e copie o valor de **SETUP_TOKEN**.
2. Abra `https://SEU-ENDERECO.onrender.com/setup`.
3. Cole o token, digite seu nome, e-mail e uma senha (mínimo de 10 caracteres, com letras e números).
4. Entre com seu e-mail e senha.

## Passo 4 — Rotina automática (cron-job.org)

1. Acesse **cron-job.org** → **Sign up** (grátis) e confirme o e-mail.
2. **Create cronjob**:
   - Title: `DropFlow`
   - URL: `https://SEU-ENDERECO.onrender.com/api/cron/process`
   - Execution schedule: **Every 10 minutes**
3. Abra **Advanced** → **Headers** → **Add header**:
   - Key: `Authorization`
   - Value: `Bearer ` seguido do valor de **CRON_SECRET** (do Render). Exemplo: `Bearer abc123...`, com um espaço depois de Bearer.
4. **Create**. Em **History**, a execução deve aparecer como **200 OK**.

## Passo 5 — Instalar o app no celular

- **Android (Chrome):** abra seu endereço → menu **⋮** → **Instalar app** (ou **Adicionar à tela inicial**).
- **iPhone (Safari):** abra seu endereço → botão **Compartilhar** (quadrado com seta) → **Adicionar à Tela de Início**.

O ícone verde **D** abre o DropFlow em tela cheia, como um aplicativo.

> A primeira abertura depois de muito tempo parado pode levar até 1 minuto: é o Render grátis "acordando".

## Passo 6 — Conectar o Mercado Livre

1. Acesse **developers.mercadolivre.com.br** com a conta que vende → **Minhas aplicações** → **Criar aplicação**.
2. Preencha:
   - **URI de redirect:** `https://SEU-ENDERECO.onrender.com/api/ml/oauth/callback`
   - **URL de notificações:** `https://SEU-ENDERECO.onrender.com/api/webhooks/mercadolivre?key=VALOR_DO_ML_WEBHOOK_KEY` (pegue o valor no Render › Environment)
   - **Tópicos:** pedidos (`orders_v2`), envios (`shipments`), itens (`items`) e reclamações (`claims`)
3. Salve e copie o **App ID** e a **Secret Key**.
4. No Render → **Environment** → preencha **ML_CLIENT_ID** (App ID) e **ML_CLIENT_SECRET** (Secret Key) → **Save Changes**. O Render reinicia sozinho.
5. No DropFlow: **Configurações › Mercado Livre › Conectar conta do Mercado Livre** e autorize.

Depois siga o roteiro de homologação em [MERCADO_LIVRE.md](MERCADO_LIVRE.md#5-homologação-antes-da-produção) antes de ativar o modo produção.

## Começar a usar

- Treine primeiro no **modo teste** (padrão): crie um fornecedor "Simulado", importe o catálogo, publique e use o **Simulador**.
- Depois cadastre seus fornecedores reais: [FORNECEDORES.md](FORNECEDORES.md).

## Problemas comuns

| Sintoma | Solução |
|---|---|
| Deploy falha com erro de banco | Confira o DATABASE_URL: modo **Session pooler** e senha sem `[ ]` |
| Página demora a abrir | Render acordando; confira se a rotina do cron-job.org está ativa |
| cron-job.org mostra 401 | Header `Authorization` precisa ser `Bearer ` + CRON_SECRET |
| "Token de configuração inválido" | Copie de novo o SETUP_TOKEN no Render (sem espaços) |
| Supabase pausado | Painel do Supabase → **Restore project** |
