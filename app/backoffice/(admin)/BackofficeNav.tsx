"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { AdminRole } from "@/lib/db/admin-users";

type NavLink = { href: string; label: string };
type NavEntry = { type: "link"; href: string; label: string } | { type: "group"; label: string; items: NavLink[] };

const NAV: NavEntry[] = [
  { type: "link", href: "/backoffice/dashboard", label: "Dashboard" },
  {
    type: "group",
    label: "Brokers",
    items: [
      { href: "/backoffice/brokers", label: "Brokers" },
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
    label: "Leads",
    items: [{ href: "/backoffice/leads", label: "Leads" }],
  },
  {
    type: "group",
    label: "Sistema",
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

export default function BackofficeNav({ nombre, role }: { nombre: string; role: AdminRole }) {
  const pathname = usePathname();
  const router = useRouter();

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const entry of NAV) {
      if (entry.type === "group") {
        initial[entry.label] = entry.items.some((item) => pathname.startsWith(item.href));
      }
    }
    return initial;
  });

  function toggleGroup(label: string) {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  async function handleLogout() {
    await fetch("/api/backoffice/auth/logout", { method: "POST" });
    router.push("/backoffice/login");
    router.refresh();
  }

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-black/5 bg-white">
      <div className="border-b border-black/5 px-4 py-4">
        <p className="text-sm font-bold text-finbra-purple">Finbra Backoffice</p>
        <p className="mt-1 text-xs text-finbra-gray">{nombre}</p>
        <span className="mt-1 inline-block rounded-full bg-finbra-purple/10 px-2 py-0.5 text-[11px] font-semibold text-finbra-purple">
          {ROLE_LABELS[role]}
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3 text-sm">
        {NAV.map((entry) => {
          if (entry.type === "link") {
            const active = pathname.startsWith(entry.href);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                className={`block rounded-lg px-3 py-2 font-medium ${
                  active ? "bg-finbra-purple/10 text-finbra-purple" : "text-black/70 hover:bg-black/5"
                }`}
              >
                {entry.label}
              </Link>
            );
          }

          const isOpen = !!openGroups[entry.label];
          const groupActive = entry.items.some((item) => pathname.startsWith(item.href));

          return (
            <div key={entry.label}>
              <button
                type="button"
                onClick={() => toggleGroup(entry.label)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold uppercase tracking-wide ${
                  groupActive ? "text-finbra-purple" : "text-finbra-gray"
                }`}
              >
                <span>{entry.label}</span>
                <ChevronIcon open={isOpen} />
              </button>
              {isOpen && (
                <div className="ml-1 space-y-0.5 border-l border-black/5 pl-2">
                  {entry.items.map((item) => {
                    const active = pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`block rounded-lg px-3 py-2 font-medium ${
                          active ? "bg-finbra-purple/10 text-finbra-purple" : "text-black/70 hover:bg-black/5"
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

      <div className="border-t border-black/5 p-2">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-black/70 hover:bg-black/5"
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
