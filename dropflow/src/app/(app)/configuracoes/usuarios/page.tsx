import { Card, Field, Input, Select, Table, Td, Th, Badge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { requireUser } from "@/modules/auth/session";
import { ROLE_LABELS, type Role } from "@/modules/auth/permissions";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { createUserAction, updateUserAction } from "../actions";

export default async function UsersSettings() {
  const me = await requireUser("users.manage");
  const users = await query<{ id: string; name: string; email: string; role: Role; active: boolean; last_login_at: string | null }>("select id, name, email, role, active, last_login_at from users order by name");
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card title="Usuários" padded={false} className="xl:col-span-2">
        <Table>
          <thead><tr><Th>Nome</Th><Th>Papel</Th><Th>Último acesso</Th><Th>Alterar</Th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <Td><p className="font-medium text-slate-900">{u.name} {!u.active && <Badge tone="neutral">inativo</Badge>}</p><p className="text-xs text-slate-500">{u.email}</p></Td>
                <Td>{ROLE_LABELS[u.role]}</Td>
                <Td className="text-slate-500">{formatDateTime(u.last_login_at)}</Td>
                <Td>
                  {u.id === me.id ? <span className="text-xs text-slate-400">você</span> : (
                    <ActionForm action={updateUserAction} className="flex flex-wrap gap-1">
                      <input type="hidden" name="id" value={u.id} />
                      <Select name="role" defaultValue={u.role} className="w-auto py-1 text-xs">{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                      <Select name="active" defaultValue={u.active ? "1" : "0"} className="w-auto py-1 text-xs"><option value="1">Ativo</option><option value="0">Inativo</option></Select>
                      <SubmitButton size="sm" variant="secondary">Salvar</SubmitButton>
                    </ActionForm>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card title="Novo usuário" description="Administrador: tudo. Operador: operação diária. Visualizador: somente leitura.">
        <ActionForm action={createUserAction} resetOnSuccess className="space-y-3">
          <Field label="Nome"><Input name="name" required /></Field>
          <Field label="E-mail"><Input name="email" type="email" required /></Field>
          <Field label="Senha inicial" hint="Mínimo 10 caracteres com letras e números"><Input name="password" type="password" required autoComplete="new-password" /></Field>
          <Field label="Papel"><Select name="role" defaultValue="operator">{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <SubmitButton>Criar usuário</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
