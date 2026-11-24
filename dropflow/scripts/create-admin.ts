import "./load-env";
import { createUser } from "../src/modules/auth/service";
import { closePool } from "../src/lib/db";

/**
 * Cria um administrador pela linha de comando (alternativa à página /setup).
 * Uso: ADMIN_PASSWORD='...' npm run db:seed-admin -- email@empresa.com "Nome"
 */
const [email, name] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
if (!email || !name || !password) {
  console.error('Uso: ADMIN_PASSWORD="senha" npm run db:seed-admin -- email@empresa.com "Nome"');
  process.exit(1);
}
createUser({ email, name, password, role: "admin" }, null)
  .then(() => console.log("Administrador criado."))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closePool);
