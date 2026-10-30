import { SendPage } from "../../../sendPage";

export const dynamic = "force-dynamic";

export default function Page(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <SendPage kind="token" {...props} />;
}
