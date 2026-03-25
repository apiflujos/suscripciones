import { WhatsappNotificationsPanel } from "../settings/WhatsappNotificationsPanel";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams
}: {
  searchParams?: Promise<{ env?: string; saved?: string; error?: string; scheduled?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const envRaw = String(sp.env || "");
  const env = envRaw.toUpperCase() === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
  const saved = typeof sp.saved === "string" ? sp.saved : "";
  const scheduled = typeof sp.scheduled === "string" ? sp.scheduled : "";
  const error = typeof sp.error === "string" ? sp.error : "";

  return (
    <main className="page pageWide notificationsPage">
      <WhatsappNotificationsPanel
        env={env}
        saved={saved}
        scheduled={scheduled}
        error={error}
      />
    </main>
  );
}
