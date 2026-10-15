import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { pendientesDeHoy, type Tono } from "@/lib/db/inicio";
import { codigoDeError } from "@/lib/collections/errors";
import Card from "@/components/ui/Card";

const TONO: Record<Tono, string> = {
  urgente: "bg-red-100 text-red-700",
  atencion: "bg-finbra-purple/10 text-finbra-purple",
  normal: "bg-black/5 text-black/70",
};

/** "Miércoles, 14 de octubre": solo la primera letra en mayúscula. */
const fechaLarga = () => {
  const f = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", weekday: "long", day: "numeric", month: "long" }).format(new Date());
  return f.charAt(0).toUpperCase() + f.slice(1);
};

export default async function InicioPage() {
  const session = await getAdminSession();
  if (!session) return null;
  const nombre = session.nombre.split(" ")[0];

  let areas: Awaited<ReturnType<typeof pendientesDeHoy>>;
  try {
    areas = await pendientesDeHoy(session.role);
  } catch (e) {
    const c = codigoDeError("inicio general", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los pendientes. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  const total = areas.reduce((s, a) => s + a.pendientes.length, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <p className="text-sm text-finbra-gray">{fechaLarga()}</p>
        <h1 className="mt-1 text-3xl font-bold">Hola, {nombre}</h1>
        <p className="mt-2 text-finbra-gray">{total === 0 ? "No hay nada pendiente por ahora." : "Esto es lo que necesita atención hoy."}</p>
      </div>

      <div className="grid gap-6">
        {areas.map((a) => (
          <Card key={a.area} className="p-0">
            <div className="flex items-center justify-between px-6 pt-5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-finbra-gray">{a.area}</h2>
              <Link href={a.href} className="text-sm font-medium text-finbra-purple hover:underline">
                Ir a {a.area} →
              </Link>
            </div>
            {a.pendientes.length === 0 ? (
              <p className="px-6 pb-5 pt-3 text-sm text-emerald-700">✓ Todo al día</p>
            ) : (
              <ul className="mt-2 divide-y divide-black/5">
                {a.pendientes.map((p) => (
                  <li key={p.texto}>
                    <Link href={p.href} className="flex items-center gap-4 px-6 py-3 hover:bg-black/[0.02]">
                      <span className={`min-w-10 rounded-full px-3 py-1 text-center text-sm font-bold tabular-nums ${TONO[p.tono]}`}>{p.etiqueta ?? p.cantidad}</span>
                      <span className="flex-1 text-sm">{p.texto}</span>
                      <span className="text-finbra-gray" aria-hidden>›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
