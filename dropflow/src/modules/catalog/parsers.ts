import Papa from "papaparse";
import { XMLParser } from "fast-xml-parser";
import ExcelJS from "exceljs";
import { rowsToProducts, type MappingOptions } from "./mapping";
import type { ParseResult } from "./types";

export type FileFormat = "csv" | "xml" | "xlsx" | "json";

export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

export function detectFormat(fileName: string): FileFormat | null {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "csv" || ext === "txt") return "csv";
  if (ext === "xml") return "xml";
  if (ext === "xlsx") return "xlsx";
  if (ext === "json") return "json";
  return null;
}

export interface RawTable {
  headers: string[];
  rows: Record<string, unknown>[];
}

export function parseCsv(text: string): RawTable {
  const clean = text.replace(/^﻿/, "");
  const res = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [";", ",", "\t", "|"],
    transformHeader: (h) => h.trim(),
  });
  return { headers: res.meta.fields ?? [], rows: res.data };
}

/** Achata um nó XML: { a: { b: 1 } } -> { "a.b": 1 }, mantendo também as chaves simples. */
function flatten(obj: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = v as Record<string, unknown>;
      if ("#text" in inner && Object.keys(inner).length <= 2) out[key] = inner["#text"];
      else flatten(inner, key, out);
    } else if (Array.isArray(v)) {
      if (v.every((x) => typeof x !== "object")) out[key] = v.join("|");
      else out[key] = v;
    } else {
      out[key] = v;
    }
    if (prefix && out[k] === undefined && typeof v !== "object") out[k] = v;
  }
  return out;
}

/** Encontra a maior lista de nós repetidos (os itens do catálogo). */
function findItemArray(node: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 6 || !node || typeof node !== "object") return null;
  let best: Record<string, unknown>[] | null = null;
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object")) {
      if (!best || v.length > best.length) best = v as Record<string, unknown>[];
    } else if (v && typeof v === "object") {
      const inner = findItemArray(v, depth + 1);
      if (inner && (!best || inner.length > best.length)) best = inner;
    }
  }
  return best;
}

/**
 * XML genérico de catálogo, incluindo feeds no padrão Google Merchant (RSS com g:*),
 * formato documentado e comum entre fornecedores. Itens com lista de variações
 * internas (<variacoes><variacao>) são expandidos em linhas com SKU pai.
 */
export function parseXml(text: string): RawTable {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => ["item", "produto", "product", "variacao", "variation", "entry", "imagem"].includes(name),
    processEntities: true,
  });
  const doc = parser.parse(text);
  let items = findItemArray(doc);
  if (!items) {
    // documento com um único item
    const values = Object.values(doc ?? {}).filter((x) => x && typeof x === "object") as Record<string, unknown>[];
    items = values.length ? [values[0]] : [];
  }
  const rows: Record<string, unknown>[] = [];
  for (const item of items) {
    const variationsKey = Object.keys(item).find((k) => /^(variacoes|variações|variations|variants)$/i.test(k));
    const variationsNode = variationsKey ? (item[variationsKey] as Record<string, unknown>) : undefined;
    const variations = variationsNode ? findItemArray({ v: variationsNode }) ?? (Object.values(variationsNode)[0] as Record<string, unknown>[]) : null;
    const base = { ...item };
    if (variationsKey) delete base[variationsKey];
    const flatBase = flatten(base);
    if (Array.isArray(variations) && variations.length) {
      const parentSku = flatBase["sku"] ?? flatBase["codigo"] ?? flatBase["id"] ?? flatBase["g:id"];
      for (const v of variations) rows.push({ ...flatBase, ...flatten(v), sku_pai: parentSku });
    } else {
      rows.push(flatBase);
    }
  }
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return { headers, rows };
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<RawTable> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cell.text ?? "").trim();
  });
  const rows: Record<string, unknown>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (!h) return;
      const cell = row.getCell(i + 1);
      const v = cell.value;
      obj[h] = v && typeof v === "object" && "hyperlink" in v ? (v as { hyperlink: string }).hyperlink : typeof v === "number" ? v : cell.text;
    });
    rows.push(obj);
  });
  return { headers: headers.filter(Boolean), rows };
}

export function parseJson(text: string): RawTable {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : findItemArray(data) ?? [];
  const rows = arr.map((x: Record<string, unknown>) => flatten(x));
  return { headers: [...new Set(rows.flatMap((r: Record<string, unknown>) => Object.keys(r)))] as string[], rows };
}

export async function readTable(fileName: string, content: ArrayBuffer): Promise<RawTable> {
  if (content.byteLength > MAX_IMPORT_BYTES) throw new Error("Arquivo maior que 15 MB.");
  const format = detectFormat(fileName);
  if (!format) throw new Error("Formato não suportado. Use CSV, XML, XLSX ou JSON.");
  if (format === "xlsx") return parseXlsx(content);
  const text = new TextDecoder("utf-8").decode(content);
  if (format === "csv") return parseCsv(text);
  if (format === "xml") return parseXml(text);
  return parseJson(text);
}

export async function parseCatalogFile(fileName: string, content: ArrayBuffer, opts: MappingOptions = {}): Promise<ParseResult & { headers: string[] }> {
  const table = await readTable(fileName, content);
  return { ...rowsToProducts(table.rows, opts, table.headers), headers: table.headers };
}
