"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/recursos", label: "Recursos" },
];

export default function Nav({ nombre }: { nombre: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-black/5 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
        <div>
          <p className="text-sm font-bold text-finbra-purple">Finbra 360</p>
          {nombre && <p className="text-xs text-finbra-gray">Hola, {nombre}</p>}
        </div>
        <nav className="flex items-center gap-4 text-sm font-medium">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname === link.href ? "text-finbra-purple" : "text-black/70 hover:text-finbra-purple"}
            >
              {link.label}
            </Link>
          ))}
          <button type="button" onClick={handleLogout} className="text-black/70 hover:text-finbra-purple">
            Cerrar sesión
          </button>
        </nav>
      </div>
    </header>
  );
}
