import { NextRequest, NextResponse } from "next/server";
import { verifyCode } from "@/lib/n8n";
import { brokerQuePuedeEntrar } from "@/lib/db/brokers";
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
    // n8n solo valida el código; quién es (y si sigue activo) sale de la tabla brokers.
    const broker = result.valid ? await brokerQuePuedeEntrar(email) : null;

    if (!broker) {
      return NextResponse.json({ valid: false }, { status: 401 });
    }

    const token = await signSession({ email, brokerId: broker.id, nombre: broker.nombre });
    const response = NextResponse.json({ valid: true, nombre: broker.nombre });
    response.cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
    return response;
  } catch {
    return NextResponse.json({ valid: false, error: "No se pudo verificar el código" }, { status: 502 });
  }
}
