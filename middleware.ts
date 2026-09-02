import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifyAdminSession, ADMIN_SESSION_COOKIE_NAME } from "@/lib/admin-auth";

const PROTECTED_PATHS = ["/dashboard", "/recursos", "/operaciones", "/ranking", "/comisiones", "/concursos", "/perfil"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/backoffice")) {
    const isLogin = pathname === "/backoffice/login";
    const token = req.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
    const adminSession = token ? await verifyAdminSession(token) : null;

    if (!isLogin && !adminSession) {
      return NextResponse.redirect(new URL("/backoffice/login", req.url));
    }
    if (isLogin && adminSession) {
      return NextResponse.redirect(new URL("/backoffice/dashboard", req.url));
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
  ],
};
