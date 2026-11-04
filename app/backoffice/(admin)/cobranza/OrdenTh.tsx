import Link from "next/link";

/**
 * Encabezado de tabla que ordena la lista al darle clic (por la URL, sin
 * JavaScript). `direccion` es cómo queda la lista: de la A a la Z o del más
 * cercano ("asc"), o del mayor al menor ("desc").
 */
export default function OrdenTh(p: { label: string; titulo: string; href: string; activo: boolean; direccion: "asc" | "desc"; alinear?: "right" }) {
  return (
    <th scope="col" aria-sort={p.activo ? (p.direccion === "asc" ? "ascending" : "descending") : undefined} className={`px-4 py-3 ${p.alinear === "right" ? "text-right" : ""}`}>
      <Link href={p.href} title={`Ordenar por ${p.titulo}`} className={`inline-flex items-center gap-1 hover:text-finbra-purple ${p.activo ? "font-bold text-finbra-purple" : ""}`}>
        {p.label}
        <span aria-hidden className={p.activo ? "" : "opacity-30"}>{p.direccion === "asc" ? "▴" : "▾"}</span>
      </Link>
    </th>
  );
}
