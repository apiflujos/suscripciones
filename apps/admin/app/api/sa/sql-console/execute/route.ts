import { NextResponse } from "next/server";
import { requireApiSession } from "../../../_lib/requireApiSession";
import { requireSaSessionFromCookie } from "../../../_lib/requireSaSession";
import { executeSqlConsole } from "../../../../admin/_services/sqlConsole";

export async function POST(req: Request) {
  const auth = await requireApiSession(req, { roles: ["SUPER_ADMIN"] });
  if (!auth.ok) return auth.response;

  const sa = await requireSaSessionFromCookie();
  if (!sa.ok) return sa.response;

  const body = await req.json().catch(() => null);
  const result = await executeSqlConsole(body);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message, details: result.details, statement: result.statement, max: result.max, durationMs: result.durationMs },
      { status: result.status }
    );
  }
  return NextResponse.json(result.payload, { status: result.status });
}
