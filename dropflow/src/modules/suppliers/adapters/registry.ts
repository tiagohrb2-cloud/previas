import { fileAdapter, manualAdapter } from "./manual";
import { restAdapter } from "./rest";
import { simulatedAdapter } from "./simulated";
import type { IntegrationType, SupplierAdapter } from "./types";

/** Registro de adaptadores. Novos fornecedores com integração própria entram aqui. */
const ADAPTERS: Record<IntegrationType, SupplierAdapter> = {
  manual: manualAdapter,
  file: fileAdapter,
  rest: restAdapter,
  simulated: simulatedAdapter,
};

export function getAdapter(type: IntegrationType): SupplierAdapter {
  const a = ADAPTERS[type];
  if (!a) throw new Error(`Tipo de integração desconhecido: ${type}`);
  return a;
}

export function listAdapters(): SupplierAdapter[] {
  return Object.values(ADAPTERS);
}
