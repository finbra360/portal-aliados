import Link from "next/link";
import { notFound } from "next/navigation";
import Card from "@/components/ui/Card";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { CH_BORRAN, CH_OPERAN, CH_VEN, CH_VEN_CONTACTO } from "@/lib/credit-health/roles";
import {
  DESTINO_LABELS,
  ELEGIBILIDAD_LABELS,
  ESTADOS_CONTACTO,
  ESTADO_CONTACTO_LABELS,
  FIGURA_LABELS,
  GARANTIA_LABELS,
  HISTORIAL_LABELS,
  INTENCION_LABELS,
  origenLabel,
  SECTORES,
  type EstadoContacto,
} from "@/lib/credit-health/catalogo";
import { obtenerProspecto, revelarContacto, type ProspectoDetalle } from "@/lib/credit-health/prospectos";
import type { EntradaCH, ReglaCH, ResultadoCH } from "@/lib/credit-health/tipos";
import { agregarNotaAction, asignarAction, cambiarEstadoAction, eliminarAction } from "../../actions";
import { ClasificacionPill, ContactoPill, DemoPill, ErrorCarga, fechaHora, pesos, veces } from "../../ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const campo = "h-10 w-full rounded-lg border border-black/10 bg-white px-3 text-sm focus:border-finbra-purple focus:outline-none";
const boton = "h-10 rounded-lg bg-finbra-purple px-4 text-sm font-semibold text-white hover:bg-finbra-purple-700";
const botonSec = "h-9 rounded-lg border border-black/10 bg-white px-3 text-sm font-semibold hover:border-finbra-purple/40";

const EVENTOS: Record<string, string> = {
  created: "Prospecto creado",
  updated: "Actividad del empresario",
  status_changed: "Cambio de estado",
  assigned: "Asignación",
  note: "Nota",
  integration: "Integración",
};

const CONSENTIMIENTOS: Record<string, string> = {
  privacy_notice: "Aviso de privacidad",
  share_with_finbra: "Compartir con Finbra",
  marketing: "Comunicaciones comerciales",
};

const LIMITE: Record<string, string> = { solicitado: "lo solicitado", flujo: "el flujo", garantia: "la garantía", producto: "el máximo del producto" };

export default async function ProspectoDetallePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getAdminSession();
  if (!hasRole(session, CH_VEN)) return null;
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();

  let detalle: Awaited<ReturnType<typeof obtenerProspecto>> = null;
  try {
    detalle = await obtenerProspecto(id);
  } catch (e) {
    console.error("[credit-health] detalle", e instanceof Error ? e.message : e);
    return <ErrorCarga texto="No pudimos cargar este prospecto." />;
  }
  if (!detalle) notFound();
  const { prospecto: p, eventos } = detalle;
  // Cada envío registra sus consentimientos; se muestra el más reciente de cada tipo.
  const consentimientos = [...new Map(detalle.consentimientos.map((c) => [c.tipo, c])).values()];
  const r = p.resultado;
  const e = p.entrada;
  const puedeOperar = hasRole(session, CH_OPERAN);
  const puedeVerContacto = hasRole(session, CH_VEN_CONTACTO);
  const contacto = sp.contacto === "1" && puedeVerContacto ? await revelarContacto(p, session).catch(() => null) : null;

  return (
    <div className="space-y-6">
      <Link href="/backoffice/credit-health/prospectos" className="text-sm font-semibold text-finbra-gray hover:text-finbra-purple">
        ← Prospectos
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{p.tradeName ?? "Sin empresa todavía"}</h1>
          {p.isDemo ? <DemoPill /> : null}
        </div>
        <p className="mt-1 text-sm text-finbra-gray">
          {p.folio} · {(p.sectorCode && SECTORES[p.sectorCode]) || "Sin sector"} · {p.state ?? "Sin estado"} · Recibido {fechaHora(p.createdAt)} · Origen: {origenLabel(p.source)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ClasificacionPill valor={p.classification} />
          <span className="inline-block rounded-full bg-black/5 px-3 py-1 text-xs font-semibold text-finbra-gray">{ELEGIBILIDAD_LABELS[p.eligibilityStatus] ?? p.eligibilityStatus}</span>
          <ContactoPill valor={p.contactStatus} />
          <span className="inline-block rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-finbra-gray">{INTENCION_LABELS[p.intent] ?? p.intent}</span>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          {r && e ? <Diagnostico p={p} r={r} e={e} /> : <SinDiagnostico />}
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="font-semibold">Contacto</h2>
            {contacto ? (
              <dl className="mt-3 space-y-2 text-sm">
                <Dato etiqueta="Nombre" valor={contacto.nombre} />
                <Dato etiqueta="Correo" valor={contacto.correo} />
                <Dato etiqueta="Teléfono" valor={contacto.telefono} />
                {p.contactRole ? <Dato etiqueta="Cargo" valor={p.contactRole} /> : null}
                {contacto.rfc ? <Dato etiqueta="RFC" valor={contacto.rfc} /> : null}
                {p.preferredContactTime ? <Dato etiqueta="Horario preferido" valor={p.preferredContactTime} /> : null}
                <p className="pt-1 text-[11px] text-finbra-gray">Esta consulta quedó registrada.</p>
              </dl>
            ) : puedeVerContacto ? (
              <Link href={`/backoffice/credit-health/prospectos/${p.id}?contacto=1`} className={`${botonSec} mt-3 inline-flex items-center`}>
                Mostrar datos de contacto
              </Link>
            ) : (
              <p className="mt-3 text-sm text-finbra-gray">Tu rol no permite ver datos personales.</p>
            )}
            <div className="mt-4 border-t border-black/5 pt-3">
              <p className="text-xs font-semibold text-finbra-gray">Consentimientos</p>
              <ul className="mt-1.5 space-y-1 text-xs">
                {consentimientos.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2">
                    <span>{CONSENTIMIENTOS[c.tipo] ?? c.tipo}</span>
                    <span className={c.otorgado ? "font-semibold text-emerald-700" : "text-finbra-gray"}>{c.otorgado ? "Otorgado" : "No"}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-finbra-gray">Se conserva hasta {fechaHora(p.retentionUntil)}.</p>
            </div>
          </Card>

          {puedeOperar ? (
            <Card>
              <h2 className="font-semibold">Seguimiento</h2>
              <form action={cambiarEstadoAction} className="mt-3 space-y-2">
                <input type="hidden" name="id" value={p.id} />
                <select name="estado" defaultValue={p.contactStatus} aria-label="Estado de contacto" className={campo}>
                  {ESTADOS_CONTACTO.map((s) => (
                    <option key={s} value={s}>
                      {ESTADO_CONTACTO_LABELS[s as EstadoContacto]}
                    </option>
                  ))}
                </select>
                <input name="nota" placeholder="Comentario del cambio (opcional)" maxLength={1000} aria-label="Comentario del cambio" className={campo} />
                <button type="submit" className={`${boton} w-full`}>
                  Actualizar estado
                </button>
              </form>
              <form action={asignarAction} className="mt-4 flex gap-2">
                <input type="hidden" name="id" value={p.id} />
                <input name="asignado" defaultValue={p.assignedTo ?? ""} placeholder="Asignar a (correo)" maxLength={160} aria-label="Asignar a" className={campo} />
                <button type="submit" className={botonSec}>
                  Asignar
                </button>
              </form>
              <form action={agregarNotaAction} className="mt-4 space-y-2">
                <input type="hidden" name="id" value={p.id} />
                <textarea
                  name="nota"
                  required
                  maxLength={2000}
                  placeholder="Agregar nota interna"
                  aria-label="Nota interna"
                  className="min-h-20 w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-finbra-purple focus:outline-none"
                />
                <button type="submit" className={botonSec}>
                  Guardar nota
                </button>
              </form>
            </Card>
          ) : null}

          <Card>
            <h2 className="font-semibold">Historial</h2>
            <ol className="mt-3 space-y-3 border-l-2 border-finbra-purple/15 pl-4">
              {eventos.map((ev) => (
                <li key={ev.id} className="relative text-sm">
                  <span aria-hidden="true" className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-finbra-purple" />
                  <p className="font-medium">
                    {EVENTOS[ev.tipo] ?? ev.tipo}
                    {ev.tipo === "status_changed" ? (
                      <span className="font-normal text-finbra-gray">
                        {" "}
                        · {ESTADO_CONTACTO_LABELS[ev.de as EstadoContacto] ?? ev.de} → {ESTADO_CONTACTO_LABELS[ev.a as EstadoContacto] ?? ev.a}
                      </span>
                    ) : ev.tipo === "assigned" ? (
                      <span className="font-normal text-finbra-gray"> · {ev.a ?? "sin asignar"}</span>
                    ) : null}
                  </p>
                  {ev.nota ? <p className="text-finbra-gray">{ev.nota}</p> : null}
                  <p className="text-xs text-finbra-gray">
                    {ev.actor} · {fechaHora(ev.fecha)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>

          {hasRole(session, CH_BORRAN) ? (
            <Card className="border-red-200">
              <h2 className="font-semibold text-red-700">Eliminar definitivamente</h2>
              <p className="mt-1 text-xs text-finbra-gray">Para solicitudes de cancelación (derechos ARCO). Borra datos, consentimientos e historial. No se puede deshacer.</p>
              <form action={eliminarAction} className="mt-3 space-y-2">
                <input type="hidden" name="id" value={p.id} />
                <input name="motivo" required minLength={3} maxLength={300} placeholder="Motivo (p. ej. solicitud ARCO del titular)" aria-label="Motivo de eliminación" className={campo} />
                <button type="submit" className="h-9 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700">
                  Eliminar prospecto
                </button>
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Resultado del diagnóstico y lo que declaró el empresario. */
function Diagnostico({ p, r, e }: { p: ProspectoDetalle; r: ResultadoCH; e: EntradaCH }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica etiqueta="Monto solicitado" valor={pesos(p.requestedAmount)} nota={`${p.termMonths ?? "—"} meses`} />
        <Metrica etiqueta="Monto preliminar" valor={pesos(p.preliminaryAmount)} nota={r.capacity.bindingConstraint ? `Límite: ${LIMITE[r.capacity.bindingConstraint] ?? r.capacity.bindingConstraint}` : undefined} />
        <Metrica etiqueta="Pago sostenible" valor={pesos(p.maxPayment)} nota={`Flujo ${pesos(p.cfads)}/mes`} />
        <Metrica etiqueta="DSCR actual / proyectado" valor={`${veces(r.dscrCurrent.value)} / ${veces(p.dscrProjected)}`} nota={`Score ${p.score ?? "—"}/100`} />
      </div>

      {r.exclusions.length || r.reviews.length || r.missing.length ? (
        <Card>
          <h2 className="font-semibold">Motivos de descarte y revisión</h2>
          <ul className="mt-2 divide-y divide-black/5">
            {[...r.exclusions, ...r.reviews].map((regla) => (
              <Regla key={regla.id} regla={regla} />
            ))}
          </ul>
          {r.missing.length ? (
            <p className="mt-3 text-sm text-finbra-gray">
              <strong className="text-black">Datos faltantes:</strong> {r.missing.map((m) => m.label).join(", ")}.
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 font-semibold">Lo que declaró el empresario</h2>
        <div className="grid gap-x-8 md:grid-cols-2">
          <Lista
            filas={[
              ["Figura jurídica", (e.company.legalForm && FIGURA_LABELS[e.company.legalForm]) || "—"],
              ["Antigüedad", e.company.monthsOperating !== null ? `${e.company.monthsOperating} meses` : "—"],
              ["Facturación anual", pesos(e.company.annualRevenue)],
              ["RFC activo (declarado)", e.company.rfcActive === "si" ? "Sí" : e.company.rfcActive === "no" ? "No" : e.company.rfcActive === "no_se" ? "No sabe" : "—"],
              ["Destino del crédito", (e.financing.purpose && DESTINO_LABELS[e.financing.purpose]) || "—"],
              ["Garantía", e.financing.collateralType ? `${GARANTIA_LABELS[e.financing.collateralType] ?? e.financing.collateralType} · ${pesos(e.financing.collateralValue)}` : "—"],
              ["Historial de pago", (e.financing.creditHistory && HISTORIAL_LABELS[e.financing.creditHistory]) || "—"],
            ]}
          />
          <Lista
            filas={[
              ["Ventas mensuales", `${pesos(r.cashflow.baseSales.value)}${r.cashflow.salesSource === "historial" ? " (historial)" : ""}`],
              ["Costo de ventas", pesos(e.finances.costOfSales)],
              ["Gastos fijos", pesos(r.cashflow.fixedExpenses.value)],
              ["Impuestos", pesos(e.finances.taxesPaid)],
              ["Servicio de deuda actual", pesos(r.currentDebtService.value)],
              ["Saldo de deuda", pesos(e.finances.debtBalance)],
              ["Cobra / paga en", `${e.finances.collectionDays ?? "—"} / ${e.finances.paymentDays ?? "—"} días`],
              ["Cliente principal", e.finances.topClientSharePct !== null ? `${e.finances.topClientSharePct} % de las ventas` : "—"],
            ]}
          />
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Criterios evaluados</h2>
        <p className="text-xs text-finbra-gray">
          Política v{p.policyVersion ?? "—"} ({p.policyLabel ?? "desconocida"}) · Motor v{p.engineVersion}. El historial crediticio es declarado: no se consultó Buró.
        </p>
        <ul className="mt-2 divide-y divide-black/5">
          {r.rules.map((regla) => (
            <Regla key={regla.id} regla={regla} />
          ))}
        </ul>
      </Card>
    </>
  );
}

function SinDiagnostico() {
  return (
    <Card>
      <h2 className="font-semibold">Aún no termina su diagnóstico</h2>
      <p className="mt-1 text-sm text-finbra-gray">
        Dejó sus datos de contacto al iniciar, pero todavía no envía las respuestas de su empresa. Si las completa, aquí aparecerán su resultado, su capacidad de pago y
        los criterios evaluados. Mientras tanto puedes contactarlo para ayudarle a terminar.
      </p>
    </Card>
  );
}

function Metrica({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-finbra-gray">{etiqueta}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{valor}</p>
      {nota ? <p className="text-xs text-finbra-gray">{nota}</p> : null}
    </Card>
  );
}

function Lista({ filas }: { filas: Array<[string, string]> }) {
  return (
    <dl className="divide-y divide-black/5 text-sm">
      {filas.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 py-2">
          <dt className="text-finbra-gray">{k}</dt>
          <dd className="text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-finbra-gray">{etiqueta}</dt>
      <dd className="break-all font-medium">{valor}</dd>
    </div>
  );
}

function Regla({ regla }: { regla: ReglaCH }) {
  const etiqueta =
    regla.outcome === "pass" ? "Cumple" : regla.outcome === "unknown" ? "Sin datos" : regla.action === "exclude" ? "Excluyente" : regla.action === "review" ? "Revisión" : "Informativa";
  const color =
    regla.outcome === "pass" ? "text-emerald-700" : regla.outcome === "unknown" ? "text-finbra-gray" : regla.action === "exclude" ? "text-red-700" : "text-amber-700";
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-2">
        <p className="text-sm font-medium">{regla.label}</p>
        <span className={`text-[11px] font-bold uppercase tracking-wide ${color}`}>{etiqueta}</span>
      </div>
      <p className="mt-0.5 text-[13px] text-finbra-gray">{regla.explanation}</p>
    </li>
  );
}
