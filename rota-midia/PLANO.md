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

## 2. O que as simulações mostraram (Araraquara)

Premissas (mude em `simulacao.py` ou no `simulador.html`): bag montada por R$ 1.000; motoboy R$ 450; chip 4G R$ 50 + manutenção R$ 40 por bag por mês; vídeo cobrado **uma vez** (R$ 100, pagando R$ 50 ao videomaker).

- **Cada bag na rua custa R$ 540/mês.** Cada anúncio passa ~12,9 vezes por hora, ou ~2.670 vezes por mês com 8 h/dia de tela ligada.
- Com a bag a R$ 1.000, o investimento deixa de ser o problema: o que pesa é o **custo fixo do motoboy**.

Se o preço do anúncio cair, quanto muda (1 bag):

| Preço | Anúncios para empatar | Lucro com 6 vendidos | Lucro com a bag cheia |
|---|---|---|---|
| R$ 250 | 3 | R$ 960 | R$ 1.960 |
| R$ 200 | 3 | R$ 660 | R$ 1.460 |
| R$ 180 | 3 | R$ 540 | R$ 1.260 |
| R$ 150 | 4 | R$ 360 | R$ 960 |
| R$ 120 | 5 | R$ 180 | R$ 660 |
| R$ 100 | 6 | R$ 60 | R$ 460 |

12 meses começando com 2 bags (5.000 rodadas cada). **As vendas por mês são um palpite**: preço menor deve vender mais rápido, mas isso precisa ser testado.

| Cenário | Lucro no mês 12 (provável) | Caixa em 12 meses (provável) | Chance de fechar o ano no positivo |
|---|---|---|---|
| R$ 250 (hoje), vende 1–2/mês | R$ 950 | R$ 3.000 | 84% |
| **R$ 200 com fidelidade de 3 meses**, vende 2–3/mês | R$ 2.240 | R$ 11.100 | 100% |
| **R$ 150 com fidelidade de 3 meses**, vende 3–5/mês | R$ 2.180 | R$ 11.000 | 100% |
| R$ 120 com fidelidade de 6 meses, vende 4–6/mês | R$ 1.880 | R$ 7.200 | 100% |
| R$ 100, vende 4–7/mês | R$ 780 | R$ 2.100 | 100% |
| R$ 150, mas a venda não sobe (1–3/mês) | R$ 900 | R$ 1.100 | 75% |

Conclusões:
- **Baixar para R$ 150–200 só vale com fidelidade** (mínimo de 3 meses). Sem fidelidade, o desconto vira só menos dinheiro.
- **Abaixo de R$ 120 não compensa:** precisa de 5 ou 6 anúncios só para pagar o motoboy.
- O que mais melhora o resultado é **reduzir o cancelamento**, mais do que o preço.

### Nova tabela de preços sugerida

| Plano | Preço por mês | Para quem |
|---|---|---|
| Teste 15 dias (só para os 3 primeiros clientes) | grátis, em troca de depoimento e foto | Criar prova em Araraquara |
| Mensal sem fidelidade | R$ 250 | Fica de âncora: faz o plano trimestral parecer barato |
| Trimestral | R$ 180 | O plano que vocês querem vender |
| Semestral | R$ 150 | Cliente que já gostou |
| Mais bags (3 bags) | R$ 450 (R$ 150 cada) | Comércio que quer aparecer na cidade toda |
| Vídeo | R$ 100 uma vez | Grátis no semestral |

## 3. Plano de ação

**Semana 1 – prova**
1. Publicar o site (já está nesta pasta) e testar o `registrar.html` com cada motoboy.
2. Combinar com os motoboys: gravar a rota todo dia que a tela estiver ligada (pode entrar como condição dos R$ 450).
3. Gravar 1 vídeo da bag rodando por motoboy, com o anúncio aparecendo.

**Semanas 2 a 4 – venda**
4. Lista de 40 comércios de Araraquara nos bairros por onde as bags já passam (o mapa mostra quais). Restaurantes, lojas, academias, clínicas, imobiliárias.
5. Vender pela nova tabela: âncora R$ 250, vender o trimestral de R$ 180. Os 3 primeiros clientes ganham 15 dias de teste em troca de depoimento.
6. Bons alvos em Araraquara: imobiliárias, autoescolas, academias, clínicas e dentistas, cursinhos e faculdades particulares, lojas de bairro e eventos da cidade.
7. Todo cliente recebe o link `?cliente=Nome` e um resumo no fim do mês: km, horas, exibições, fotos.

**Mês 2 em diante – crescer com regra**
8. Só montar uma bag nova quando as que estão na rua passarem de **70% das vagas vendidas** e houver caixa para pagá-la.
9. Medir todo mês: vagas vendidas, cancelamentos, horas de tela ligada por bag, vendas novas. Se cancelamento passar de 10%, parar de crescer e descobrir o motivo.
10. Reajustar o preço quando a lista de espera aparecer (bags cheias), não antes.

**Cuidados**
- Ver na prefeitura se a cidade exige licença para publicidade móvel.
- Contrato simples com o motoboy (horas mínimas, cuidado com a bag, gravação da rota) e com o anunciante (prazo, troca de arte, cancelamento).
- Dados do mapa mostram rota de pessoas: só publicar as rotas durante o trabalho e avisar os motoboys por escrito.
