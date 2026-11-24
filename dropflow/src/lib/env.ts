import { z } from "zod";

/**
 * Leitura validada das variáveis de ambiente. Nenhum segredo fica no código:
 * tudo vem de .env.local (desenvolvimento) ou das variáveis do provedor (produção).
 */
const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL não configurada"),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
  ENCRYPTION_KEY: z.string().optional(),
  SETUP_TOKEN: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  ML_CLIENT_ID: z.string().optional(),
  ML_CLIENT_SECRET: z.string().optional(),
  ML_WEBHOOK_KEY: z.string().optional(),
  ML_AUTH_URL: z.string().url().default("https://auth.mercadolivre.com.br/authorization"),
  ML_API_URL: z.string().url().default("https://api.mercadolibre.com"),
  ML_SITE_ID: z.string().default("MLB"),
  APP_TIMEZONE: z.string().default("America/Sao_Paulo"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração de ambiente inválida: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Usado em testes para reler o ambiente. */
export function resetEnvCache() {
  cached = null;
}

export function isMercadoLivreConfigured(): boolean {
  const e = env();
  return Boolean(e.ML_CLIENT_ID && e.ML_CLIENT_SECRET);
}
