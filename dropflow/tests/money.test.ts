import { describe, expect, it } from "vitest";
import { parseBRL, formatBRL } from "@/lib/money";
import { encrypt, decrypt, hashPassword, verifyPassword } from "@/lib/crypto";

describe("dinheiro", () => {
  it("interpreta formatos brasileiros e internacionais", () => {
    expect(parseBRL("R$ 1.234,56")).toBe(123456);
    expect(parseBRL("1234,5")).toBe(123450);
    expect(parseBRL("1234.56")).toBe(123456);
    expect(parseBRL("1.234")).toBe(123400);
    expect(parseBRL("12.5")).toBe(1250);
    expect(parseBRL("1,234.56")).toBe(123456);
    expect(parseBRL(30)).toBe(3000);
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("")).toBeNull();
  });
  it("formata BRL", () => {
    expect(formatBRL(6000).replace(/\s/g, " ")).toBe("R$ 60,00");
  });
});

describe("criptografia", () => {
  it("AES-GCM ida e volta e detecção de adulteração", () => {
    const c = encrypt("token-secreto");
    expect(c).not.toContain("token-secreto");
    expect(decrypt(c)).toBe("token-secreto");
    const parts = c.split(".");
    parts[3] = Buffer.from("xxxx").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("hash de senha", async () => {
    const h = await hashPassword("SenhaForte#2026");
    expect(await verifyPassword("SenhaForte#2026", h)).toBe(true);
    expect(await verifyPassword("errada", h)).toBe(false);
  });
});
