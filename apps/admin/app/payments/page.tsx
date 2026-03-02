import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const qp = new URLSearchParams();
  qp.set("tab", "payments");
  for (const [key, value] of Object.entries(sp)) {
    if (key === "tab") continue;
    if (typeof value === "string") qp.set(key, value);
    else if (Array.isArray(value)) value.forEach((v) => qp.append(key, v));
  }
  redirect(`/logs?${qp.toString()}`);
}
