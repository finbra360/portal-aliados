import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { getPhotoStatus } from "@/lib/db/collections";
import { getEmpresa, listEjecutivos, type FichaCredito } from "@/lib/db/empresas";
import { ETAPAS } from "@/lib/collections/gestiones";
import { codigoDeError } from "@/lib/collections/errors";
import { formatFecha, formatFechaHora, formatMoney, formatTelefono } from "@/lib/format";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ProgressBar from "@/components/ui/ProgressBar";
import PhotoBanner from "../../cobranza/PhotoBanner";
import SemaforoPill from "../../cobranza/SemaforoPill";
import EtapaChip from "../EtapaChip";
import EditarEmpresa from "./EditarEmpresa";
import ContactosEmpresa from "./ContactosEmpresa";
import RegistrarActividad from "./RegistrarActividad";
import { getContactos, getHistorial } from "@/lib/db/personas";
import { CANALES, FILTROS_HISTORIAL, ROLES_DECISION, type EntradaHistorial, type OrigenHistorial } from "@/lib/clientes/personas";
import { getTareasEmpresa, type Tarea } from "@/lib/db/tareas";
import { TIPOS_TAREA } from "@/lib/clientes/tareas";
import PlazoChip from "../PlazoChip";
import NuevaTarea from "./NuevaTarea";
import CerrarTarea from "./CerrarTarea";

const BASE = "/backoffice/clientes";
const PESTANAS = [
  { value: "resumen", label: "Resumen" },
  { value: "contactos", label: "Contactos" },
  { value: "actividad", label: "Actividad" },
  { value: "tareas", label: "Tareas" },
  { value: "creditos", label: "Créditos" },
  { value: "datos", label: "Datos de la empresa" },
] as const;

const ORIGEN_CLASE: Record<OrigenHistorial, string> = {
  comercial: "bg-finbra-purple/10 text-finbra-purple-700",
  cobranza: "bg-amber-100 text-amber-800",
  siac: "bg-black/5 text-finbra-gray",
};
const ORIGEN_LABEL: Record<OrigenHistorial, string> = { comercial: "Comercial", cobranza: "Cobranza", siac: "SIAC" };

/** Una línea del historial unificado. */
function Entrada({ e }: { e: EntradaHistorial }) {
  return (
    <li className="space-y-0.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-finbra-gray">
        <span>{formatFechaHora(e.ocurridoAt)}</span>
        <span className={`rounded-full px-2 py-0.5 font-semibold ${ORIGEN_CLASE[e.origen]}`}>{ORIGEN_LABEL[e.origen]}</span>
        <span className="font-semibold text-black">{e.tipo}</span>
        {e.resultado && <span>· {e.resultado}</span>}
        {e.persona && <span>· con {e.persona}</span>}
        {e.actor && <span>· {e.actor}</span>}
      </p>
      {e.descripcion && <p className="whitespace-pre-line text-sm">{e.descripcion}</p>}
    </li>
  );
}
type Pestana = (typeof PESTANAS)[number]["value"];

/** Una tarea abierta: fecha, qué hay que hacer, responsable y, si se puede, los botones para cerrarla. */
function TareaAbierta({ t, hoy, empresaId, puedeEditar }: { t: Tarea; hoy: string; empresaId: string; puedeEditar: boolean }) {
  return (
    <li className="space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <PlazoChip venceEl={t.venceEl} hoy={hoy} />
        <span className="text-xs text-finbra-gray">{TIPOS_TAREA[t.tipo] ?? t.tipo}</span>
        <span className="text-xs text-finbra-gray">· {t.responsableNombre ?? t.responsableEmail ?? "Sin responsable"}</span>
      </div>
      <p className="text-sm font-semibold">{t.titulo}</p>
      {t.descripcion && <p className="whitespace-pre-line text-sm text-finbra-gray">{t.descripcion}</p>}
      {puedeEditar && <CerrarTarea empresaId={empresaId} tareaId={t.id} />}
    </li>
  );
}

const dinero = (v: number | null) => (v === null ? "—" : formatMoney(v));
const etapaManual = (e: string | null) => (e && e in ETAPAS ? ETAPAS[e as keyof typeof ETAPAS] : null);

function Avance({ c }: { c: FichaCredito }) {
  if (c.cubiertos === null || !c.vencimientos) return <>—</>;
  return (
    <span className="block w-32">
      <span className="text-xs">{c.cubiertos} de {c.vencimientos} pagadas</span>
      <ProgressBar percent={(c.cubiertos / c.vencimientos) * 100} label={`${c.cubiertos} de ${c.vencimientos} mensualidades pagadas`} />
      {!!c.vencidos && <span className="block text-xs text-red-700">{c.vencidos === 1 ? "1 vencida" : `${c.vencidos} vencidas`}</span>}
    </span>
  );
}

function Estado({ c }: { c: FichaCredito }) {
  if (!c.enListado) return <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-finbra-gray">Salió de SIAC</span>;
  const manual = etapaManual(c.etapaManual);
  return (
    <span className="flex flex-col items-start gap-1">
      {c.atraso ? <span className="text-xs font-semibold text-red-700">{c.atraso} {c.atraso === 1 ? "día" : "días"} de atraso</span> : <span className="text-xs text-emerald-700">Al corriente</span>}
      {manual && <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-finbra-gray">{manual}</span>}
    </span>
  );
}

function FinPlazo({ fecha, hoy }: { fecha: string | null; hoy: string }) {
  if (!fecha) return <>—</>;
  const d = Math.round((Date.parse(fecha) - Date.parse(hoy)) / 86_400_000);
  return (
    <>
      {formatFecha(fecha)}
      <span className={`block text-xs ${d >= 0 && d <= 90 ? "font-semibold text-finbra-purple-700" : "text-finbra-gray"}`}>
        {d < 0 ? "ya terminó" : d === 0 ? "termina hoy" : `en ${d} ${d === 1 ? "día" : "días"}`}
      </span>
    </>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[170px_1fr]">
      <dt className="text-finbra-gray">{etiqueta}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-finbra-gray">—</span>}</dd>
    </div>
  );
}

export default async function FichaClientePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; f?: string }> }) {
  const session = await getAdminSession();
  if (!puede(session, "cartera.ver")) {
    return <EmptyState title="No tienes acceso a Clientes" description="Tu rol no puede ver la cartera. Si la necesitas, pídele a un Super Admin que cambie tu rol en Usuarios." />;
  }
  const puedeEditar = puede(session, "clientes.editar");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { tab, f } = await searchParams;
  const pestana: Pestana = PESTANAS.some((p) => p.value === tab) ? (tab as Pestana) : "resumen";
  const filtro = FILTROS_HISTORIAL.find((x) => x.value === f)?.value ?? "todo";

  let ficha: Awaited<ReturnType<typeof getEmpresa>>;
  let status: Awaited<ReturnType<typeof getPhotoStatus>>;
  let ejecutivos: Awaited<ReturnType<typeof listEjecutivos>> = [];
  let contactos: Awaited<ReturnType<typeof getContactos>> = { personas: [], canales: [], clientes: [] };
  let historial: EntradaHistorial[] = [];
  let tareas: Awaited<ReturnType<typeof getTareasEmpresa>> = { abiertas: [], cerradas: [] };
  try {
    [ficha, status, ejecutivos, contactos, historial, tareas] = await Promise.all([
      getEmpresa(id),
      getPhotoStatus(),
      (pestana === "datos" || pestana === "tareas") && puedeEditar ? listEjecutivos() : Promise.resolve([]),
      ["resumen", "contactos", "actividad"].includes(pestana) ? getContactos(id) : Promise.resolve(contactos),
      pestana === "actividad" ? getHistorial(id, filtro) : pestana === "resumen" ? getHistorial(id) : Promise.resolve([]),
      pestana === "resumen" || pestana === "tareas" ? getTareasEmpresa(id) : Promise.resolve(tareas),
    ]);
  } catch (e) {
    const c = codigoDeError("ficha de cliente", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar la ficha del cliente. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  if (!ficha) notFound();

  const { empresa: e, clientes, creditos, resumen: r } = ficha;
  const principal = contactos.personas.find((p) => p.esPrincipal && p.vigente) ?? null;
  const canalesPrincipal = principal
    ? contactos.canales.filter((k) => k.personaId === principal.id && k.estatus === "activo").map((k) => (k.tipo === "telefono" ? formatTelefono(k.valor) : k.valor))
    : [];
  const vigentes = creditos.filter((c) => c.enListado);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

  return (
    <div className="space-y-6">
      <div>
        <Link href={BASE} className="text-sm text-finbra-purple hover:underline">← Clientes</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-bold">{e.nombre}</h1>
            <p className="text-sm text-finbra-gray">
              {e.razonSocial && e.razonSocial !== e.nombre && <>{e.razonSocial} · </>}
              {e.rfc ? <span className="font-mono">{e.rfc}</span> : <span className="text-amber-800">Sin RFC</span>}
              {e.industria && <> · {e.industria}</>}
            </p>
            <div className="flex flex-wrap items-start gap-2 pt-1">
              <EtapaChip etapa={r.etapa} />
              <SemaforoPill semaforo={r.semaforo} historial={r.historial} detalle />
            </div>
          </div>
          <div className="space-y-2 text-sm sm:text-right">
            <p>
              <span className="text-finbra-gray">Ejecutivo: </span>
              {e.ejecutivoNombre ?? <span className="text-amber-800">Sin asignar</span>}
            </p>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {clientes.map((c) => (
                <Link
                  key={c.id}
                  href={`/backoffice/cobranza/clientes/${c.id}`}
                  className="rounded-lg border border-finbra-purple/30 px-3 py-1.5 text-sm font-semibold text-finbra-purple-700 hover:bg-finbra-purple/5"
                >
                  Expediente de cobranza{clientes.length > 1 ? ` ${c.numeroCliente}` : ""}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
      <PhotoBanner status={status} />

      <nav aria-label="Secciones de la ficha" className="flex flex-wrap gap-1 border-b border-black/10">
        {PESTANAS.map((p) => (
          <Link
            key={p.value}
            href={p.value === "resumen" ? `${BASE}/${id}` : `${BASE}/${id}?tab=${p.value}`}
            aria-current={pestana === p.value ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${pestana === p.value ? "border-finbra-purple text-finbra-purple-700" : "border-transparent text-finbra-gray hover:text-black"}`}
          >
            {p.label}
            {p.value === "creditos" && <span className="font-normal"> ({creditos.length})</span>}
            {p.value === "tareas" && tareas.abiertas.length > 0 && <span className="font-normal"> ({tareas.abiertas.length})</span>}
          </Link>
        ))}
      </nav>

      {pestana === "resumen" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <Card>
              <p className="text-sm text-finbra-gray">Adeudo total</p>
              <p className="mt-1 break-words text-xl font-bold tabular-nums xl:text-2xl text-finbra-purple">{formatMoney(r.adeudo)}</p>
              <p className="mt-1 text-xs text-finbra-gray">{r.creditosVigentes} {r.creditosVigentes === 1 ? "crédito vigente" : "créditos vigentes"}</p>
            </Card>
            <Card>
              <p className="text-sm text-finbra-gray">Vencido</p>
              <p className={`mt-1 break-words text-xl font-bold tabular-nums xl:text-2xl ${r.vencido > 0 ? "text-red-700" : "text-finbra-purple"}`}>{formatMoney(r.vencido)}</p>
              <p className="mt-1 text-xs text-finbra-gray">{r.maxAtraso ? `${r.maxAtraso} días de atraso` : r.creditosVigentes ? "Al corriente" : "—"}</p>
            </Card>
            <Card>
              <p className="text-sm text-finbra-gray">Próximo pago</p>
              <p className="mt-1 break-words text-xl font-bold tabular-nums xl:text-2xl text-finbra-purple">{r.proximoPago ? formatFecha(r.proximoPago.fecha) : "—"}</p>
              <p className="mt-1 text-xs text-finbra-gray">{r.proximoPago?.monto != null ? formatMoney(r.proximoPago.monto) : "Monto pendiente de SIAC"}</p>
            </Card>
            <Card>
              <p className="text-sm text-finbra-gray">Monto original vigente</p>
              <p className="mt-1 break-words text-xl font-bold tabular-nums xl:text-2xl text-finbra-purple">{formatMoney(r.montoOriginal)}</p>
              <p className="mt-1 text-xs text-finbra-gray">{r.finPlazo ? `Primer fin de plazo: ${formatFecha(r.finPlazo.fecha)}` : "Sin fin de plazo próximo"}</p>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card className="overflow-x-auto p-0">
              <div className="flex items-baseline justify-between px-6 pt-5">
                <h2 className="text-lg font-bold">Créditos vigentes</h2>
                <Link href={`${BASE}/${id}?tab=creditos`} className="text-sm text-finbra-purple hover:underline">Ver todos →</Link>
              </div>
              {vigentes.length === 0 ? (
                <p className="px-6 py-5 text-sm text-finbra-gray">{creditos.length ? "Ya no tiene créditos en el listado de SIAC." : "Todavía no tiene créditos en SIAC."}</p>
              ) : (
                <table className="mt-3 w-full min-w-[600px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                      <th scope="col" className="px-6 py-2">Crédito</th>
                      <th scope="col" className="px-4 py-2 text-right">Adeudo</th>
                      <th scope="col" className="px-4 py-2">Avance</th>
                      <th scope="col" className="px-4 py-2">Fin de plazo</th>
                      <th scope="col" className="px-4 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vigentes.map((c) => (
                      <tr key={c.creditId} className="border-b border-black/5 align-top last:border-0">
                        <td className="px-6 py-2">
                          <span className="font-mono font-semibold">{c.noCredito}</span>
                          <span className="block text-xs text-finbra-gray">{dinero(c.montoCredito)}</span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{dinero(c.adeudo)}</td>
                        <td className="px-4 py-2"><Avance c={c} /></td>
                        <td className="whitespace-nowrap px-4 py-2"><FinPlazo fecha={c.fechaTermino} hoy={hoy} /></td>
                        <td className="px-4 py-2"><Estado c={c} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <div className="space-y-6">
              <Card>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-lg font-bold">Contacto principal</h2>
                  <Link href={`${BASE}/${id}?tab=contactos`} className="text-sm text-finbra-purple hover:underline">Contactos →</Link>
                </div>
                {principal ? (
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold">
                      {principal.nombre}
                      {principal.puesto && <span className="font-normal text-finbra-gray"> · {principal.puesto}</span>}
                    </p>
                    {principal.rolDecision && <p className="text-finbra-gray">{ROLES_DECISION[principal.rolDecision]}</p>}
                    {(principal.canalPreferido || principal.horarioPreferido) && (
                      <p className="text-finbra-gray">
                        Prefiere {principal.canalPreferido ? CANALES[principal.canalPreferido] : "contacto"}
                        {principal.horarioPreferido ? `, ${principal.horarioPreferido}` : ""}
                      </p>
                    )}
                    {canalesPrincipal.length > 0 && <p className="font-mono text-xs">{canalesPrincipal.join(" · ")}</p>}
                  </div>
                ) : (
                  <p className="text-sm text-finbra-gray">
                    {contactos.personas.some((p) => p.vigente) ? "Ninguna persona está marcada como principal." : "Todavía no hay personas registradas."}
                  </p>
                )}
              </Card>

              <Card>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-lg font-bold">Tareas abiertas</h2>
                  <Link href={`${BASE}/${id}?tab=tareas`} className="text-sm text-finbra-purple hover:underline">{puedeEditar ? "Nueva tarea →" : "Ver todas →"}</Link>
                </div>
                {tareas.abiertas.length === 0 ? (
                  <p className="text-sm text-finbra-gray">No hay tareas pendientes.</p>
                ) : (
                  <ul className="divide-y divide-black/5">
                    {tareas.abiertas.slice(0, 3).map((t) => (
                      <TareaAbierta key={t.id} t={t} hoy={hoy} empresaId={id} puedeEditar={puedeEditar} />
                    ))}
                  </ul>
                )}
                {tareas.abiertas.length > 3 && (
                  <p className="mt-3 text-xs text-finbra-gray">y {tareas.abiertas.length - 3} más en la pestaña Tareas.</p>
                )}
              </Card>

              <Card>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-lg font-bold">Última actividad</h2>
                  <Link href={`${BASE}/${id}?tab=actividad`} className="text-sm text-finbra-purple hover:underline">{puedeEditar ? "Registrar →" : "Ver todo →"}</Link>
                </div>
                {historial.length === 0 ? (
                  <p className="text-sm text-finbra-gray">Sin actividad registrada.</p>
                ) : (
                  <ol className="space-y-3 border-l border-black/10 pl-4">
                    {historial.slice(0, 5).map((h) => (
                      <Entrada key={h.id} e={h} />
                    ))}
                  </ol>
                )}
              </Card>

              <Card>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-lg font-bold">Datos de la empresa</h2>
                  {puedeEditar && <Link href={`${BASE}/${id}?tab=datos`} className="text-sm text-finbra-purple hover:underline">Editar</Link>}
                </div>
                <dl className="space-y-2 text-sm">
                  <Dato etiqueta="Nombre comercial">{e.nombreComercial}</Dato>
                  <Dato etiqueta="Sitio web">{e.sitioWeb}</Dato>
                  <Dato etiqueta="Números de cliente">{e.numerosCliente.length ? <span className="font-mono">{e.numerosCliente.join(", ")}</span> : null}</Dato>
                  <Dato etiqueta="Notas">{e.notas && <span className="whitespace-pre-line">{e.notas}</span>}</Dato>
                </dl>
              </Card>
            </div>
          </div>
        </>
      )}

      {pestana === "contactos" && <ContactosEmpresa empresaId={id} personas={contactos.personas} canales={contactos.canales} puedeEditar={puedeEditar} />}

      {pestana === "actividad" && (
        <div className="space-y-6">
          {puedeEditar && (
            <Card>
              <h2 className="mb-3 text-lg font-bold">Registrar actividad</h2>
              <RegistrarActividad empresaId={id} personas={contactos.personas.filter((p) => p.vigente).map((p) => ({ id: p.id, nombre: p.nombre }))} />
            </Card>
          )}
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Historial</h2>
              <div className="flex flex-wrap gap-2">
                {FILTROS_HISTORIAL.map((x) => (
                  <Link
                    key={x.value}
                    href={x.value === "todo" ? `${BASE}/${id}?tab=actividad` : `${BASE}/${id}?tab=actividad&f=${x.value}`}
                    className={`rounded-full px-3 py-1 text-sm font-medium ${filtro === x.value ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"}`}
                  >
                    {x.label}
                  </Link>
                ))}
              </div>
            </div>
            {historial.length === 0 ? (
              <p className="text-sm text-finbra-gray">{filtro === "todo" ? "Todavía no hay actividad." : "Nada con este filtro."}</p>
            ) : (
              <ol className="space-y-4 border-l border-black/10 pl-4">
                {historial.map((h) => (
                  <Entrada key={h.id} e={h} />
                ))}
              </ol>
            )}
            <p className="mt-4 text-xs text-finbra-gray">
              Une la actividad comercial con el expediente de cobranza (gestiones, promesas, WhatsApp) y lo que detecta SIAC (pagos, atrasos). Nada se puede editar ni borrar.
            </p>
          </Card>
        </div>
      )}

      {pestana === "tareas" && (
        <div className="space-y-6">
          {puedeEditar && (
            <Card>
              <h2 className="mb-3 text-lg font-bold">Nueva tarea</h2>
              <NuevaTarea empresaId={id} hoy={hoy} ejecutivos={ejecutivos} responsablePorOmision={null} />
            </Card>
          )}
          <Card>
            <h2 className="mb-3 text-lg font-bold">Pendientes</h2>
            {tareas.abiertas.length === 0 ? (
              <p className="text-sm text-finbra-gray">No hay tareas pendientes.</p>
            ) : (
              <ul className="divide-y divide-black/5">
                {tareas.abiertas.map((t) => (
                  <TareaAbierta key={t.id} t={t} hoy={hoy} empresaId={id} puedeEditar={puedeEditar} />
                ))}
              </ul>
            )}
          </Card>
          {tareas.cerradas.length > 0 && (
            <Card>
              <h2 className="mb-3 text-lg font-bold">Cerradas recientemente</h2>
              <ul className="divide-y divide-black/5">
                {tareas.cerradas.map((t) => (
                  <li key={t.id} className="space-y-0.5 py-2 first:pt-0 last:pb-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-finbra-gray">
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${t.estado === "hecha" ? "bg-emerald-100 text-emerald-800" : "bg-black/5 text-finbra-gray"}`}>
                        {t.estado === "hecha" ? "Hecha" : "Cancelada"}
                      </span>
                      {t.cerradaAt && <span>{formatFechaHora(t.cerradaAt)}</span>}
                      {t.cerradaPor && <span>· {t.cerradaPor}</span>}
                    </p>
                    <p className="text-sm">{t.titulo}</p>
                    {t.resultado && <p className="whitespace-pre-line text-sm text-finbra-gray">{t.resultado}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <p className="text-xs text-finbra-gray">Al cerrar una tarea queda una nota en la actividad del cliente.</p>
        </div>
      )}

      {pestana === "creditos" && (
        <Card className="overflow-x-auto p-0">
          {creditos.length === 0 ? (
            <p className="p-6 text-sm text-finbra-gray">Todavía no tiene créditos en SIAC.</p>
          ) : (
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th scope="col" className="px-4 py-3">Crédito</th>
                  <th scope="col" className="px-4 py-3 text-right">Otorgado</th>
                  <th scope="col" className="px-4 py-3 text-right">Adeudo</th>
                  <th scope="col" className="px-4 py-3 text-right">Vencido</th>
                  <th scope="col" className="px-4 py-3">Estado</th>
                  <th scope="col" className="px-4 py-3">Próximo pago</th>
                  <th scope="col" className="px-4 py-3">Mensualidades</th>
                  <th scope="col" className="px-4 py-3">Fin de plazo</th>
                  <th scope="col" className="px-4 py-3">Último pago</th>
                </tr>
              </thead>
              <tbody>
                {creditos.map((c) => (
                  <tr key={c.creditId} className={`border-b border-black/5 align-top last:border-0 ${c.enListado ? "" : "text-finbra-gray"}`}>
                    <td className="px-4 py-3">
                      <p className="font-mono font-semibold">{c.noCredito}</p>
                      <p className="text-xs text-finbra-gray">
                        {c.tipoCredito ?? "—"}
                        {clientes.length > 1 && <> · cliente {c.numeroCliente}</>}
                      </p>
                      {c.promotor && <p className="text-xs text-finbra-gray">Promotor: {c.promotor}</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {dinero(c.montoCredito)}
                      {c.fechaMinistracion && <span className="block text-xs text-finbra-gray">{formatFecha(c.fechaMinistracion)}</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{dinero(c.adeudo)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${(c.vencido ?? 0) > 0 ? "font-semibold text-red-700" : ""}`}>{dinero(c.vencido)}</td>
                    <td className="px-4 py-3"><Estado c={c} /></td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {c.proximoVencimiento ? formatFecha(c.proximoVencimiento) : "—"}
                      {c.montoSiguiente !== null && <span className="block text-xs text-finbra-gray">{formatMoney(c.montoSiguiente)}</span>}
                    </td>
                    <td className="px-4 py-3"><Avance c={c} /></td>
                    <td className="whitespace-nowrap px-4 py-3"><FinPlazo fecha={c.fechaTermino} hoy={hoy} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-finbra-gray">{formatFecha(c.ultimoPago)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="px-4 pb-4 pt-2 text-xs text-finbra-gray">
            Montos de la foto más reciente de SIAC de cada crédito. Los que salieron del listado conservan su historia pero ya no suman.
          </p>
        </Card>
      )}

      {pestana === "datos" && (
        <Card>
          <h2 className="mb-1 text-lg font-bold">Datos de la empresa</h2>
          <p className="mb-4 text-sm text-finbra-gray">
            Los captura el equipo; SIAC no los trae ni los cambia. Cada cambio queda en la bitácora.
          </p>
          {puedeEditar ? (
            <EditarEmpresa
              empresa={{
                id: e.empresaId,
                nombre: e.nombre,
                razonSocial: e.razonSocial,
                rfc: e.rfc,
                nombreComercial: e.nombreComercial,
                industria: e.industria,
                sitioWeb: e.sitioWeb,
                ejecutivoEmail: e.ejecutivoEmail,
                notas: e.notas,
              }}
              ejecutivos={ejecutivos}
            />
          ) : (
            <dl className="space-y-2 text-sm">
              <Dato etiqueta="Nombre">{e.nombre}</Dato>
              <Dato etiqueta="Razón social">{e.razonSocial}</Dato>
              <Dato etiqueta="RFC">{e.rfc && <span className="font-mono">{e.rfc}</span>}</Dato>
              <Dato etiqueta="Nombre comercial">{e.nombreComercial}</Dato>
              <Dato etiqueta="Industria">{e.industria}</Dato>
              <Dato etiqueta="Sitio web">{e.sitioWeb}</Dato>
              <Dato etiqueta="Ejecutivo">{e.ejecutivoNombre}</Dato>
              <Dato etiqueta="Notas">{e.notas && <span className="whitespace-pre-line">{e.notas}</span>}</Dato>
            </dl>
          )}
          <p className="mt-4 text-xs text-finbra-gray">
            {e.origen === "siac" ? "Se creó desde SIAC" : "Se dio de alta a mano"} el {formatFechaHora(e.createdAt)}
            {e.updatedBy && <> · última edición de {e.updatedBy} el {formatFechaHora(e.updatedAt)}</>}
          </p>
        </Card>
      )}
    </div>
  );
}
