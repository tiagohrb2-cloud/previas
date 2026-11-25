# Rota Mídia: plano de ação

Bag de 80 L com tela de 15,6", 10 anúncios de até 28 s, R$ 250/mês por anúncio (+R$ 100 com vídeo), R$ 450/mês para o motoboy.

## 1. Mostrar ao cliente onde a bag roda (custo zero)

| Opção | Custo | Como funciona | Para quê |
|---|---|---|---|
| **Site da Rota Mídia** (esta pasta, no GitHub Pages) | R$ 0 | Mapa com as rotas, km, horas e exibições estimadas. Link por cliente: `.../rota-midia/?cliente=Nome` | Relatório mensal e prova de venda |
| **Página de gravar rota** (`registrar.html`) | R$ 0 | O motoboy aperta "Começar" / "Encerrar" e manda a rota pelo WhatsApp | Rotas do dia a dia |
| **App GPS Logger (Android) ou Geo Tracker** | R$ 0 | Grava no bolso, com a tela desligada; exporta .gpx, que entra pela mesma página | Quando o celular não fica com a tela ligada |
| **Compartilhar localização no Google Maps / WhatsApp** | R$ 0 | Localização ao vivo por algumas horas | Para um cliente grande ver ao vivo em uma reunião |
| **Foto e vídeo da bag na rua** | R$ 0 | 1 vídeo curto por semana com a tela e o anúncio aparecendo, com data e local | A prova que o cliente mais acredita; também vira post no Instagram |

Como atualizar o mapa: cole a rota recebida no WhatsApp dentro de `rotas.json`, na bag certa, em `"rotas": [...]`. Quando houver dados reais, mude `"exemplo": true` para `false`. Coloque o WhatsApp comercial na linha `const WHATSAPP = ""` do `index.html` para o botão "Anunciar" aparecer.

Mais tarde (quando tiver mais de 5 bags): rastreamento ao vivo com Traccar (gratuito, código aberto) ou um banco gratuito (Firebase/Supabase). Isso já envolve servidor e login, então deixe para depois.

## 2. O que as simulações mostraram

Premissas (mude em `simulacao.py` ou no `simulador.html`): chip 4G R$ 50 + manutenção R$ 40 por bag por mês; bag montada por R$ 2.200; videomaker R$ 50 por vídeo.

- **Custo de uma bag na rua: R$ 540/mês.** Com **3 anúncios** a bag já se paga. Cheia (10 anúncios) ela dá **~R$ 1.960/mês de lucro**.
- **Cada anúncio passa ~12,9 vezes por hora.** Com 8 h por dia, são **~2.670 exibições por mês**, ou cerca de R$ 93 por mil exibições. Use isso na venda.
- Com 50% das vagas vendidas, a bag se paga em **~3 meses**.

Lucro por mês, por número de bags e vagas vendidas:

| Bags | 30% | 50% | 70% | 90% |
|---|---|---|---|---|
| 1 | 210 | 710 | 1.210 | 1.710 |
| 3 | 630 | 2.130 | 3.630 | 5.130 |
| 5 | 1.050 | 3.550 | 6.050 | 8.550 |
| 10 | 2.100 | 7.100 | 12.100 | 17.100 |

12 meses sorteando vendas e cancelamentos (5.000 rodadas cada):

| Cenário | Lucro no mês 12 (provável) | Caixa em 12 meses (provável) | Chance de fechar o ano no positivo |
|---|---|---|---|
| A. Devagar: 2 bags, 1–3 vendas/mês, 15% cancelam | R$ 1.715 | R$ 6.500 | 95% |
| B. Realista: 2 bags, 2–5 vendas/mês, cresce até 6 bags | R$ 4.170 | R$ 21.900 | 100% |
| C. Agressivo: 3 bags, 4–8 vendas/mês, cresce até 15 | R$ 8.170 | R$ 44.400 | 100% |
| D. Pacote R$ 200 com contrato de 3 meses, 3–6 vendas/mês | R$ 4.660 | R$ 20.600 | 100% |
| E. Ruim: 3 bags, 0–2 vendas/mês, 20% cancelam | R$ -370 | R$ -15.700 | 0% |

O que decide o negócio não é o preço, é **vender pelo menos 2 anúncios novos por mês e segurar o cancelamento abaixo de 10%**. O cenário E mostra o risco: colocar bag na rua antes de ter anunciante.

## 3. Plano de ação

**Semana 1 – prova**
1. Publicar o site (já está nesta pasta) e testar o `registrar.html` com cada motoboy.
2. Combinar com os motoboys: gravar a rota todo dia que a tela estiver ligada (pode entrar como condição dos R$ 450).
3. Gravar 1 vídeo da bag rodando por motoboy, com o anúncio aparecendo.

**Semanas 2 a 4 – venda**
4. Lista de 40 comércios nos bairros por onde as bags já passam (o mapa mostra quais). Restaurantes, lojas, academias, clínicas, imobiliárias.
5. Oferta de entrada: **3 meses por R$ 200/mês** (cenário D) ou primeiro mês com vídeo grátis. Contrato mínimo reduz cancelamento.
6. Pacotes: 1 bag R$ 250 · 3 bags R$ 650 · 5 bags R$ 1.000 (o cliente aparece em mais ruas; vocês enchem as bags mais rápido).
7. Todo cliente recebe o link `?cliente=Nome` e um resumo no fim do mês: km, horas, exibições, fotos.

**Mês 2 em diante – crescer com regra**
8. Só montar uma bag nova quando as que estão na rua passarem de **70% das vagas vendidas** e houver caixa para pagá-la.
9. Medir todo mês: vagas vendidas, cancelamentos, horas de tela ligada por bag, vendas novas. Se cancelamento passar de 10%, parar de crescer e descobrir o motivo.
10. Reajustar o preço quando a lista de espera aparecer (bags cheias), não antes.

**Cuidados**
- Ver na prefeitura se a cidade exige licença para publicidade móvel.
- Contrato simples com o motoboy (horas mínimas, cuidado com a bag, gravação da rota) e com o anunciante (prazo, troca de arte, cancelamento).
- Dados do mapa mostram rota de pessoas: só publicar as rotas durante o trabalho e avisar os motoboys por escrito.
