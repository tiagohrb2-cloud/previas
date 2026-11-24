import { PageHeader } from "@/components/ui";
import { SettingsNav } from "./nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Configurações" description="Modo de operação, automações, integrações, taxas e usuários." />
      <SettingsNav />
      <div className="mt-6">{children}</div>
    </>
  );
}
