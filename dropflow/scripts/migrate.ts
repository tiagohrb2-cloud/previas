import "./load-env";
import { pool, closePool } from "../src/lib/db";
import { migrate } from "../src/lib/migrate";

migrate(pool())
  .then(() => console.log("Banco de dados atualizado."))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closePool);
