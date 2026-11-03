import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAllowedOrigin } from "../../_origin";
import { backroomCookie, backroomError, ownerFetch, privateHeaders } from "../_server";

export async function POST(request: Request) {
  if (!hasAllowedOrigin(request)) return backroomError("Request origin is not allowed", 403);
  const token = (await cookies()).get(backroomCookie)?.value;
  if (token) {
    try {
      const upstream = await ownerFetch("/api/backroom/logout", token, {});
      if (!upstream.ok && ![401, 403].includes(upstream.status)) return backroomError("Could not end the session. Please retry.", 503);
    } catch { return backroomError("Could not end the session. Please retry.", 503); }
  }
  const response = NextResponse.json({ ok: true }, { headers: privateHeaders });
  response.cookies.set(backroomCookie, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
