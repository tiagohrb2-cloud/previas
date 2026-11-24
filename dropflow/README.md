# DropFlow

Plataforma própria de dropshipping nacional: conecta fornecedores brasileiros à sua conta do Mercado Livre, importa catálogos, calcula preço e lucro, publica anúncios e automatiza o processamento dos pedidos — do pagamento à entrega.

- **Idioma:** português (Brasil) · **Moeda:** BRL · **Fuso:** America/Sao_Paulo
- **Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL (compatível com Supabase) · API oficial do Mercado Livre
- **Custo de software:** apenas bibliotecas gratuitas e de código aberto. Nenhum serviço pago obrigatório.

## Comece por aqui

| Documento | Conteúdo |
|---|---|
| **[docs/INSTALACAO_GRATUITA.md](docs/INSTALACAO_GRATUITA.md)** | **Instalação sem custo, feita pelo celular (Supabase + Render + cron-job.org) e app na tela inicial** |
| [docs/INSTALACAO.md](docs/INSTALACAO.md) | Instalação local e em servidor próprio |
| [docs/MANUAL.md](docs/MANUAL.md) | Manual de utilização de cada tela |
| [docs/MERCADO_LIVRE.md](docs/MERCADO_LIVRE.md) | Como criar o aplicativo e conectar a conta do Mercado Livre |
| [docs/FORNECEDORES.md](docs/FORNECEDORES.md) | Como cadastrar fornecedores e configurar integrações |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Arquitetura, módulos, banco de dados, segurança e como estender |
| [docs/STATUS.md](docs/STATUS.md) | **O que está pronto, o que foi testado e o que depende de integração externa** |

## Início rápido (modo teste)

```bash
cd dropflow
npm install
cp .env.example .env.local        # preencha DATABASE_URL, ENCRYPTION_KEY, SETUP_TOKEN
npm run db:migrate
npm run dev                       # http://localhost:3000 → /setup cria o administrador
npm run worker                    # em outro terminal: processa a fila de tarefas
npm test                          # 45 testes automatizados (requer PostgreSQL de teste)
```

No **modo teste** o sistema usa um marketplace e um fornecedor simulados: dá para importar catálogo, publicar, simular vendas, rastreamento, cancelamentos e devoluções sem tocar em nada real.

## Regra de ouro

O DropFlow **não finge integrações**. O que depende de credenciais ou documentação externa está implementado, isolado e sinalizado — veja [docs/STATUS.md](docs/STATUS.md).
