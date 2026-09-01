import { NextRequest, NextResponse } from "next/server";
import { verifyCode } from "@/lib/n8n";
import { signSession, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!email || !code) {
    return NextResponse.json({ valid: false, error: "Email y código requeridos" }, { status: 400 });
  }

  try {
    const result = await verifyCode(email, code);

    if (!result.valid || !result.brokerId || !result.nombre) {
      return NextResponse.json({ valid: false }, { status: 401 });
    }

    const token = await signSession({ email, brokerId: result.brokerId, nombre: result.nombre });
    const response = NextResponse.json({ valid: true, nombre: result.nombre });
    response.cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
    return response;
  } catch {
    return NextResponse.json({ valid: false, error: "No se pudo verificar el código" }, { status: 502 });
  }
}
