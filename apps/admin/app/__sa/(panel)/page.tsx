import { redirect } from "next/navigation";

export default async function SaHome() {
  redirect("/sa/tenants");
}
