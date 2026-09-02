import { NextRequest, NextResponse } from "next/server";
import { verifyAdminCode } from "@/lib/admin-n8n";
import { signAdminSession, ADMIN_SESSION_COOKIE_NAME, ADMIN_SESSION_COOKIE_OPTIONS } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!email || !code) {
    return NextResponse.json({ valid: false, error: "Email y código requeridos" }, { status: 400 });
  }

  try {
    const result = await verifyAdminCode(email, code);

    if (!result.valid || !result.nombre || !result.role) {
      return NextResponse.json({ valid: false }, { status: 401 });
    }

    const token = await signAdminSession({ email, nombre: result.nombre, role: result.role });
    const response = NextResponse.json({ valid: true, nombre: result.nombre, role: result.role });
    response.cookies.set(ADMIN_SESSION_COOKIE_NAME, token, ADMIN_SESSION_COOKIE_OPTIONS);
    return response;
  } catch {
    return NextResponse.json({ valid: false, error: "No se pudo verificar el código" }, { status: 502 });
  }
}
