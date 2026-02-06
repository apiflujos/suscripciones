import { redirect } from "next/navigation";

export default async function SaHome() {
  redirect("/__sa/tenants");
}

