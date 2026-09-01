import { NextRequest, NextResponse } from "next/server";
import { requestCode } from "@/lib/n8n";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email) {
    return NextResponse.json({ sent: false, error: "Email requerido" }, { status: 400 });
  }

  try {
    const result = await requestCode(email);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ sent: false, error: "No se pudo enviar el código" }, { status: 502 });
  }
}
