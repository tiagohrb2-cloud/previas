import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/modules/auth/session";
import { ROLE_LABELS } from "@/modules/auth/permissions";
import { getMode } from "@/lib/settings";
import { openAlertsCount } from "@/modules/dashboard/service";
import { logoutAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [mode, alerts] = await Promise.all([getMode(), openAlertsCount()]);
  return (
    <AppShell user={{ name: user.name, email: user.email, role: user.role, roleLabel: ROLE_LABELS[user.role] }} mode={mode} alerts={alerts} logoutAction={logoutAction}>
      {children}
    </AppShell>
  );
}
