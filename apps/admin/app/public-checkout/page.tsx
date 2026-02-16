import { redirect } from "next/navigation";

export default async function PublicCheckoutPage({
  searchParams
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const tab = String(sp.tab || "public-checkout");
  redirect(`/settings?tab=${encodeURIComponent(tab)}`);
}
