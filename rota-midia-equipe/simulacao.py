"""Simulação financeira da Rota Mídia (bag de 80 L com tela de 15,6").

Rode com:  python3 rota-midia/simulacao.py
Mude os números em PREMISSAS para testar outros cenários.
"""
import math
import random
import statistics as st

PREMISSAS = dict(
    preco_anuncio=250.0,     # R$/mês por anúncio em uma bag
    adicional_video=100.0,   # R$ cobrado UMA VEZ quando a Rota Mídia produz o vídeo
    custo_video=50.0,        # R$ pago ao videomaker por vídeo (ajuste se for da equipe)
    vagas_por_bag=10,        # 10 anúncios de até 28 s
    motoboy=450.0,           # R$/mês por bag rodando
    chip_4g=50.0,            # R$/mês (troca de conteúdo remota / prova de exibição)
    manutencao=40.0,         # R$/mês reserva para bateria, cabo, conserto
    investimento_bag=1000.0, # R$ por bag montada (bag + tela + player + bateria)
)
P = PREMISSAS


def resultado_mes(bags, ocupacao, pct_video):
    """Resultado de um mês 'parado' (sem crescimento)."""
    anuncios = round(bags * P["vagas_por_bag"] * ocupacao)
    receita = anuncios * P["preco_anuncio"]
    # o vídeo é cobrado uma vez por cliente novo; aqui tratamos como mensal
    receita_video = 0  # vídeo é cobrado uma vez só; entra na simulação de 12 meses
    custo = bags * (P["motoboy"] + P["chip_4g"] + P["manutencao"])
    return anuncios, receita + receita_video, custo, receita + receita_video - custo


def tabela_fixa(preco=None):
    if preco:
        P["preco_anuncio"] = preco
    print(f"\n=== Lucro mensal com anúncio a R$ {P['preco_anuncio']:.0f} (bags x vagas vendidas) ===")
    ocup = [0.2, 0.3, 0.5, 0.7, 0.9, 1.0]
    print("bags | " + " | ".join(f"{int(o*100):>3}% ocup." for o in ocup))
    for b in [1, 2, 3, 5, 10, 20]:
        linha = []
        for o in ocup:
            _, _, _, lucro = resultado_mes(b, o, 0)
            linha.append(f"{lucro:>10,.0f}".replace(",", "."))
        print(f"{b:>4} | " + " | ".join(linha))
    custo_bag = P["motoboy"] + P["chip_4g"] + P["manutencao"]
    print(f"\nCusto por bag/mês: R$ {custo_bag:.0f}  ->  ponto de equilíbrio = "
          f"{custo_bag / P['preco_anuncio']:.2f} anúncios por bag (ou seja, {math.ceil(custo_bag / P['preco_anuncio'])} anúncios já pagam a bag)")
    meses = P["investimento_bag"] / (P["vagas_por_bag"] * 0.5 * P["preco_anuncio"] - custo_bag)
    print(f"Com 50% de ocupação, a bag se paga em {meses:.1f} meses.")


def exibicoes():
    loop = P["vagas_por_bag"] * 28  # segundos
    por_hora = 3600 / loop
    print("\n=== 2. Quantas vezes cada anúncio passa (com a bag cheia) ===")
    print(f"Ciclo de 10 anúncios = {loop} s ({loop/60:.1f} min) -> {por_hora:.1f} vezes por hora")
    for horas in (6, 8, 10):
        mes = por_hora * horas * 26
        print(f"{horas} h/dia x 26 dias = {mes:,.0f} exibições/mês por anúncio "
              f"-> R$ {P['preco_anuncio']/mes*1000:.2f} por mil exibições".replace(",", "."))


def monte_carlo(nome, bags_inicio, nova_bag_cada, max_bags, vendas_mes, churn, pct_video,
                preco=None, rodadas=5000, meses=12, seed=1):
    """Simula 12 meses com vendas e cancelamentos aleatórios.
    vendas_mes = (mín, máx) anúncios novos vendidos por mês
    churn = chance de um anúncio cancelar no mês
    nova_bag_cada = coloca mais uma bag na rua quando ocupação passa de 70%
    """
    rnd = random.Random(seed)
    preco = preco or P["preco_anuncio"]
    finais, caixas, pior_caixa, mes_positivo = [], [], [], []
    for _ in range(rodadas):
        bags, anuncios = bags_inicio, 0
        caixa = -bags * P["investimento_bag"]
        minimo = caixa
        primeiro_pos = None
        for m in range(1, meses + 1):
            # cancelamentos
            anuncios -= sum(1 for _ in range(anuncios) if rnd.random() < churn)
            # vendas novas
            novas = rnd.randint(*vendas_mes)
            vagas = bags * P["vagas_por_bag"]
            anuncios = min(anuncios + novas, vagas)
            receita = anuncios * preco + novas * pct_video * (P["adicional_video"] - P["custo_video"])
            custo = bags * (P["motoboy"] + P["chip_4g"] + P["manutencao"])
            lucro = receita - custo
            caixa += lucro
            if lucro > 0 and primeiro_pos is None:
                primeiro_pos = m
            # expande quando a bag está quase cheia e há caixa
            if anuncios / vagas >= 0.7 and bags < max_bags and caixa > P["investimento_bag"] * nova_bag_cada:
                bags += 1
                caixa -= P["investimento_bag"]
            minimo = min(minimo, caixa)
        finais.append(lucro)
        caixas.append(caixa)
        pior_caixa.append(minimo)
        mes_positivo.append(primeiro_pos or 99)
    q = lambda xs, p: sorted(xs)[int(len(xs) * p)]
    fmt = lambda v: f"R$ {v:,.0f}".replace(",", ".")
    print(f"\n--- {nome} ---")
    print(f"Lucro no mês 12:  pessimista {fmt(q(finais,0.1))} | provável {fmt(st.median(finais))} | otimista {fmt(q(finais,0.9))}")
    print(f"Caixa acumulado em 12 meses (já descontando as bags): pessimista {fmt(q(caixas,0.1))} | "
          f"provável {fmt(st.median(caixas))} | otimista {fmt(q(caixas,0.9))}")
    print(f"Pior momento do caixa (provável): {fmt(st.median(pior_caixa))} | "
          f"mês em que dá lucro (provável): {int(st.median(mes_positivo))}")
    print(f"Chance de terminar o ano com caixa positivo: {sum(c > 0 for c in caixas)/rodadas:.0%}")


def comparar_precos():
    custo_bag = P["motoboy"] + P["chip_4g"] + P["manutencao"]
    print("\n=== 1. Comparando preços (1 bag) ===")
    print("preço | anúncios p/ empatar | lucro bag cheia | lucro com 6 vendidos | R$ por mil exibições (8h/dia)")
    exib = 3600 / 280 * 8 * 26
    for preco in (250, 200, 180, 150, 120, 100):
        print(f"R$ {preco:>3} | {custo_bag/preco:>5.1f} | R$ {10*preco-custo_bag:>6,.0f} | R$ {6*preco-custo_bag:>6,.0f} | R$ {preco/exib*1000:>5.2f}".replace(",", "."))


if __name__ == "__main__":
    comparar_precos()
    exibicoes()
    print("\n=== 3. 12 meses em Araraquara, 5.000 rodadas cada ===")
    print("Hipótese: preço menor vende mais rápido. As faixas de venda abaixo são palpite; troque pelos números reais.")
    monte_carlo("R$ 250 (hoje): vende 1-2/mês, 15% cancelam", 2, 1, 6, (1, 2), 0.15, 0.3, preco=250)
    monte_carlo("R$ 200 com fidelidade de 3 meses: vende 2-3/mês, 8% cancelam", 2, 1, 6, (2, 3), 0.08, 0.4, preco=200)
    monte_carlo("R$ 150 com fidelidade de 3 meses: vende 3-5/mês, 8% cancelam", 2, 1, 8, (3, 5), 0.08, 0.4, preco=150)
    monte_carlo("R$ 120 com fidelidade de 6 meses: vende 4-6/mês, 5% cancelam", 2, 1, 10, (4, 6), 0.05, 0.4, preco=120)
    monte_carlo("R$ 150, mas vende só 1-3/mês (preço baixou e a venda não subiu)", 2, 1, 6, (1, 3), 0.10, 0.3, preco=150)
    monte_carlo("R$ 100: vende 4-7/mês, 10% cancelam", 2, 1, 10, (4, 7), 0.10, 0.4, preco=100)
    for p in (250, 150):
        tabela_fixa(p)
