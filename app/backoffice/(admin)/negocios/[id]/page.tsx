import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { fechaMexico } from "@/lib/collections/rules";
import { formatFecha, formatFechaHora, formatMoney } from "@/lib/format";
import { getNegocio, hayNegocios } from "@/lib/db/negocios";
import { listEjecutivos } from "@/lib/db/empresas";
import { getHistorial } from "@/lib/db/personas";
import { getTareasEmpresa } from "@/lib/db/tareas";
import { TIPOS_TAREA } from "@/lib/clientes/tareas";
import { DESTINOS, ETAPAS_NEGOCIO, ETIQUETA_ETAPA, GARANTIAS, ORIGENES_NEGOCIO, PRODUCTOS, TIPOS_NEGOCIO, diasEnEtapa, estaAbierto, type ParaRequisitos } from "@/lib/clientes/negocios";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import PlazoChip from "../../clientes/PlazoChip";
import EtapaNegocioChip from "../EtapaNegocioChip";
import { EditarNegocio, MoverEtapa, Solicitud } from "./Controles";

const PASOS = ETAPAS_NEGOCIO.filter((e) => e.value !== "pospuesto" && e.value !== "rechazado");

export default async function NegocioPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!puede(session, "originacion.ver")) {
    return <EmptyState title="No tienes acceso a Negocios" description="Tu rol no puede ver la originación." />;
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const puedeOperar = puede(session, "originacion.operar");
  const hoy = fechaMexico();

  let datos: Awaited<ReturnType<typeof getNegocio>>;
  try {
    if (!(await hayNegocios())) notFound();
    datos = await getNegocio(id);
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_")) throw e;
    const c = codigoDeError("originación: ficha de negocio", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar el negocio. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  if (!datos) notFound();
  const { negocio: n, etapas } = datos;
  const [ejecutivos, tareas, historial] = await Promise.all([
    puedeOperar ? listEjecutivos() : Promise.resolve([]),
    getTareasEmpresa(n.empresaId),
    getHistorial(n.empresaId),
  ]);
  const dias = diasEnEtapa(n.etapaDesde, hoy);
  const actual = PASOS.findIndex((p) => p.value === n.etapa);
  const ficha = `/backoffice/clientes/${n.empresaId}`;
  const requisitos: ParaRequisitos = { producto: n.producto, montoEstimado: n.montoEstimado, plazoMeses: n.plazoMeses, destino: n.destino, garantiaTipo: n.garantiaTipo, rfcEmpresa: n.rfcEmpresa };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/backoffice/negocios" className="text-sm text-finbra-purple hover:underline">← Negocios</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-bold">
              <Link href={ficha} className="hover:text-finbra-purple hover:underline">{n.empresa}</Link>
            </h1>
            <p className="text-sm text-finbra-gray">
              {n.producto ? PRODUCTOS[n.producto] : TIPOS_NEGOCIO[n.tipo]}{n.producto && n.tipo !== "nuevo" ? ` (${TIPOS_NEGOCIO[n.tipo].toLowerCase()})` : ""}{n.plazoMeses ? ` a ${n.plazoMeses} meses` : ""} · llegó por {ORIGENES_NEGOCIO[n.origen]} · alta el {formatFecha(n.createdAt.slice(0, 10))}
              {!n.esCliente && " · la empresa es prospecto"}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <EtapaNegocioChip etapa={n.etapa} />
              <span className="text-sm text-finbra-gray">{dias === 0 ? "desde hoy" : `hace ${dias} ${dias === 1 ? "día" : "días"}`}</span>
            </div>
          </div>
          <div className="space-y-1 text-sm sm:text-right">
            <p className="text-2xl font-bold tabular-nums text-finbra-purple">{n.montoEstimado !== null ? formatMoney(n.montoEstimado) : "Sin monto"}</p>
            <p className="text-xs text-finbra-gray">Monto estimado: no es una oferta ni una aprobación.</p>
            <p>
              <span className="text-finbra-gray">Responsable: </span>
              {n.responsableNombre ?? <span className="text-amber-800">Sin responsable</span>}
            </p>
          </div>
        </div>
      </div>

      <Card className="overflow-x-auto">
        <ol className="flex min-w-[760px] items-center gap-1" aria-label="Avance del negocio">
          {PASOS.map((p, i) => {
            const hecho = actual >= 0 && i < actual;
            const ahora = i === actual;
            return (
              <li key={p.value} className="flex flex-1 items-center gap-1" aria-current={ahora ? "step" : undefined}>
                <span
                  className={`flex-1 rounded-full px-2 py-1.5 text-center text-xs font-semibold ${
                    ahora ? "bg-finbra-purple text-white" : hecho ? "bg-finbra-purple/15 text-finbra-purple-700" : "bg-black/5 text-finbra-gray"
                  }`}
                  title={p.que}
                >
                  {p.label}
                </span>
              </li>
            );
          })}
        </ol>
        {!estaAbierto(n.etapa) && n.etapa !== "dispersado" && (
          <p className="mt-3 text-sm">
            <span className="font-semibold">{ETIQUETA_ETAPA[n.etapa]}:</span> {n.motivoCierre ?? "sin motivo"}
            {n.etapa === "pospuesto" && n.recontactarEl && <span className="text-finbra-gray"> · volver a contactar el {formatFecha(n.recontactarEl)}</span>}
            {n.etapa === "rechazado" && n.rechazoPor && <span className="text-finbra-gray"> · {n.rechazoPor === "finbra" ? "Finbra no lo aprobó" : "el cliente desistió"}</span>}
          </p>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          {puedeOperar && (
            <Card className="space-y-3">
              <h2 className="text-lg font-bold">Etapa</h2>
              <MoverEtapa id={n.id} etapa={n.etapa} hoy={hoy} requisitos={requisitos} />
            </Card>
          )}
          <Card className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold">Solicitud</h2>
              <span className="text-xs text-finbra-gray">
                RFC de la empresa: {n.rfcEmpresa ? <span className="font-mono">{n.rfcEmpresa}</span> : <Link href={`${ficha}?tab=datos`} className="text-finbra-purple hover:underline">falta capturarlo</Link>}
              </span>
            </div>
            {puedeOperar ? (
              <Solicitud id={n.id} s={n} />
            ) : (
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-finbra-gray">Producto</dt><dd>{n.producto ? PRODUCTOS[n.producto] : "—"}</dd></div>
                <div><dt className="text-finbra-gray">Plazo</dt><dd>{n.plazoMeses ? `${n.plazoMeses} meses` : "—"}</dd></div>
                <div><dt className="text-finbra-gray">Destino</dt><dd>{n.destino ? DESTINOS[n.destino] : "—"}{n.destinoDetalle && ` · ${n.destinoDetalle}`}</dd></div>
                <div>
                  <dt className="text-finbra-gray">Garantía</dt>
                  <dd>
                    {n.garantiaTipo ? GARANTIAS[n.garantiaTipo] : "—"}
                    {n.garantiaDetalle && ` · ${n.garantiaDetalle}`}
                    {n.garantiaValor !== null && ` · ${formatMoney(n.garantiaValor)}`}
                  </dd>
                </div>
              </dl>
            )}
          </Card>
          <Card className="space-y-3">
            <h2 className="text-lg font-bold">Responsable y notas</h2>
            {puedeOperar ? (
              <EditarNegocio id={n.id} responsable={n.responsableEmail} notas={n.notas} ejecutivos={ejecutivos} />
            ) : (
              <p className="whitespace-pre-line text-sm">{n.notas ?? <span className="text-finbra-gray">Sin notas.</span>}</p>
            )}
          </Card>
          <Card className="space-y-3">
            <h2 className="text-lg font-bold">Historial de etapas</h2>
            <ol className="space-y-3 border-l border-black/10 pl-4">
              {etapas.map((h, i) => (
                <li key={i} className="text-sm">
                  <p>
                    {h.de ? (
                      <>
                        {ETIQUETA_ETAPA[h.de]} → <span className="font-semibold">{ETIQUETA_ETAPA[h.a]}</span>
                      </>
                    ) : (
                      <span className="font-semibold">Alta como {ETIQUETA_ETAPA[h.a]}</span>
                    )}
                  </p>
                  {h.motivo && <p className="text-finbra-gray">{h.motivo}</p>}
                  <p className="text-xs text-finbra-gray">
                    {formatFechaHora(h.ocurridoAt)} · {h.actorNombre ?? h.actor}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold">Tareas de la empresa</h2>
              <Link href={`${ficha}?tab=tareas`} className="text-sm text-finbra-purple hover:underline">{puede(session, "clientes.editar") ? "Nueva tarea →" : "Ver todas →"}</Link>
            </div>
            {tareas.abiertas.length === 0 ? (
              <p className="text-sm text-finbra-gray">No hay tareas pendientes.</p>
            ) : (
              <ul className="divide-y divide-black/5">
                {tareas.abiertas.slice(0, 5).map((t) => (
                  <li key={t.id} className="space-y-1 py-2 text-sm first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <PlazoChip venceEl={t.venceEl} hoy={hoy} />
                      <span className="text-xs text-finbra-gray">{TIPOS_TAREA[t.tipo] ?? t.tipo} · {t.responsableNombre ?? t.responsableEmail ?? "Sin responsable"}</span>
                    </div>
                    <p>{t.titulo}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold">Última actividad</h2>
              <Link href={`${ficha}?tab=actividad`} className="text-sm text-finbra-purple hover:underline">{puede(session, "clientes.editar") ? "Registrar →" : "Ver todo →"}</Link>
            </div>
            {historial.length === 0 ? (
              <p className="text-sm text-finbra-gray">Sin actividad registrada.</p>
            ) : (
              <ol className="space-y-2">
                {historial.slice(0, 5).map((h) => (
                  <li key={h.id} className="text-sm">
                    <p>
                      <span className="font-semibold">{h.tipo}</span>
                      {h.descripcion && <span className="text-finbra-gray"> · {h.descripcion}</span>}
                    </p>
                    <p className="text-xs text-finbra-gray">{formatFechaHora(h.ocurridoAt)}{h.actor && ` · ${h.actor}`}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
