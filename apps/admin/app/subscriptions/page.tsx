import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp || {})) {
    if (typeof v === "string") qp.set(k, v);
  }
  redirect(`/billing?${qp.toString()}`);
}
