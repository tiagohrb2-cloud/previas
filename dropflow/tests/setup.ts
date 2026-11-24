// Ambiente isolado para testes: banco dropflow_test e chave de teste.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://dropflow:dropflow@localhost:5432/dropflow_test";
process.env.DATABASE_SSL = "false";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.APP_URL = "http://localhost:3000";
process.env.ML_CLIENT_ID = "test-client-id";
process.env.ML_CLIENT_SECRET = "test-client-secret";
process.env.ML_WEBHOOK_KEY = "test-webhook-key";
process.env.CRON_SECRET = "test-cron-secret";
