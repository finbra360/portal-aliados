import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifyAdminSession, ADMIN_SESSION_COOKIE_NAME } from "@/lib/admin-auth";

const PROTECTED_PATHS = ["/dashboard", "/recursos", "/operaciones", "/ranking", "/comisiones", "/concursos", "/perfil"];

// En este dominio el backoffice vive en la raíz (backoffice.finbra.com/leads en vez de
// aliados.finbra.com/backoffice/leads) -- mismo deploy, mismo código, solo se reescribe
// la ruta internamente para que no haya que repetir /backoffice en la URL.
const BACKOFFICE_HOST = "backoffice.finbra.com";

export async function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const isBackofficeHost = host === BACKOFFICE_HOST || host.startsWith(`${BACKOFFICE_HOST}:`);

  let pathname = req.nextUrl.pathname;
  let rewriteTarget: string | null = null;

  if (isBackofficeHost && !pathname.startsWith("/backoffice")) {
    rewriteTarget = `/backoffice${pathname === "/" ? "/dashboard" : pathname}`;
    pathname = rewriteTarget;
  }

  if (pathname.startsWith("/backoffice")) {
    const isLogin = pathname === "/backoffice/login";
    const token = req.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
    const adminSession = token ? await verifyAdminSession(token) : null;

    const loginPath = isBackofficeHost ? "/login" : "/backoffice/login";
    const dashboardPath = isBackofficeHost ? "/dashboard" : "/backoffice/dashboard";

    if (!isLogin && !adminSession) {
      return NextResponse.redirect(new URL(loginPath, req.url));
    }
    if (isLogin && adminSession) {
      return NextResponse.redirect(new URL(dashboardPath, req.url));
    }
    if (rewriteTarget) {
      // Clonar nextUrl y solo cambiar el pathname: construir la URL desde cero
      // descarta el query string, y con él los filtros y la paginación.
      const rewritten = req.nextUrl.clone();
      rewritten.pathname = rewriteTarget;
      return NextResponse.rewrite(rewritten);
    }
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  const isProtected = PROTECTED_PATHS.some((path) => pathname.startsWith(path));

  if (isProtected && !session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (pathname === "/login" && session) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/recursos/:path*",
    "/operaciones/:path*",
    "/ranking/:path*",
    "/comisiones/:path*",
    "/concursos/:path*",
    "/perfil/:path*",
    "/login",
    "/backoffice/:path*",
    // Alias de URL limpia para backoffice.finbra.com (ver isBackofficeHost arriba)
    "/",
    "/leads/:path*",
    "/brokers/:path*",
    "/rankings/:path*",
    "/comunicaciones/:path*",
    "/usuarios/:path*",
    "/audit-log/:path*",
    "/configuracion/:path*",
  ],
};
