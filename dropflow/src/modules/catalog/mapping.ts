import { parseBRL } from "@/lib/money";
import { isValidGtin, normalizedProductSchema, type NormalizedProduct, type ParseResult, type RowError } from "./types";

/**
 * Mapeamento de colunas de planilhas/feeds para o formato normalizado.
 * Cabeçalhos comuns em português e inglês são reconhecidos automaticamente;
 * o usuário pode sobrescrever o mapeamento na tela de importação.
 */
export type Field =
  | "sku" | "parentSku" | "title" | "description" | "brand" | "gtin" | "cost" | "stock"
  | "weight" | "length" | "width" | "height" | "images" | "color" | "size" | "category";

export type ColumnMapping = Partial<Record<Field, string>>;

export interface MappingOptions {
  mapping?: ColumnMapping;
  weightUnit?: "kg" | "g";
  imageSeparator?: string;
}

const ALIASES: Record<Field, string[]> = {
  sku: ["sku", "codigo", "código", "cod", "referencia", "referência", "ref", "id", "g:id", "codigo_produto", "sku_variacao"],
  parentSku: ["sku_pai", "skupai", "produto_pai", "parent_sku", "item_group_id", "g:item_group_id", "codigo_pai", "agrupador"],
  title: ["nome", "titulo", "título", "produto", "descricao_curta", "title", "name", "g:title"],
  description: ["descricao", "descrição", "descricao_completa", "description", "g:description", "detalhes"],
  brand: ["marca", "brand", "fabricante", "g:brand"],
  gtin: ["ean", "gtin", "codigo_barras", "código_de_barras", "codigo_de_barras", "barcode", "upc", "g:gtin"],
  cost: ["preco_custo", "preço_custo", "custo", "preco", "preço", "valor", "preco_atacado", "cost", "price", "g:price", "valor_custo"],
  stock: ["estoque", "quantidade", "qtd", "saldo", "stock", "quantity", "disponivel", "disponível"],
  weight: ["peso", "peso_kg", "peso_g", "weight", "g:shipping_weight", "peso_bruto"],
  length: ["comprimento", "profundidade", "length", "comprimento_cm"],
  width: ["largura", "width", "largura_cm"],
  height: ["altura", "height", "altura_cm"],
  images: ["imagens", "imagem", "fotos", "foto", "images", "image", "image_link", "g:image_link", "url_imagem", "imagem_principal"],
  color: ["cor", "color", "g:color", "cores"],
  size: ["tamanho", "size", "g:size", "numeracao", "numeração"],
  category: ["categoria", "category", "g:product_type", "departamento"],
};

export const FIELD_LABELS: Record<Field, string> = {
  sku: "SKU", parentSku: "SKU do produto pai (variações)", title: "Nome", description: "Descrição",
  brand: "Marca", gtin: "Código de barras (EAN/GTIN)", cost: "Preço de custo", stock: "Estoque",
  weight: "Peso", length: "Comprimento (cm)", width: "Largura (cm)", height: "Altura (cm)",
  images: "Imagens (URLs)", color: "Cor", size: "Tamanho", category: "Categoria",
};

const ADDITIONAL_IMAGE_KEYS = ["g:additional_image_link", "additional_image_link", "imagem_2", "imagem_3", "imagem_4", "imagem_5", "imagem2", "imagem3", "imagem4", "imagem5"];

function norm(h: string) {
  return h.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_");
}

export function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalized = headers.map((h) => ({ raw: h, n: norm(h) }));
  for (const field of Object.keys(ALIASES) as Field[]) {
    const aliases = ALIASES[field].map(norm);
    const hit = normalized.find((h) => aliases.includes(h.n));
    if (hit) mapping[field] = hit.raw;
  }
  // "descricao" pode ter sido usada como título se não houver coluna de nome
  if (mapping.title && mapping.title === mapping.description) delete mapping.description;
  return mapping;
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const s = String(v).trim().replace(/[^\d,.-]/g, "");
  if (!s) return undefined;
  const cents = parseBRL(s);
  return cents === null ? undefined : cents / 100;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function splitImages(v: unknown, sep?: string): string[] {
  const s = str(v);
  if (!s) return [];
  const parts = sep ? s.split(sep) : s.split(/[|;,\s]+(?=https?:\/\/)|\s*[|;]\s*/);
  return parts.map((p) => p.trim()).filter((p) => /^https?:\/\/\S+$/i.test(p));
}

/** Colunas com prefixo attr_/caracteristica_ viram características técnicas. */
function extraAttributes(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const m = k.match(/^(attr|atributo|caracteristica|característica|spec)[_:\s-](.+)$/i);
    const val = str(v);
    if (m && val) out[m[2].trim()] = val;
  }
  return out;
}

/**
 * Converte linhas (objetos coluna→valor) em produtos normalizados.
 * Linhas com o mesmo "SKU pai" são agrupadas como variações de um produto.
 */
export function rowsToProducts(rows: Record<string, unknown>[], opts: MappingOptions = {}, headers?: string[]): ParseResult {
  const mapping = { ...autoDetectMapping(headers ?? Object.keys(rows[0] ?? {})), ...(opts.mapping ?? {}) };
  const errors: RowError[] = [];
  const get = (row: Record<string, unknown>, f: Field) => (mapping[f] ? row[mapping[f]!] : undefined);
  const groups = new Map<string, { first: number; rows: { idx: number; row: Record<string, unknown> }[] }>();

  if (!mapping.sku) errors.push({ row: 0, message: "Coluna de SKU não identificada. Ajuste o mapeamento." });
  if (!mapping.title) errors.push({ row: 0, message: "Coluna de nome do produto não identificada. Ajuste o mapeamento." });
  if (!mapping.cost) errors.push({ row: 0, message: "Coluna de preço de custo não identificada. Ajuste o mapeamento." });
  if (errors.length) return { products: [], errors, totalRows: rows.length };

  rows.forEach((row, i) => {
    const sku = str(get(row, "sku"));
    const rowNumber = i + 2; // linha 1 = cabeçalho
    if (!sku) {
      if (Object.values(row).some((v) => str(v))) errors.push({ row: rowNumber, message: "SKU vazio" });
      return;
    }
    const key = str(get(row, "parentSku")) ?? sku;
    const g = groups.get(key) ?? { first: rowNumber, rows: [] };
    g.rows.push({ idx: rowNumber, row });
    groups.set(key, g);
  });

  const products: NormalizedProduct[] = [];
  for (const [parentKey, g] of groups) {
    const base = g.rows[0].row;
    const isVariantGroup = g.rows.length > 1 || Boolean(str(get(base, "parentSku")));
    const weight = num(get(base, "weight"));
    const weightUnit = opts.weightUnit ?? (mapping.weight && /_g$|gramas/i.test(mapping.weight) ? "g" : "kg");
    const gtin = str(get(base, "gtin"))?.replace(/\D/g, "");
    const images = new Set<string>();
    for (const { row } of g.rows) {
      splitImages(get(row, "images"), opts.imageSeparator).forEach((u) => images.add(u));
      for (const k of ADDITIONAL_IMAGE_KEYS) splitImages(row[k], opts.imageSeparator).forEach((u) => images.add(u));
    }
    const costOf = (row: Record<string, unknown>) => {
      const c = num(get(row, "cost"));
      return c === undefined ? undefined : Math.round(c * 100);
    };
    const stockOf = (row: Record<string, unknown>) => {
      const s = num(get(row, "stock"));
      return s === undefined ? undefined : Math.max(0, Math.floor(s));
    };
    const attributes: Record<string, string> = { ...extraAttributes(base) };
    const variants = isVariantGroup
      ? g.rows.map(({ row }) => {
          const va: Record<string, string> = {};
          const color = str(get(row, "color"));
          const size = str(get(row, "size"));
          if (color) va["Cor"] = color;
          if (size) va["Tamanho"] = size;
          const vg = str(get(row, "gtin"))?.replace(/\D/g, "");
          return {
            supplierSku: str(get(row, "sku"))!,
            gtin: vg && isValidGtin(vg) ? vg : undefined,
            attributes: va,
            costCents: costOf(row),
            stock: stockOf(row),
          };
        })
      : [];
    if (!isVariantGroup) {
      const color = str(get(base, "color"));
      const size = str(get(base, "size"));
      if (color) attributes["Cor"] = color;
      if (size) attributes["Tamanho"] = size;
    }
    const costs = variants.map((v) => v.costCents).filter((c): c is number => c !== undefined);
    const candidate = {
      supplierSku: isVariantGroup ? parentKey : str(get(base, "sku")),
      title: str(get(base, "title")),
      description: str(get(base, "description")) ?? "",
      brand: str(get(base, "brand")),
      gtin: !isVariantGroup && gtin && isValidGtin(gtin) ? gtin : undefined,
      costCents: isVariantGroup && costs.length ? Math.min(...costs) : costOf(base),
      weightG: weight === undefined ? undefined : Math.round(weightUnit === "kg" ? weight * 1000 : weight),
      lengthCm: num(get(base, "length")),
      widthCm: num(get(base, "width")),
      heightCm: num(get(base, "height")),
      images: [...images],
      attributes,
      category: str(get(base, "category")),
      stock: isVariantGroup ? undefined : stockOf(base),
      variants,
    };
    const parsed = normalizedProductSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push({ row: g.first, sku: candidate.supplierSku, message: parsed.error.issues.map((i) => i.message).join("; ") });
      continue;
    }
    if (gtin && !isVariantGroup && !isValidGtin(gtin)) {
      errors.push({ row: g.first, sku: candidate.supplierSku, message: `Código de barras ${gtin} inválido (ignorado; produto importado sem EAN)` });
    }
    products.push(parsed.data);
  }
  return { products, errors, totalRows: rows.length };
}
