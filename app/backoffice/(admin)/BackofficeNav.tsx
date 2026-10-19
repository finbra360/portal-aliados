"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { AdminRole } from "@/lib/db/admin-users";
import { COBRANZA_ROLES } from "@/lib/rbac";
import FinbraLogo from "@/components/ui/FinbraLogo";
import { IconHome, IconLogout, IconSettings, IconTarget, IconUsers, IconWallet } from "@/components/ui/icons";

// exact: solo se marca activo en esa ruta exacta (no en sus subrutas).
// excluir: subrutas que tienen su propio elemento en el menú.
type NavLink = { href: string; label: string; exact?: boolean; excluir?: string[] };
// roles: si se indica, el grupo solo se muestra a esos roles. Es solo para no
// mostrar lo que no se puede abrir: el permiso real se revisa en el servidor.
type NavEntry =
  | { type: "link"; href: string; label: string; icon: ReactNode }
  | { type: "group"; label: string; icon: ReactNode; items: NavLink[]; roles?: AdminRole[] };

const NAV: NavEntry[] = [
  { type: "link", href: "/backoffice/inicio", label: "Inicio", icon: <IconHome /> },
  {
    type: "group",
    label: "Brokers",
    icon: <IconUsers />,
    items: [
      { href: "/backoffice/brokers/resumen", label: "Resumen", exact: true },
      { href: "/backoffice/brokers", label: "Brokers", excluir: ["/backoffice/brokers/resumen"] },
      { href: "/backoffice/operaciones", label: "Operaciones" },
      { href: "/backoffice/comisiones", label: "Comisiones" },
      { href: "/backoffice/rankings", label: "Rankings" },
      { href: "/backoffice/concursos", label: "Concursos" },
      { href: "/backoffice/recursos", label: "Recursos" },
      { href: "/backoffice/comunicaciones", label: "Comunicaciones" },
    ],
  },
  {
    type: "group",
    label: "Cobranza",
    icon: <IconWallet />,
    roles: COBRANZA_ROLES,
    items: [
      { href: "/backoffice/cobranza", label: "Inicio", exact: true },
      { href: "/backoffice/cobranza/cola", label: "Cola de trabajo" },
      { href: "/backoffice/cobranza/clientes", label: "Clientes" },
      { href: "/backoffice/cobranza/chat", label: "Chat" },
      { href: "/backoffice/cobranza/cuentas", label: "Cuentas de pago" },
      { href: "/backoffice/cobranza/preventivos", label: "Preventivos" },
      { href: "/backoffice/cobranza/whatsapp", label: "WhatsApp" },
    ],
  },
  {
    type: "group",
    label: "Leads",
    icon: <IconTarget />,
    items: [{ href: "/backoffice/leads", label: "Leads" }],
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
  const nav = NAV.filter((entry) => entry.type === "link" || !entry.roles || entry.roles.includes(role));

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

  const fila = "flex items-center gap-3 rounded-lg px-3 py-2";

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-black/5 bg-white">
      <div className="px-5 pb-4 pt-5">
        <Link href="/backoffice/inicio" aria-label="Inicio">
          <FinbraLogo subtitulo="Backoffice" />
        </Link>
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
  );
}
