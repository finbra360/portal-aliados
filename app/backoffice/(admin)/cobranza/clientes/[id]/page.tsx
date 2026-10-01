import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, hasRole } from "@/lib/rbac";
import { getClientProfile } from "@/lib/db/collection-clients";
import { getPhotoStatus } from "@/lib/db/collections";
import { bucketFor } from "@/lib/collections/rules";
import { formatFecha, formatFechaHora, formatMoney } from "@/lib/format";
import Card from "@/components/ui/Card";
import PhotoBanner from "../../PhotoBanner";
import ContactsPanel from "./ContactsPanel";

const TIPO_ACTIVIDAD: Record<string, string> = {
  llamada: "Llamada",
  nota: "Nota",
  visita: "Visita",
  correo: "Correo",
  whatsapp_enviado: "WhatsApp enviado",
  whatsapp_recibido: "WhatsApp recibido",
  promesa_creada: "Promesa",
  promesa_resuelta: "Promesa",
  pago_detectado: "Pago",
  pago_registrado: "Pago",
  entrada_mora: "Atraso",
  regularizacion: "Al corriente",
  nueva_mensualidad_vencida: "Atraso",
  salida_listado: "SIAC",
  saldo_consultado: "Saldo",
  cambio_etapa: "Etapa",
  cambio_contacto: "Contactos",
  cambio_asignacion: "Asignación",
  pausa: "Pausa",
  alerta: "Alerta",
};

const ALERTA: Record<string, string> = {
  entrada_mora: "Entró a mora",
  nueva_mensualidad_vencida: "Venció otra mensualidad sin pago",
  cambio_bucket: "Subió de rango de atraso",
  promesa_incumplida: "Promesa de pago incumplida",
  mensaje_fallido: "No se pudo entregar un WhatsApp",
  telefono_invalido: "Sin teléfono válido para WhatsApp",
};

const ESTADO_PROMESA: Record<string, string> = {
  vigente: "Vigente",
  cumplida: "Cumplida",
  parcial: "Parcial",
  incumplida: "Incumplida",
  cancelada: "Cancelada",
};

export default async function ClientePerfilPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasRole(await getAdminSession(), COBRANZA_ROLES)) return null;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let perfil: Awaited<ReturnType<typeof getClientProfile>>;
  let status: Awaited<ReturnType<typeof getPhotoStatus>>;
  try {
    [perfil, status] = await Promise.all([getClientProfile(id), getPhotoStatus()]);
  } catch {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar el perfil del cliente.</div>;
  }
  if (!perfil) notFound();

  const enListado = perfil.creditos.filter((c) => c.enListado);
  const vencido = enListado.reduce((s, c) => s + (c.totalVencido ?? 0), 0);
  const adeudo = enListado.reduce((s, c) => s + (c.totalAdeudo ?? 0), 0);
  const maxAtraso = enListado.reduce((m, c) => Math.max(m, c.antiguedad ?? 0), 0);
  const juridico = perfil.creditos.some((c) => c.etapaManual === "juridico");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/backoffice/cobranza/cola" className="text-sm text-finbra-purple hover:underline">← Cola de trabajo</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{perfil.nombre}</h1>
            <p className="font-mono text-sm text-finbra-gray">Cliente {perfil.numeroCliente}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {maxAtraso > 0 ? (
              <span className="rounded-full bg-red-100 px-3 py-1 font-semibold text-red-700">{maxAtraso} días de atraso</span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-700">Al corriente</span>
            )}
            {juridico && <span className="rounded-full bg-black/5 px-3 py-1 text-finbra-gray">En jurídico</span>}
            {perfil.pausaHasta && <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Pausado hasta el {formatFecha(perfil.pausaHasta)}</span>}
          </div>
        </div>
      </div>
      <PhotoBanner status={status} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-finbra-gray">Vencido</p>
          <p className={`mt-1 text-2xl font-bold ${vencido > 0 ? "text-red-700" : "text-finbra-purple"}`}>{formatMoney(vencido)}</p>
        </Card>
        <Card>
          <p className="text-sm text-finbra-gray">Adeudo total</p>
          <p className="mt-1 text-2xl font-bold text-finbra-purple">{formatMoney(adeudo)}</p>
        </Card>
        <Card>
          <p className="text-sm text-finbra-gray">Créditos activos</p>
          <p className="mt-1 text-2xl font-bold text-finbra-purple">{enListado.length}</p>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-1 text-lg font-bold">Contactos</h2>
            <p className="mb-4 text-sm text-finbra-gray">
              Define el tipo de cada contacto y a quién se le mandan los recordatorios de cobranza. Tu elección se respeta aunque SIAC cambie sus datos.
            </p>
            <ContactsPanel
              clientId={perfil.id}
              contactos={perfil.contactos}
              recipient={perfil.recipient}
              elegidoPor={{ por: perfil.contactoCobranza.por, at: perfil.contactoCobranza.at }}
            />
          </Card>

          <Card className="overflow-x-auto p-0">
            <h2 className="px-6 pt-5 text-lg font-bold">Créditos</h2>
            <table className="mt-3 w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th className="px-6 py-2">Crédito</th>
                  <th className="px-6 py-2 text-right">Vencido</th>
                  <th className="px-6 py-2 text-right">Adeudo</th>
                  <th className="px-6 py-2">Atraso</th>
                  <th className="px-6 py-2">Próximo venc.</th>
                  <th className="px-6 py-2">Último pago</th>
                </tr>
              </thead>
              <tbody>
                {perfil.creditos.map((c) => (
                  <tr key={c.id} className={`border-b border-black/5 last:border-0 ${c.enListado ? "" : "text-finbra-gray"}`}>
                    <td className="px-6 py-2">
                      <span className="font-mono">{c.noCredito}</span>
                      {!c.enListado && <span className="ml-2 text-xs">(ya no está en el listado)</span>}
                      {c.tipoCredito && <span className="block text-xs text-finbra-gray">{c.tipoCredito}</span>}
                    </td>
                    <td className={`px-6 py-2 text-right tabular-nums ${(c.totalVencido ?? 0) > 0 ? "font-semibold text-red-700" : ""}`}>{formatMoney(c.totalVencido ?? 0)}</td>
                    <td className="px-6 py-2 text-right tabular-nums">{formatMoney(c.totalAdeudo ?? 0)}</td>
                    <td className="px-6 py-2">{c.antiguedad ? `${c.antiguedad} d · ${bucketFor(c.antiguedad)}` : "Al corriente"}</td>
                    <td className="px-6 py-2">{formatFecha(c.proximoVencimiento)}</td>
                    <td className="px-6 py-2">{formatFecha(c.fechaUltimoPago)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="overflow-x-auto p-0">
            <h2 className="px-6 pt-5 text-lg font-bold">Pagos registrados</h2>
            {perfil.pagos.length === 0 ? (
              <p className="px-6 py-5 text-sm text-finbra-gray">Todavía no hay pagos con monto. Llegan de ConsultarPagos cuando SIAC detecta un pago nuevo.</p>
            ) : (
              <table className="mt-3 w-full min-w-[420px] text-left text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                    <th className="px-6 py-2">Fecha</th>
                    <th className="px-6 py-2">Crédito</th>
                    <th className="px-6 py-2 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {perfil.pagos.map((p) => (
                    <tr key={p.id} className="border-b border-black/5 last:border-0">
                      <td className="px-6 py-2">{formatFecha(p.fecha)}</td>
                      <td className="px-6 py-2 font-mono">{p.noCredito}</td>
                      <td className="px-6 py-2 text-right tabular-nums">{formatMoney(p.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {perfil.alertas.length > 0 && (
            <Card>
              <h2 className="mb-3 text-lg font-bold">Alertas abiertas</h2>
              <ul className="space-y-2 text-sm">
                {perfil.alertas.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-3">
                    <span className={a.severidad === "critica" ? "font-semibold text-red-700" : ""}>{ALERTA[a.tipo] ?? a.tipo}</span>
                    <span className="whitespace-nowrap text-xs text-finbra-gray">{formatFechaHora(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {perfil.promesas.length > 0 && (
            <Card>
              <h2 className="mb-3 text-lg font-bold">Promesas de pago</h2>
              <ul className="space-y-2 text-sm">
                {perfil.promesas.map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3">
                    <span>{formatMoney(p.monto)} al {formatFecha(p.fechaCompromiso)}</span>
                    <span className="text-xs text-finbra-gray">{ESTADO_PROMESA[p.estado] ?? p.estado}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <h2 className="mb-3 text-lg font-bold">Historial</h2>
            {perfil.timeline.length === 0 ? (
              <p className="text-sm text-finbra-gray">Todavía no hay movimientos.</p>
            ) : (
              <ol className="space-y-3 border-l border-black/10 pl-4 text-sm">
                {perfil.timeline.map((t) => (
                  <li key={t.id}>
                    <p className="text-xs text-finbra-gray">
                      {formatFechaHora(t.ocurridoAt)} · <span className="font-semibold text-finbra-purple">{TIPO_ACTIVIDAD[t.tipo] ?? t.tipo}</span>
                      {t.actor !== "sistema" && <> · {t.actor}</>}
                    </p>
                    <p>{t.descripcion}</p>
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
