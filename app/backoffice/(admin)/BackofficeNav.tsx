"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { AdminRole } from "@/lib/db/admin-users";
import { PERMISOS, rolPuede, type Permiso } from "@/lib/permisos";
import FinbraLogo from "@/components/ui/FinbraLogo";
import { IconBuilding, IconHome, IconLogout, IconMenu, IconSettings, IconTarget, IconTrendingUp, IconUsers, IconWallet, IconX } from "@/components/ui/icons";
import { CH_VEN } from "@/lib/credit-health/roles";

// exact: solo se marca activo en esa ruta exacta (no en sus subrutas).
// excluir: subrutas que tienen su propio elemento en el menú.
// permiso: si se indica, el elemento solo se muestra a quien lo tiene.
type NavLink = { href: string; label: string; exact?: boolean; excluir?: string[]; permiso?: Permiso };
// roles: si se indica, el grupo solo se muestra a esos roles. Es solo para no
// mostrar lo que no se puede abrir: el permiso real se revisa en el servidor.
type NavEntry =
  | { type: "link"; href: string; label: string; icon: ReactNode }
  | { type: "group"; label: string; icon: ReactNode; items: NavLink[]; roles?: readonly AdminRole[] };

const NAV: NavEntry[] = [
  { type: "link", href: "/backoffice/inicio", label: "Inicio", icon: <IconHome /> },
  {
    type: "group",
    label: "Clientes",
    icon: <IconBuilding />,
    roles: PERMISOS["cartera.ver"].roles,
    items: [
      { href: "/backoffice/clientes/resumen", label: "Resumen de cartera" },
      { href: "/backoffice/clientes", label: "Todos los clientes", excluir: ["/backoffice/clientes/renovaciones", "/backoffice/clientes/resumen", "/backoffice/clientes/ajustes", "/backoffice/clientes/revisar"] },
      { href: "/backoffice/clientes/renovaciones", label: "Renovaciones" },
      { href: "/backoffice/clientes/revisar", label: "Empresas por revisar", permiso: "clientes.configurar" },
      { href: "/backoffice/clientes/ajustes", label: "Ajustes", permiso: "clientes.configurar" },
    ],
  },
  {
    type: "group",
    label: "Originación",
    icon: <IconTrendingUp />,
    roles: PERMISOS["originacion.ver"].roles,
    items: [
      { href: "/backoffice/negocios", label: "Negocios", excluir: ["/backoffice/negocios/nuevo"] },
      { href: "/backoffice/negocios/nuevo", label: "Nuevo negocio", permiso: "originacion.operar" },
    ],
  },
  {
    type: "group",
    label: "Brokers",
    icon: <IconUsers />,
    items: [
      { href: "/backoffice/brokers/resumen", label: "Resumen", exact: true },
      { href: "/backoffice/brokers", label: "Brokers", excluir: ["/backoffice/brokers/resumen", "/backoffice/brokers/chat"] },
      { href: "/backoffice/operaciones", label: "Operaciones" },
      { href: "/backoffice/comisiones", label: "Comisiones" },
      { href: "/backoffice/rankings", label: "Rankings" },
      { href: "/backoffice/concursos", label: "Concursos" },
      { href: "/backoffice/recursos", label: "Recursos" },
      { href: "/backoffice/comunicaciones", label: "Comunicaciones" },
      { href: "/backoffice/brokers/chat", label: "Chat de aliados" },
    ],
  },
  {
    type: "group",
    label: "Cobranza",
    icon: <IconWallet />,
    roles: PERMISOS["cartera.ver"].roles,
    items: [
      { href: "/backoffice/cobranza", label: "Inicio", exact: true },
      { href: "/backoffice/cobranza/cola", label: "Cola de trabajo" },
      { href: "/backoffice/cobranza/clientes", label: "Clientes" },
      { href: "/backoffice/cobranza/creditos", label: "Créditos" },
      { href: "/backoffice/cobranza/chat", label: "Chat" },
      { href: "/backoffice/cobranza/cuentas", label: "Cuentas de pago", permiso: "cobranza.operar" },
      { href: "/backoffice/cobranza/preventivos", label: "Preventivos" },
      { href: "/backoffice/cobranza/whatsapp", label: "WhatsApp" },
      { href: "/backoffice/cobranza/correos", label: "Correos" },
    ],
  },
  {
    type: "group",
    label: "Leads",
    icon: <IconTarget />,
    items: [
      { href: "/backoffice/leads/conversaciones", label: "Conversaciones", exact: true },
      { href: "/backoffice/leads", label: "Leads", excluir: ["/backoffice/leads/conversaciones"] },
    ],
  },
  {
    type: "group",
    label: "Credit Health",
    icon: <IconTrendingUp />,
    roles: CH_VEN,
    items: [
      { href: "/backoffice/credit-health", label: "Resumen", exact: true },
      { href: "/backoffice/credit-health/prospectos", label: "Prospectos" },
      { href: "/backoffice/credit-health/politicas", label: "Políticas" },
    ],
  },
  {
    type: "group",
    label: "Sistema",
    icon: <IconSettings />,
    items: [
      { href: "/backoffice/usuarios", label: "Usuarios" },
      { href: "/backoffice/audit-log", label: "Audit Log" },
      { href: "/backoffice/configuracion", label: "Configuración" },
    ],
  },
];

const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  comercial: "Comercial",
  finanzas: "Finanzas",
};

/** Grupos que el usuario dejó abiertos, guardados en este navegador. */
const CLAVE_ABIERTOS = "backoffice-menu-abiertos";

/** Desde este ancho (el `lg` de Tailwind) el menú es la barra lateral fija de siempre. */
const ESCRITORIO = "(min-width: 1024px)";

const ENFOCABLES = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

const isActive = (pathname: string, item: NavLink) => {
  if (item.exact) return pathname === item.href;
  if (item.excluir?.some((e) => pathname === e || pathname.startsWith(`${e}/`))) return false;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
};

const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

export default function BackofficeNav({ nombre, role }: { nombre: string; role: AdminRole }) {
  const pathname = usePathname();
  const router = useRouter();
  const nav = NAV.filter((entry) => entry.type === "link" || !entry.roles || entry.roles.includes(role)).map((entry) =>
    entry.type === "group" ? { ...entry, items: entry.items.filter((item) => !item.permiso || rolPuede(role, item.permiso)) } : entry,
  );

  // Al cargar: abierto el grupo de la página actual. Después se suman los que el
  // usuario dejó abiertos (se leen en el navegador, ya montado, para no romper la hidratación).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const entry of NAV) {
      if (entry.type === "group") initial[entry.label] = entry.items.some((item) => isActive(pathname, item));
    }
    return initial;
  });
  useEffect(() => {
    try {
      const guardados = JSON.parse(localStorage.getItem(CLAVE_ABIERTOS) ?? "{}") as Record<string, boolean>;
      setOpenGroups((prev) => {
        const merged = { ...prev };
        for (const [k, v] of Object.entries(guardados)) if (v) merged[k] = true;
        return merged;
      });
    } catch {
      // Sin acceso a localStorage: solo se abre el grupo de la página actual.
    }
  }, []);

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try {
        localStorage.setItem(CLAVE_ABIERTOS, JSON.stringify(next));
      } catch {
        // No pasa nada si no se puede guardar.
      }
      return next;
    });
  }

  async function handleLogout() {
    await fetch("/api/backoffice/auth/logout", { method: "POST" });
    router.push("/backoffice/login");
    router.refresh();
  }

  // En pantallas angostas el menú vive en un panel que se abre con el botón de la barra
  // superior. En escritorio `abierto` siempre es false y la barra lateral se ve como siempre.
  const [abierto, setAbierto] = useState(false);
  const botonMenu = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  const cerrar = useCallback(() => {
    setAbierto(false);
    botonMenu.current?.focus();
  }, []);

  useEffect(() => {
    if (!abierto) return;
    panel.current?.querySelector<HTMLElement>(ENFOCABLES)?.focus();
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Si la ventana se ensancha a escritorio con el panel abierto, se cierra solo.
    const escritorio = window.matchMedia(ESCRITORIO);
    const alCambiar = () => {
      if (escritorio.matches) setAbierto(false);
    };
    escritorio.addEventListener("change", alCambiar);
    return () => {
      document.body.style.overflow = overflowPrevio;
      escritorio.removeEventListener("change", alCambiar);
    };
  }, [abierto]);

  function alTeclear(e: KeyboardEvent<HTMLElement>) {
    if (!abierto) return;
    if (e.key === "Escape") {
      e.preventDefault();
      cerrar();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    // El foco se queda dentro del panel mientras está abierto.
    const enfocables = Array.from(panel.current.querySelectorAll<HTMLElement>(ENFOCABLES));
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (!primero || !ultimo) return;
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  }

  // Tocar cualquier enlace del panel lo cierra (aunque sea la página en la que ya estás).
  function alHacerClic(e: MouseEvent<HTMLElement>) {
    if (abierto && (e.target as HTMLElement).closest("a")) cerrar();
  }

  const fila = "flex items-center gap-3 rounded-lg px-3 py-2";

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-black/5 bg-white px-4 lg:hidden">
        <button
          ref={botonMenu}
          type="button"
          onClick={() => setAbierto(true)}
          aria-label="Abrir menú"
          aria-expanded={abierto}
          aria-controls="backoffice-menu"
          className="-ml-2 rounded-lg p-2 text-black/70 hover:bg-black/5"
        >
          <IconMenu />
        </button>
        <Link href="/backoffice/inicio" aria-label="Inicio">
          <FinbraLogo subtitulo="Backoffice" />
        </Link>
      </header>

      {abierto && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" aria-hidden onClick={cerrar} />}

      <aside
        ref={panel}
        id="backoffice-menu"
        role={abierto ? "dialog" : undefined}
        aria-modal={abierto || undefined}
        aria-label={abierto ? "Menú" : undefined}
        onKeyDown={alTeclear}
        onClick={alHacerClic}
        className={`${abierto ? "fixed inset-y-0 left-0 z-50 flex max-w-[85vw] shadow-xl" : "hidden"} w-64 shrink-0 flex-col border-r border-black/5 bg-white lg:static lg:z-auto lg:flex lg:h-screen lg:max-w-none lg:shadow-none`}
      >
        <div className="flex items-start justify-between gap-2 px-5 pb-4 pt-5">
          <Link href="/backoffice/inicio" aria-label="Inicio">
            <FinbraLogo subtitulo="Backoffice" />
          </Link>
          <button type="button" onClick={cerrar} aria-label="Cerrar menú" className="-mr-2 -mt-1 rounded-lg p-2 text-finbra-gray hover:bg-black/5 hover:text-black lg:hidden">
            <IconX />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2 text-sm">
          {nav.map((entry) => {
            if (entry.type === "link") {
              const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
                  className={`${fila} font-medium ${active ? "bg-finbra-purple/10 text-finbra-purple-700" : "text-black/70 hover:bg-black/[0.04]"}`}
                >
                  <span className={active ? "text-finbra-purple" : "text-finbra-gray"}>{entry.icon}</span>
                  {entry.label}
                </Link>
              );
            }

            const isOpen = !!openGroups[entry.label];
            const groupActive = entry.items.some((item) => isActive(pathname, item));

            return (
              <div key={entry.label}>
                <button
                  type="button"
                  onClick={() => toggleGroup(entry.label)}
                  aria-expanded={isOpen}
                  className={`${fila} w-full text-left font-medium ${groupActive ? "text-finbra-purple" : "text-black/70 hover:bg-black/[0.04]"}`}
                >
                  <span className={groupActive ? "text-finbra-purple" : "text-finbra-gray"}>{entry.icon}</span>
                  <span className="flex-1">{entry.label}</span>
                  <span className="text-finbra-gray">
                    <ChevronIcon open={isOpen} />
                  </span>
                </button>
                {isOpen && (
                  <div className="mt-0.5 space-y-0.5 pb-1">
                    {entry.items.map((item) => {
                      const active = isActive(pathname, item);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`block rounded-lg py-1.5 pl-11 pr-3 ${
                            active ? "bg-finbra-purple/10 font-semibold text-finbra-purple-700" : "text-black/60 hover:bg-black/[0.04] hover:text-black/80"
                          }`}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 border-t border-black/5 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-finbra-purple/10 text-xs font-bold text-finbra-purple-700" aria-hidden>
            {iniciales(nombre)}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-medium">{nombre}</span>
            <span className="block text-xs text-finbra-gray">{ROLE_LABELS[role]}</span>
          </span>
          <button type="button" onClick={handleLogout} title="Cerrar sesión" aria-label="Cerrar sesión" className="rounded-lg p-2 text-finbra-gray hover:bg-black/5 hover:text-black">
            <IconLogout />
          </button>
        </div>
      </aside>
    </>
  );
}
