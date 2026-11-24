# Instalação

## Requisitos

- Node.js 20.9 ou superior (testado com Node 22)
- PostgreSQL 14+ — local ou **Supabase** (plano gratuito atende o início)
- Para produção: domínio com **HTTPS** (exigido pelo Mercado Livre para o redirecionamento e as notificações)

## 1. Variáveis de ambiente

Copie `.env.example` para `.env.local` (desenvolvimento) ou cadastre as variáveis no painel da hospedagem (produção).

| Variável | Obrigatória | Descrição |
|---|---|---|
| `APP_URL` | sim | URL pública, ex.: `https://dropflow.suaempresa.com.br` |
| `DATABASE_URL` | sim | Conexão PostgreSQL |
| `DATABASE_SSL` | sim | `true` no Supabase, `false` local |
| `ENCRYPTION_KEY` | sim | 32 bytes em base64 — criptografa tokens do ML e segredos de fornecedores |
| `SETUP_TOKEN` | primeiro acesso | Token para criar o primeiro administrador em `/setup` |
| `CRON_SECRET` | produção | Protege `/api/cron/process` |
| `ML_CLIENT_ID` / `ML_CLIENT_SECRET` | produção | Credenciais do aplicativo no Mercado Livre |
| `ML_WEBHOOK_KEY` | produção | Segredo incluído na URL de notificações |

Gerar valores aleatórios:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"     # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"  # demais segredos
```

> **Importante:** guarde a `ENCRYPTION_KEY` com segurança. Se ela for perdida ou trocada, os tokens salvos não poderão ser lidos e será preciso reconectar o Mercado Livre e redigitar os segredos dos fornecedores.

## 2. Banco de dados

### Supabase
1. Crie o projeto em supabase.com.
2. Em *Project Settings › Database › Connection string*, copie a URI (modo *Session* ou conexão direta, porta 5432) para `DATABASE_URL` e use `DATABASE_SSL=true`.
3. Rode `npm run db:migrate`.

A migração ativa RLS em todas as tabelas e revoga o acesso dos papéis `anon` e `authenticated`: a API REST pública do Supabase não expõe nenhum dado. O DropFlow acessa o banco apenas pelo servidor.

### PostgreSQL local
```bash
createdb dropflow
npm run db:migrate
```

Migrações ficam em `db/migrations/` (versionadas e aplicadas em ordem; a tabela `schema_migrations` registra o que já rodou).

## 3. Primeiro administrador

Abra `/setup`, informe o `SETUP_TOKEN`, nome, e-mail e senha (mín. 10 caracteres com letras e números). Após o primeiro cadastro a página é bloqueada.

Alternativa pela linha de comando:
```bash
ADMIN_PASSWORD='SuaSenhaForte123' npm run db:seed-admin -- voce@empresa.com "Seu Nome"
```

## 4. Executar

```bash
npm run build && npm start     # aplicação
npm run worker                 # fila de tarefas (processo contínuo)
```

### Fila de tarefas (obrigatória em produção)

Pedidos, envios, reclamações, encaminhamentos e alertas de prazo são processados por uma fila no próprio PostgreSQL. Escolha uma opção:

- **Servidor/VPS (recomendado):** mantenha `npm run worker` rodando (systemd, PM2, Docker).
- **Hospedagem serverless (ex.: Vercel):** o webhook já processa a fila logo após receber cada notificação; além disso, agende chamadas a `GET /api/cron/process` com o cabeçalho `Authorization: Bearer <CRON_SECRET>` a cada 1–5 minutos (cron da hospedagem ou um agendador externo gratuito). Atenção: o plano gratuito da Vercel limita a frequência de cron — nesse caso use um agendador externo.

## 5. Testes

```bash
createdb dropflow_test                # banco separado, é recriado a cada execução
npm test                              # TEST_DATABASE_URL pode sobrescrever o banco de teste
npm run lint                          # verificação de tipos
```

## 6. Saúde

`GET /api/health` retorna o estado do banco e quantas tarefas estão atrasadas na fila (útil para monitoramento gratuito, ex.: UptimeRobot).
