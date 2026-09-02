"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { AdminRole } from "@/lib/db/admin-users";

const LINKS = [
  { href: "/backoffice/dashboard", label: "Dashboard" },
  { href: "/backoffice/brokers", label: "Brokers" },
  { href: "/backoffice/operaciones", label: "Operaciones" },
  { href: "/backoffice/comisiones", label: "Comisiones" },
  { href: "/backoffice/rankings", label: "Rankings" },
  { href: "/backoffice/concursos", label: "Concursos" },
  { href: "/backoffice/recursos", label: "Recursos" },
  { href: "/backoffice/comunicaciones", label: "Comunicaciones" },
  { href: "/backoffice/usuarios", label: "Usuarios" },
  { href: "/backoffice/audit-log", label: "Audit Log" },
  { href: "/backoffice/configuracion", label: "Configuración" },
];

const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  comercial: "Comercial",
  finanzas: "Finanzas",
};

export default function BackofficeNav({ nombre, role }: { nombre: string; role: AdminRole }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/backoffice/auth/logout", { method: "POST" });
    router.push("/backoffice/login");
    router.refresh();
  }

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-black/5 bg-white">
      <div className="border-b border-black/5 px-4 py-4">
        <p className="text-sm font-bold text-finbra-purple">Finbra Backoffice</p>
        <p className="mt-1 text-xs text-finbra-gray">{nombre}</p>
        <span className="mt-1 inline-block rounded-full bg-finbra-purple/10 px-2 py-0.5 text-[11px] font-semibold text-finbra-purple">
          {ROLE_LABELS[role]}
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3 text-sm">
        {LINKS.map((link) => {
          const active = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`block rounded-lg px-3 py-2 font-medium ${
                active ? "bg-finbra-purple/10 text-finbra-purple" : "text-black/70 hover:bg-black/5"
              }`}
            >
              {link.label}
            </Link>
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
