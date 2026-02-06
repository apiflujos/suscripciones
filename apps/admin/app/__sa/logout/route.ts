import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const res = NextResponse.redirect(new URL("/__sa/login?loggedOut=1", url));
  res.cookies.set("sa_session", "", { path: "/__sa", maxAge: 0 });
  return res;
}

