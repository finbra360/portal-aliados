import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { pendientesDeHoy, type Tono } from "@/lib/db/inicio";
import { codigoDeError } from "@/lib/collections/errors";
import Card from "@/components/ui/Card";
import { puede } from "@/lib/permisos";
import { getMiCartera } from "@/lib/db/tareas";
import { TIPOS_TAREA, plazoDe, type TipoAviso } from "@/lib/clientes/tareas";
import PlazoChip from "../clientes/PlazoChip";
import CerrarTarea from "../clientes/[id]/CerrarTarea";

const AVISO: Record<TipoAviso, { clase: string; tab: string }> = {
  mora: { clase: "bg-red-100 text-red-700", tab: "" },
  sin_contacto: { clase: "bg-amber-100 text-amber-800", tab: "?tab=actividad" },
  sin_principal: { clase: "bg-black/5 text-black/70", tab: "?tab=contactos" },
};
const AVISO_CORTO: Record<TipoAviso, string> = { mora: "Mora", sin_contacto: "Contacto", sin_principal: "Datos" };
const MAX_TAREAS = 10;
const MAX_AVISOS = 8;

type MiCartera = Awaited<ReturnType<typeof getMiCartera>>;

/** Lo de cada ejecutivo: sus tareas próximas y los avisos de sus clientes. */
function SeccionMiCartera({ c, puedeEditar }: { c: MiCartera; puedeEditar: boolean }) {
  const proximas = c.tareas.filter((t) => plazoDe(t.venceEl, c.hoy) !== "despues");
  const vencidas = c.tareas.filter((t) => plazoDe(t.venceEl, c.hoy) === "vencida").length;
  const deHoy = c.tareas.filter((t) => plazoDe(t.venceEl, c.hoy) === "hoy").length;
  const despues = c.tareas.length - proximas.length;
  const cifras = [
    { valor: c.clientes, texto: c.clientes === 1 ? "cliente mío" : "clientes míos", clase: "text-finbra-purple" },
    { valor: deHoy, texto: deHoy === 1 ? "tarea para hoy" : "tareas para hoy", clase: deHoy ? "text-amber-700" : "text-finbra-purple" },
    { valor: vencidas, texto: vencidas === 1 ? "tarea vencida" : "tareas vencidas", clase: vencidas ? "text-red-700" : "text-finbra-purple" },
    { valor: c.avisos.length, texto: c.avisos.length === 1 ? "aviso" : "avisos", clase: c.avisos.length ? "text-amber-700" : "text-finbra-purple" },
  ];
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between px-6 pt-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-finbra-gray">Mi cartera</h2>
        <Link href="/backoffice/clientes?filtro=mios" className="text-sm font-medium text-finbra-purple hover:underline">Ir a mis clientes →</Link>
      </div>
      <dl className="grid grid-cols-2 gap-4 px-6 pt-4 sm:grid-cols-4">
        {cifras.map((x) => (
          <div key={x.texto}>
            <dd className={`text-2xl font-bold tabular-nums ${x.clase}`}>{x.valor}</dd>
            <dt className="text-xs text-finbra-gray">{x.texto}</dt>
          </div>
        ))}
      </dl>

      <h3 className="px-6 pt-5 text-sm font-semibold">Mis tareas de esta semana</h3>
      {proximas.length === 0 ? (
        <p className="px-6 pt-2 text-sm text-emerald-700">✓ Nada pendiente esta semana{despues ? ` (${despues} más adelante)` : ""}</p>
      ) : (
        <ul className="mt-2 divide-y divide-black/5">
          {proximas.slice(0, MAX_TAREAS).map((t) => (
            <li key={t.id} className="space-y-1.5 px-6 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <PlazoChip venceEl={t.venceEl} hoy={c.hoy} />
                <Link href={`/backoffice/clientes/${t.empresaId}?tab=tareas`} className="text-sm font-semibold text-finbra-purple-700 hover:underline">{t.empresa}</Link>
                <span className="text-xs text-finbra-gray">· {TIPOS_TAREA[t.tipo] ?? t.tipo}</span>
              </div>
              <p className="text-sm">{t.titulo}</p>
              {puedeEditar && <CerrarTarea empresaId={t.empresaId} tareaId={t.id} />}
            </li>
          ))}
        </ul>
      )}
      {(proximas.length > MAX_TAREAS || (proximas.length > 0 && despues > 0)) && (
        <p className="px-6 pt-1 text-xs text-finbra-gray">
          {proximas.length > MAX_TAREAS && `y ${proximas.length - MAX_TAREAS} más esta semana. `}
          {despues > 0 && `${despues} ${despues === 1 ? "tarea" : "tareas"} para más adelante.`}
        </p>
      )}

      <h3 className="px-6 pt-5 text-sm font-semibold">Avisos de mis clientes</h3>
      {c.avisos.length === 0 ? (
        <p className="px-6 pb-5 pt-2 text-sm text-emerald-700">✓ {c.clientes ? "Todo en orden" : "Todavía no tienes clientes asignados"}</p>
      ) : (
        <ul className="mt-2 divide-y divide-black/5 pb-2">
          {c.avisos.slice(0, MAX_AVISOS).map((a) => (
            <li key={`${a.empresaId}-${a.tipo}`}>
              <Link href={`/backoffice/clientes/${a.empresaId}${AVISO[a.tipo].tab}`} className="flex items-center gap-4 px-6 py-3 hover:bg-black/[0.02]">
                <span className={`min-w-20 rounded-full px-3 py-1 text-center text-xs font-bold ${AVISO[a.tipo].clase}`}>{AVISO_CORTO[a.tipo]}</span>
                <span className="flex-1 text-sm">
                  <span className="font-semibold">{a.nombre}</span>
                  <span className="text-finbra-gray"> · {a.texto}</span>
                </span>
                <span className="text-finbra-gray" aria-hidden>›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {c.avisos.length > MAX_AVISOS && <p className="px-6 pb-5 text-xs text-finbra-gray">y {c.avisos.length - MAX_AVISOS} avisos más.</p>}
    </Card>
  );
}

const TONO: Record<Tono, string> = {
  urgente: "bg-red-100 text-red-700",
  atencion: "bg-finbra-purple/10 text-finbra-purple-700",
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
  let cartera: MiCartera | null = null;
  try {
    [areas, cartera] = await Promise.all([
      pendientesDeHoy(session.role),
      puede(session, "cartera.ver") ? getMiCartera(session.email) : Promise.resolve(null),
    ]);
  } catch (e) {
    const c = codigoDeError("inicio general", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los pendientes. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  const total = areas.reduce((s, a) => s + a.pendientes.length, 0) + (cartera ? cartera.tareas.length + cartera.avisos.length : 0);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <p className="text-sm text-finbra-gray">{fechaLarga()}</p>
        <h1 className="mt-1 text-3xl font-bold">Hola, {nombre}</h1>
        <p className="mt-2 text-finbra-gray">{total === 0 ? "No hay nada pendiente por ahora." : "Esto es lo que necesita atención hoy."}</p>
      </div>

      <div className="grid gap-6">
        {cartera && <SeccionMiCartera c={cartera} puedeEditar={puede(session, "clientes.editar")} />}
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
