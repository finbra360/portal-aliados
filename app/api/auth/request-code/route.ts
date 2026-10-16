import { NextRequest, NextResponse } from "next/server";
import { requestCode } from "@/lib/n8n";
import { brokerQuePuedeEntrar } from "@/lib/db/brokers";
import { contarIntentos, huellaDeIp, ipDe, registrarIntento } from "@/lib/db/login-intentos";
import { MENSAJE_DEMASIADOS_INTENTOS, puedePedirCodigo } from "@/lib/login-limites";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";

  if (!email) {
    return NextResponse.json({ sent: false, error: "Email requerido" }, { status: 400 });
  }

  try {
    const ipHash = huellaDeIp(ipDe(req.headers));
    if (!puedePedirCodigo(await contarIntentos(email, ipHash))) {
      return NextResponse.json({ sent: false, error: MENSAJE_DEMASIADOS_INTENTOS }, { status: 429 });
    }
    // Se cuenta todo intento, exista o no el correo: así el límite tampoco delata quién es broker.
    await registrarIntento({ tipo: "codigo", email, ipHash, ok: false });

    // Solo brokers dados de alta en el backoffice y no suspendidos reciben código.
    const broker = await brokerQuePuedeEntrar(email);
    if (!broker) {
      // Misma respuesta que si se hubiera mandado: no se revela quién es broker.
      return NextResponse.json({ sent: true });
    }
    const result = await requestCode(email, broker.nombre);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ sent: false, error: "No se pudo enviar el código" }, { status: 502 });
  }
}
