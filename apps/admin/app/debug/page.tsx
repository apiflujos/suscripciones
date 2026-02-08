import { redirect } from "next/navigation";

export default function DebugAlias() {
  redirect("/__debug");
}
