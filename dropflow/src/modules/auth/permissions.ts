export type Role = "admin" | "operator" | "viewer";

/**
 * Controle de permissões por papel.
 * - admin: tudo, incluindo modo de operação, automações, integrações e usuários.
 * - operator: operação diária (produtos, importação, pedidos, problemas).
 * - viewer: somente leitura.
 */
export const PERMISSIONS = {
  "dashboard.view": ["admin", "operator", "viewer"],
  "products.view": ["admin", "operator", "viewer"],
  "products.edit": ["admin", "operator"],
  "import.run": ["admin", "operator"],
  "suppliers.view": ["admin", "operator", "viewer"],
  "suppliers.edit": ["admin"],
  "listings.view": ["admin", "operator", "viewer"],
  "listings.publish": ["admin", "operator"],
  "orders.view": ["admin", "operator", "viewer"],
  "orders.operate": ["admin", "operator"],
  "orders.view_buyer_data": ["admin", "operator"],
  "issues.view": ["admin", "operator", "viewer"],
  "issues.operate": ["admin", "operator"],
  "finance.view": ["admin", "operator", "viewer"],
  "finance.edit": ["admin"],
  "settings.view": ["admin", "operator", "viewer"],
  "settings.edit": ["admin"],
  "integrations.manage": ["admin"],
  "users.manage": ["admin"],
  "logs.view": ["admin"],
  "simulator.use": ["admin", "operator"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  operator: "Operador",
  viewer: "Visualizador",
};
