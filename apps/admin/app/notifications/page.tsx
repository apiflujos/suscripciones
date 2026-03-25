import NotificationsListPage from "./list/page";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams
}: {
  searchParams?: Promise<{ env?: string; saved?: string; error?: string; scheduled?: string }>;
}) {
  return <NotificationsListPage searchParams={searchParams} />;
}
