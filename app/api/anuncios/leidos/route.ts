import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { marcarAnunciosLeidos } from "@/lib/db/announcements";

/** El broker abrió sus Novedades: lo que tenía a la vista cuenta como leído. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    await marcarAnunciosLeidos(session.brokerId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
