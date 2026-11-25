import Link from "next/link";

/** Negocios | Contactos, arriba de las dos pantallas de importar de HubSpot. */
export default function PestanasImportar({ actual }: { actual: "negocios" | "contactos" }) {
  const clase = (activa: boolean) =>
    `rounded-md px-4 py-1.5 text-sm ${activa ? "bg-white font-semibold shadow-sm" : "text-finbra-gray hover:text-black"}`;
  return (
    <nav aria-label="Qué importar" className="inline-flex gap-1 rounded-lg bg-black/5 p-1">
      <Link href="/backoffice/negocios/importar" aria-current={actual === "negocios" ? "page" : undefined} className={clase(actual === "negocios")}>
        Negocios
      </Link>
      <Link href="/backoffice/negocios/importar/contactos" aria-current={actual === "contactos" ? "page" : undefined} className={clase(actual === "contactos")}>
        Contactos
      </Link>
    </nav>
  );
}
