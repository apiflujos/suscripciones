export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

export default async function PlansPage() {
  // "Productos/Planes" se administra desde "Suscripciones".
  redirect("/subscriptions");
}
