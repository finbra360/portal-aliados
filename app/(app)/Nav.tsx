"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Tier } from "@/lib/tiers";
import type { AnuncioParaBroker } from "@/lib/db/announcements";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/operaciones", label: "Mis Operaciones" },
  { href: "/ranking", label: "Ranking" },
  { href: "/comisiones", label: "Comisiones" },
  { href: "/recursos", label: "Recursos" },
  { href: "/concursos", label: "Concursos" },
];

export default function Nav({
  nombre,
  tier,
  notifications,
  anuncios,
}: {
  nombre: string;
  tier: Tier | null;
  notifications: string[];
  anuncios: AnuncioParaBroker[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Lo que ya se marcó como leído en esta visita (el servidor lo sabe al abrir las Novedades).
  const [leidosAhora, setLeidosAhora] = useState(false);
  const sinLeer = leidosAhora ? 0 : anuncios.filter((a) => !a.leido).length;

  function toggleNovedades() {
    const abriendo = !notifOpen;
    setNotifOpen(abriendo);
    if (abriendo && sinLeer > 0) {
      fetch("/api/anuncios/leidos", { method: "POST" })
        .then((r) => {
          if (r.ok) setLeidosAhora(true);
        })
        .catch(() => {});
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 border-b border-black/5 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-sm font-bold text-finbra-purple">Finbra 360</p>
            {nombre && <p className="text-xs text-finbra-gray">Hola, {nombre}</p>}
          </div>
          {tier && (
            <span
              className="hidden rounded-full px-2.5 py-1 text-xs font-semibold text-white sm:inline-block"
              style={{ backgroundColor: tier.color }}
            >
              {tier.nombre}
            </span>
          )}
        </div>

        <nav className="hidden items-center gap-4 text-sm font-medium lg:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname === link.href ? "text-finbra-purple" : "text-black/70 hover:text-finbra-purple"}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              type="button"
              onClick={toggleNovedades}
              aria-label={sinLeer > 0 ? `Novedades (${sinLeer} sin leer)` : "Novedades"}
              className="relative rounded-full p-2 text-finbra-gray hover:bg-black/5 hover:text-finbra-purple"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.65V5a2 2 0 1 0-4 0v.35A6 6 0 0 0 6 11v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
                <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
              </svg>
              {sinLeer > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-finbra-purple" />}
            </button>
            {notifOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-xl border border-finbra-purple/10 bg-white p-3 shadow-[0_4px_24px_rgba(93,91,219,0.2)]">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-finbra-purple">Novedades</p>
                {anuncios.length === 0 && notifications.length === 0 ? (
                  <p className="py-2 text-sm text-finbra-gray">No hay novedades por ahora.</p>
                ) : (
                  <ul className="max-h-96 space-y-2 overflow-y-auto">
                    {anuncios.map((a) => (
                      <li key={a.id} className="rounded-lg border border-finbra-purple/20 bg-white p-3 text-sm">
                        <p className="font-semibold">{a.titulo}</p>
                        <p className="mt-1 whitespace-pre-line text-finbra-gray">{a.mensaje}</p>
                        {a.ctaUrl && a.ctaTexto && (
                          <Link
                            href={a.ctaUrl}
                            onClick={() => setNotifOpen(false)}
                            className="mt-2 inline-block rounded-lg bg-finbra-purple px-3 py-1 text-xs font-semibold text-white"
                            {...(a.ctaUrl.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                          >
                            {a.ctaTexto}
                          </Link>
                        )}
                      </li>
                    ))}
                    {notifications.map((n) => (
                      <li key={n} className="rounded-lg bg-finbra-purple/5 p-2 text-sm">
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <Link href="/perfil" className="hidden text-sm font-medium text-black/70 hover:text-finbra-purple sm:block">
            Perfil
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="hidden text-sm font-medium text-black/70 hover:text-finbra-purple sm:block"
          >
            Cerrar sesión
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Menú"
            className="rounded-full p-2 text-finbra-gray hover:bg-black/5 lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="flex flex-col gap-1 border-t border-black/5 px-4 py-3 lg:hidden">
          {[...LINKS, { href: "/perfil", label: "Perfil" }].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                pathname === link.href ? "bg-finbra-purple/10 text-finbra-purple" : "text-black/70"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg px-3 py-2 text-left text-sm font-medium text-black/70"
          >
            Cerrar sesión
          </button>
        </nav>
      )}
    </header>
  );
}
