import { z } from "zod";

/**
 * Formato normalizado de produto. Todo adaptador de fornecedor (API, arquivo,
 * manual) converte os dados de origem para este formato antes de importar.
 */
export const normalizedVariantSchema = z.object({
  supplierSku: z.string().trim().min(1, "SKU da variação obrigatório"),
  gtin: z.string().trim().optional(),
  attributes: z.record(z.string(), z.string()).default({}), // ex.: { Cor: "Azul", Tamanho: "M" }
  costCents: z.number().int().nonnegative().optional(),
  stock: z.number().int().nonnegative().optional(),
});

export const normalizedProductSchema = z.object({
  supplierSku: z.string().trim().min(1, "SKU obrigatório"),
  title: z.string().trim().min(3, "Nome obrigatório").max(500),
  description: z.string().default(""),
  brand: z.string().trim().optional(),
  gtin: z.string().trim().optional(),
  costCents: z.number().int().nonnegative({ message: "Preço de custo inválido" }),
  weightG: z.number().int().nonnegative().optional(),
  lengthCm: z.number().nonnegative().optional(),
  widthCm: z.number().nonnegative().optional(),
  heightCm: z.number().nonnegative().optional(),
  images: z.array(z.string().url()).default([]),
  attributes: z.record(z.string(), z.string()).default({}), // características técnicas
  category: z.string().optional(),
  stock: z.number().int().nonnegative().optional(),
  variants: z.array(normalizedVariantSchema).default([]),
});

export type NormalizedProduct = z.infer<typeof normalizedProductSchema>;
export type NormalizedVariant = z.infer<typeof normalizedVariantSchema>;

export interface RowError {
  row: number;
  sku?: string;
  message: string;
}

export interface ParseResult {
  products: NormalizedProduct[];
  errors: RowError[];
  totalRows: number;
}

/** GTIN válido (EAN-8, UPC-12, EAN-13, GTIN-14) pelo dígito verificador. */
export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
