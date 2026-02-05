import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage({
  searchParams
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams || {})) {
    if (typeof v === "string") qp.set(k, v);
  }
  qp.set("tab", "commercial");
  redirect(`/products?${qp.toString()}`);
}
