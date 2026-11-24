import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { parseCatalogFile } from "@/modules/catalog/parsers";
import { isValidGtin } from "@/modules/catalog/types";

const buf = (p: string) => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("importação por arquivo", () => {
  it("CSV com ponto e vírgula, variações, preço BR e erros por linha", async () => {
    const r = await parseCatalogFile("catalogo.csv", buf("tests/fixtures/catalogo.csv"));
    expect(r.products).toHaveLength(2);
    const cam = r.products.find((p) => p.supplierSku === "CAM-001")!;
    expect(cam.variants).toHaveLength(2);
    expect(cam.variants[0]).toMatchObject({ supplierSku: "CAM-001-P", attributes: { Cor: "Azul", Tamanho: "P" }, costCents: 2990, stock: 10 });
    expect(cam.costCents).toBe(2990);
    expect(cam.weightG).toBe(200);
    expect(cam.images).toEqual(["https://exemplo.com/a.jpg", "https://exemplo.com/b.jpg"]);
    expect(cam.attributes.Material).toBe("Algodão");
    const gar = r.products.find((p) => p.supplierSku === "GAR-500")!;
    expect(gar.gtin).toBe("7891234567895");
    expect(gar.stock).toBe(30);
    expect(gar.costCents).toBe(4500);
    expect(r.errors.some((e) => e.sku === "SEM-PRECO")).toBe(true);
  });

  it("feed XML padrão Google Merchant agrupa variações por item_group_id", async () => {
    const r = await parseCatalogFile("feed.xml", buf("tests/fixtures/feed-google.xml"));
    expect(r.errors).toEqual([]);
    expect(r.products).toHaveLength(1);
    const p = r.products[0];
    expect(p.supplierSku).toBe("TEN");
    expect(p.costCents).toBe(11990);
    expect(p.brand).toBe("Marca Z");
    expect(p.variants.map((v) => v.attributes.Tamanho)).toEqual(["38", "39"]);
    expect(p.images).toContain("https://exemplo.com/t2.jpg");
  });

  it("XLSX", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Produtos");
    ws.addRow(["SKU", "Nome", "Preço", "Estoque", "Marca"]);
    ws.addRow(["X1", "Fone Bluetooth", 59.9, 12, "Som"]);
    const out = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const r = await parseCatalogFile("p.xlsx", out);
    expect(r.products[0]).toMatchObject({ supplierSku: "X1", title: "Fone Bluetooth", costCents: 5990, stock: 12, brand: "Som" });
  });

  it("mapeamento manual de colunas", async () => {
    const csv = new TextEncoder().encode("codigo_interno,descr,vlr\nA1,Produto A,10,50\n").buffer as ArrayBuffer;
    const r = await parseCatalogFile("x.csv", csv, { mapping: { sku: "codigo_interno", title: "descr", cost: "vlr" } });
    expect(r.products[0]).toMatchObject({ supplierSku: "A1", title: "Produto A" });
  });

  it("acusa colunas obrigatórias ausentes", async () => {
    const csv = new TextEncoder().encode("a,b\n1,2\n").buffer as ArrayBuffer;
    const r = await parseCatalogFile("x.csv", csv);
    expect(r.products).toHaveLength(0);
    expect(r.errors[0].message).toMatch(/SKU/);
  });

  it("valida GTIN", () => {
    expect(isValidGtin("7891234567895")).toBe(true);
    expect(isValidGtin("7891234567890")).toBe(false);
  });
});
