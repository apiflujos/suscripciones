import LogsPage from "../logs/page";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  return LogsPage({
    searchParams: Promise.resolve({
      ...sp,
      tab: "payments"
    })
  });
}
