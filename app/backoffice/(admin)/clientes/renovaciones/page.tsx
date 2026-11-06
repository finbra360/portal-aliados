import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { getRadar, type FilaRadar } from "@/lib/db/renovaciones";
import { codigoDeError } from "@/lib/collections/errors";
import { formatFecha, formatMoney } from "@/lib/format";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import PhotoBanner from "../../cobranza/PhotoBanner";
import OportunidadChip from "../OportunidadChip";
import CorrerRadar from "./CorrerRadar";

const BASE = "/backoffice/clientes/renovaciones";
const FILTROS = [
  { value: "todos", label: "Todos" },
  { value: "mios", label: "Mis clientes" },
  { value: "califican", label: "Califican" },
  { value: "no_califican", label: "No califican" },
] as const;
type Filtro = (typeof FILTROS)[number]["value"];

const dias = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;

function FinPlazo({ f }: { f: FilaRadar }) {
  return (
    <>
      {formatFecha(f.fechaTermino)}
      <span className={`block text-xs ${f.dias < 0 ? "text-red-700" : f.dias <= 30 ? "font-semibold text-finbra-purple-700" : "text-finbra-gray"}`}>
        {f.dias < 0 ? `terminó hace ${dias(-f.dias)}` : f.dias === 0 ? "termina hoy" : `en ${dias(f.dias)}`}
      </span>
    </>
  );
}

export default async function RenovacionesPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const session = await getAdminSession();
  if (!puede(session, "cartera.ver")) {
    return <EmptyState title="No tienes acceso a Clientes" description="Tu rol no puede ver la cartera. Si la necesitas, pídele a un Super Admin que cambie tu rol en Usuarios." />;
  }
  const { f } = await searchParams;
  const filtro: Filtro = FILTROS.some((x) => x.value === f) ? (f as Filtro) : "todos";

  let radar: Awaited<ReturnType<typeof getRadar>>;
  try {
    radar = await getRadar();
  } catch (e) {
    const c = codigoDeError("radar de renovación", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar las renovaciones. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  const { filas, ajustes, status } = radar;
  const mayor = Math.max(...ajustes.ventanas);
  const conteos: Record<Filtro, number> = {
    todos: filas.length,
    mios: filas.filter((x) => x.ejecutivoEmail === session.email).length,
    califican: filas.filter((x) => x.evaluacion.califica).length,
    no_califican: filas.filter((x) => !x.evaluacion.califica).length,
  };
  const visibles = filas.filter((x) =>
    filtro === "mios" ? x.ejecutivoEmail === session.email : filtro === "califican" ? x.evaluacion.califica : filtro === "no_califican" ? !x.evaluacion.califica : true,
  );
  // Grupos: plazo terminado y cada ventana (de la más próxima a la más lejana).
  const ventanas = [...ajustes.ventanas].sort((a, b) => a - b);
  const grupos = [
    { titulo: "Plazo terminado y sigue en SIAC", filas: visibles.filter((x) => x.dias < 0) },
    ...ventanas.map((v, i) => ({
      titulo: i === 0 ? `Terminan en ${v} días o menos` : `Terminan en ${ventanas[i - 1] + 1} a ${v} días`,
      filas: visibles.filter((x) => x.ventana === v),
    })),
  ].filter((g) => g.filas.length);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl space-y-1">
          <h1 className="text-2xl font-bold">Renovaciones</h1>
          <p className="text-sm text-finbra-gray">
            Créditos vigentes que terminan en los próximos {mayor} días. Cada día, después de la foto de SIAC, el radar abre una oportunidad para los
            clientes que califican y le deja la tarea a su ejecutivo; a {ventanas.filter((v) => v !== mayor).join(" y ")} días deja un recordatorio.
          </p>
          <p className="text-xs text-finbra-gray">Una oportunidad solo autoriza a contactar al cliente: no es una aprobación de crédito y el monto no es una oferta.</p>
        </div>
        {puede(session, "clientes.configurar") && <CorrerRadar />}
      </div>
      <PhotoBanner status={status} />
      {!radar.esquema && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Falta correr <span className="font-mono">crm-schema.sql</span> en la base: el radar todavía no puede abrir oportunidades.
        </p>
      )}
      {!ajustes.activo && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          El radar automático está apagado: no abre oportunidades nuevas ni deja recordatorios (sí cierra las que ya no aplican).
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((x) => (
          <Link
            key={x.value}
            href={x.value === "todos" ? BASE : `${BASE}?f=${x.value}`}
            className={`rounded-full px-3 py-1 text-sm font-medium ${filtro === x.value ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"}`}
          >
            {x.label} ({conteos[x.value]})
          </Link>
        ))}
      </div>

      {grupos.length === 0 ? (
        <Card>
          <p className="text-sm text-finbra-gray">
            {filas.length === 0 ? `Ningún crédito vigente termina en los próximos ${mayor} días.` : "Nada con este filtro."}
          </p>
        </Card>
      ) : (
        grupos.map((g) => (
          <Card key={g.titulo} className="overflow-x-auto p-0">
            <h2 className="px-6 pt-5 text-lg font-bold">
              {g.titulo} <span className="font-normal text-finbra-gray">({g.filas.length})</span>
            </h2>
            <table className="mt-3 w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th scope="col" className="px-6 py-2">Cliente</th>
                  <th scope="col" className="px-4 py-2">Crédito</th>
                  <th scope="col" className="px-4 py-2">Fin de plazo</th>
                  <th scope="col" className="px-4 py-2">Mensualidades</th>
                  <th scope="col" className="px-4 py-2">¿Califica?</th>
                  <th scope="col" className="px-4 py-2">Oportunidad</th>
                </tr>
              </thead>
              <tbody>
                {g.filas.map((x) => (
                  <tr key={x.creditId} className="border-b border-black/5 align-top last:border-0">
                    <td className="px-6 py-3">
                      <Link href={`/backoffice/clientes/${x.empresaId}`} className="font-semibold text-finbra-purple-700 hover:underline">{x.empresa}</Link>
                      <span className="block text-xs text-finbra-gray">{x.ejecutivoNombre ?? "Sin ejecutivo"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono font-semibold">{x.noCredito}</span>
                      <span className="block text-xs text-finbra-gray">{x.montoCredito === null ? "—" : formatMoney(x.montoCredito)}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3"><FinPlazo f={x} /></td>
                    <td className="px-4 py-3 text-xs">{x.cubiertos !== null && x.vencimientos ? `${x.cubiertos} de ${x.vencimientos} pagadas` : "—"}</td>
                    <td className="px-4 py-3">
                      {x.evaluacion.califica ? (
                        <span className="text-xs font-semibold text-emerald-700">✓ Califica</span>
                      ) : (
                        <ul className="space-y-0.5 text-xs text-red-700">
                          {x.evaluacion.motivos.map((m) => (
                            <li key={m}>✗ {m}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {x.oportunidad ? (
                        <Link href={`/backoffice/clientes/${x.empresaId}`} className="hover:opacity-80"><OportunidadChip estado={x.oportunidad.estado} /></Link>
                      ) : (
                        <span className="text-xs text-finbra-gray">{x.evaluacion.califica && x.dias >= 0 ? "Se abre en la próxima revisión" : "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      )}
      <p className="text-xs text-finbra-gray">
        Califica quien está al corriente en todos sus créditos, con un peor atraso de {ajustes.atrasoMaximoHistorico} días o menos, {ajustes.vecesMoraMax} veces en mora o menos, y
        sin jurídico, extrajudicial, reestructura ni pausa. Datos de la última foto completa de SIAC. Si cae en mora o el crédito sale del listado, el radar cierra la oportunidad.
      </p>
    </div>
  );
}
