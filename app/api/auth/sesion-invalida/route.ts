import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

/**
 * Destino del portal cuando la sesión sigue firmada pero el broker ya no puede
 * entrar (suspendido o dado de baja). Borra la cookie y manda al login; sin
 * borrarla, el middleware lo regresaría al dashboard en un ciclo.
 */
export async function GET(req: NextRequest) {
  const response = NextResponse.redirect(new URL("/login?sesion=cerrada", req.url));
  response.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
