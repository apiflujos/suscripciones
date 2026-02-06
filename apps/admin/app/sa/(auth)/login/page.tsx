import { redirect } from "next/navigation";

export default function SaLoginAlias() {
  redirect("/login?next=%2Fsa");
}
