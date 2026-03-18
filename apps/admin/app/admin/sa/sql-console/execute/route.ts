import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { requireSaSession } from "../../../_lib/requireSaSession";
import { executeSqlConsole } from "../../../_services/sqlConsole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const body = await req.json().catch(() => null);
  const result = await executeSqlConsole(body);
  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message, details: result.details, statement: result.statement, max: result.max, durationMs: result.durationMs },
      { status: result.status }
    );
  }
  return Response.json(result.payload, { status: result.status });
}
