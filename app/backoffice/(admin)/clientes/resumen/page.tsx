import Link from "next/link";
import type { ReactNode } from "react";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { getResumenCartera } from "@/lib/db/cartera";
import { codigoDeError } from "@/lib/collections/errors";
import { formatFecha, formatMoney, formatRatio } from "@/lib/format";
import type { Proporcion } from "@/lib/clientes/cartera-kpis";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ProgressBar from "@/components/ui/ProgressBar";
import PhotoBanner from "../../cobranza/PhotoBanner";

/** Una cifra con su definición y su fuente debajo. `pendiente` = no se puede calcular hoy. */
function Kpi({ titulo, valor, detalle, definicion, pendiente }: { titulo: string; valor: ReactNode; detalle?: ReactNode; definicion: string; pendiente?: boolean }) {
  return (
    <Card>
      <p className="text-sm text-finbra-gray">{titulo}</p>
      <p className={`mt-1 break-words font-bold tabular-nums ${pendiente ? "text-base text-amber-800" : "text-xl text-finbra-purple xl:text-2xl"}`}>{valor}</p>
      {detalle && <p className="mt-1 text-xs text-finbra-gray">{detalle}</p>}
      <p className="mt-2 border-t border-black/5 pt-2 text-xs text-finbra-gray">{definicion}</p>
    </Card>
  );
}

function Barra({ etiqueta, p }: { etiqueta: string; p: Proporcion }) {
  const pct = p.de ? (p.n / p.de) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>{etiqueta}</span>
        <span className="tabular-nums text-finbra-gray">
          {p.n} de {p.de}
          {p.de > 0 && <> · {Math.round(pct)}%</>}
        </span>
      </div>
      <ProgressBar percent={pct} label={`${etiqueta}: ${p.n} de ${p.de}`} />
    </div>
  );
}

const MES = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
const nombreMes = (m: string) => {
  const s = MES.format(new Date(`${m}-01T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default async function ResumenCarteraPage() {
  const session = await getAdminSession();
  if (!puede(session, "cartera.ver")) {
    return <EmptyState title="No tienes acceso a Clientes" description="Tu rol no puede ver la cartera. Si la necesitas, pídele a un Super Admin que cambie tu rol en Usuarios." />;
  }
  let d: Awaited<ReturnType<typeof getResumenCartera>>;
  try {
    d = await getResumenCartera();
  } catch (e) {
    const c = codigoDeError("resumen de cartera", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar el resumen de cartera. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  const r = d.overview?.resumen ?? null;
  const e = d.embudo;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Resumen de cartera</h1>
        <p className="max-w-3xl text-sm text-finbra-gray">
          Cada cifra dice qué suma y de dónde sale. Lo que SIAC no manda aparece como pendiente: el backoffice no calcula saldos de capital, intereses ni amortización por su cuenta.
        </p>
      </div>
      <PhotoBanner status={d.status} />

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-finbra-gray">Cartera vigente · SIAC</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            titulo="Clientes activos"
            valor={d.clientesActivos}
            detalle={`${d.clientesEnMora} en mora · ${d.exClientes} ${d.exClientes === 1 ? "ex cliente" : "ex clientes"} en la base`}
            definicion="Empresas con al menos un crédito en el listado de SIAC. Cada razón social es un cliente."
          />
          <Kpi titulo="Créditos vigentes" valor={r?.creditos ?? "—"} definicion="Créditos en el listado de cobranza de la última foto de SIAC." />
          <Kpi
            titulo="Monto original vigente"
            valor={r ? formatMoney(r.montoOriginal) : "—"}
            definicion="Suma de lo que se prestó (MontoCredito) a los créditos que siguen vigentes. No es la originación ni el saldo."
          />
          <Kpi
            titulo="Saldo total"
            valor={r ? formatMoney(r.adeudo) : "—"}
            definicion="Suma de TotalAdeudo de SIAC. Pendiente de que SIAC confirme qué incluye frente a TotalGlobal."
          />
          <Kpi
            titulo="Vencido"
            valor={r ? formatMoney(r.vencido) : "—"}
            detalle={r ? `${formatRatio(r.pctVencido)} del saldo · ${formatMoney(r.moratorios)} de moratorios` : undefined}
            definicion="Suma de TotalVencido de SIAC: incluye moratorios e IVA."
          />
          <Kpi
            titulo="PAR 30 / 60 / 90"
            valor={r ? `${formatRatio(r.par30)} · ${formatRatio(r.par60)} · ${formatRatio(r.par90)}` : "—"}
            definicion="Saldo de los créditos con más de 30, 60 y 90 días de atraso entre el saldo total. Mide la calidad de la cartera; no es el IMOR regulatorio."
          />
          <Kpi
            titulo="Cobrado en el mes"
            valor={d.overview ? formatMoney(d.overview.cobrado.mes.monto) : "—"}
            detalle={
              d.overview
                ? `${d.overview.cobrado.mes.pagos} ${d.overview.cobrado.mes.pagos === 1 ? "pago" : "pagos"}${d.overview.pagosSinMonto ? ` · ${d.overview.pagosSinMonto} sin monto todavía` : ""}`
                : undefined
            }
            definicion="Pagos aplicados en el mes según ConsultarPagos de SIAC. Sin desglose de capital, interés e IVA."
          />
          <Kpi
            titulo="Capital insoluto y recuperado"
            valor="Pendiente de SIAC"
            pendiente
            definicion="Capital vigente más vencido, y monto original menos ese capital. El listado no lo trae; se le pidió a SIAC."
          />
          <Kpi
            titulo="Ingresos financieros"
            valor="No disponible"
            pendiente
            definicion="Intereses y comisiones cobrados. Vienen de contabilidad; no se calculan a partir de los pagos."
          />
        </div>
        <p className="text-xs text-finbra-gray">
          Saldo, vencido, PAR y cobrado son las mismas cifras del inicio de <Link href="/backoffice/cobranza" className="text-finbra-purple hover:underline">Cobranza</Link>.
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-finbra-gray">Renovaciones</h2>
          <Link href="/backoffice/clientes/renovaciones" className="text-sm font-medium text-finbra-purple hover:underline">Ir al radar →</Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="font-semibold">Créditos que terminan pronto</h3>
            <dl className="mt-3 divide-y divide-black/5 text-sm">
              {d.finesDePlazo.map((f) => (
                <div key={f.hasta} className="flex items-baseline justify-between gap-2 py-2">
                  <dt className="text-finbra-gray">{f.desde === 0 ? `En ${f.hasta} días o menos` : `En ${f.desde} a ${f.hasta} días`}</dt>
                  <dd className="tabular-nums">
                    <span className="font-semibold">{f.creditos}</span>
                    <span className="text-finbra-gray"> · {formatMoney(f.monto)}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-finbra-gray">Créditos vigentes por FechaTerminoContrato de SIAC, con su monto original.</p>
          </Card>
          <Card>
            <h3 className="font-semibold">Oportunidades de renovación</h3>
            {e ? (
              <>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  {[
                    ["Nuevas", e.nuevas],
                    ["En contacto", e.enContacto],
                    ["Interesados", e.interesados],
                    ["Pasaron a análisis", e.ganadas],
                    ["Descartadas", e.descartadas],
                    ["Cerradas por el radar", e.cerradas],
                  ].map(([k, v]) => (
                    <div key={k as string}>
                      <dd className="text-xl font-bold tabular-nums text-finbra-purple">{v}</dd>
                      <dt className="text-xs text-finbra-gray">{k}</dt>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-sm">
                  <span className="text-finbra-gray">Monto de referencia de las abiertas: </span>
                  <span className="font-semibold tabular-nums">{formatMoney(e.montoAbierto)}</span>
                </p>
                <p className="mt-1 text-xs text-finbra-gray">Preliminar: es el monto original de los créditos que terminan, no una oferta ni una aprobación.</p>
              </>
            ) : (
              <p className="mt-3 text-sm text-amber-800">Falta correr crm-schema.sql para tener oportunidades.</p>
            )}
            <p className="mt-3 border-t border-black/5 pt-2 text-xs text-finbra-gray">
              <span className="font-semibold text-amber-800">Tasa de renovación: pendiente.</span> Necesita la historia de créditos liquidados, que se le pidió a SIAC.
            </p>
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-finbra-gray">Relación y datos de los clientes activos</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3">
            <h3 className="font-semibold">Cobertura de contacto</h3>
            <Barra etiqueta="Contactados en los últimos 60 días" p={d.cobertura} />
            <p className="text-xs text-finbra-gray">
              Llamada, visita, correo, WhatsApp o promesa registrados por una persona del equipo, en la ficha del cliente o en su expediente de cobranza. Los mensajes automáticos no cuentan.
            </p>
          </Card>
          <Card className="space-y-3">
            <h3 className="font-semibold">Datos completos</h3>
            <Barra etiqueta="Con ejecutivo" p={d.calidad.ejecutivo} />
            <Barra etiqueta="Con contacto principal" p={d.calidad.principal} />
            <Barra etiqueta="Con cuenta de pago" p={d.calidad.cuentaPago} />
            <Barra etiqueta="Con WhatsApp válido" p={d.calidad.whatsapp} />
            <Barra etiqueta="Con RFC" p={d.calidad.rfc} />
            <p className="text-xs text-finbra-gray">Meta: 100% en clientes activos. El RFC se captura a mano porque SIAC no lo manda.</p>
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-finbra-gray">Por ejecutivo</h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th scope="col" className="px-6 py-3">Ejecutivo</th>
                <th scope="col" className="px-4 py-3 text-right">Clientes activos</th>
                <th scope="col" className="px-4 py-3 text-right">En mora</th>
                <th scope="col" className="px-4 py-3 text-right">Contactados 60 d</th>
                <th scope="col" className="px-4 py-3 text-right">Tareas abiertas</th>
                <th scope="col" className="px-4 py-3 text-right">Vencidas</th>
                <th scope="col" className="px-4 py-3 text-right">Hechas 30 d (a tiempo)</th>
              </tr>
            </thead>
            <tbody>
              {d.ejecutivos.map((f) => (
                <tr key={f.email ?? "sin"} className="border-b border-black/5 last:border-0">
                  <td className={`px-6 py-3 ${f.email ? "font-semibold" : "text-amber-800"}`}>{f.nombre}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{f.clientes}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${f.enMora ? "text-red-700" : ""}`}>{f.enMora}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{f.clientes ? `${f.contactados} de ${f.clientes}` : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{f.tareasAbiertas}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${f.tareasVencidas ? "text-red-700" : ""}`}>{f.tareasVencidas}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{f.hechas30 ? `${f.hechas30} (${f.aTiempo30})` : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="text-xs text-finbra-gray">Léelo junto con la calidad de la cartera de cada ejecutivo: más tareas no significa mejor trabajo.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-finbra-gray">Originación por mes</h2>
        <Card className="overflow-x-auto p-0">
          {d.originacion.length === 0 ? (
            <p className="p-6 text-sm text-finbra-gray">Todavía no hay foto de SIAC.</p>
          ) : (
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th scope="col" className="px-6 py-3">Mes</th>
                  <th scope="col" className="px-4 py-3 text-right">Créditos</th>
                  <th scope="col" className="px-4 py-3 text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {[...d.originacion].reverse().map((m) => (
                  <tr key={m.mes} className="border-b border-black/5 last:border-0">
                    <td className="px-6 py-3">{nombreMes(m.mes)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{m.creditos}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(m.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <p className="text-xs text-finbra-gray">
          Suma de MontoCredito por mes de FechaMinistracion. Empieza en el mes de la primera foto{d.primeraFoto ? ` (${formatFecha(d.primeraFoto)})` : ""}: antes de esa fecha
          faltan los créditos que ya se liquidaron, y la cifra saldría baja. La historia completa está pedida a SIAC.
        </p>
      </section>
    </div>
  );
}
