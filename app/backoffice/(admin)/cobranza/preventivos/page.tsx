import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, hasRole } from "@/lib/rbac";
import { previewPreventivos } from "@/lib/db/whatsapp-preventivo";
import { ETAPAS, EJEMPLO_PREVENTIVA, MOTIVO_FALTA_MONTO, PLANTILLAS_PREVENTIVAS, type Semaforo } from "@/lib/collections/preventivos";
import { motivoNoActivable, renderPlantilla } from "@/lib/collections/whatsapp-mora";
import { codigoDeError } from "@/lib/collections/errors";
import { formatFecha, formatTelefono } from "@/lib/format";
import Card from "@/components/ui/Card";
import { ConsultarMontos, CrearPlantillas, EnviarAhora, EnvioToggle, PlantillaToggle } from "../whatsapp/WhatsAppControls";

/** "Sin WhatsApp válido" → "sin WhatsApp válido": solo la primera letra, para no perder siglas (SIAC, CLABE). */
const minusculaInicial = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

const SEMAFORO: Record<Semaforo, { label: string; clase: string }> = {
  verde: { label: "Verde", clase: "bg-emerald-100 text-emerald-700" },
  amarillo: { label: "Amarillo", clase: "bg-amber-100 text-amber-800" },
  rojo: { label: "Rojo", clase: "bg-red-100 text-red-700" },
};

const ESTADO_META: Record<string, string> = {
  pendiente: "Sin revisar o pendiente en Meta",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  pausada: "Pausada por Meta",
};

export default async function PreventivosPage() {
  const session = await getAdminSession();
  if (!hasRole(session, COBRANZA_ROLES)) return null;
  const esSuperAdmin = session.role === "super_admin";

  let p: Awaited<ReturnType<typeof previewPreventivos>>;
  try {
    p = await previewPreventivos();
  } catch (e) {
    const c = codigoDeError("preventivos", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los recordatorios preventivos. <span className="text-sm opacity-70">(código {c})</span></div>;
  }

  const salen = p.filas.filter((f) => f.decision.enviar);
  const faltaMonto = p.filas.filter((f) => !f.decision.enviar && f.decision.motivo === MOTIVO_FALTA_MONTO).length;
  const cuerpoDe = new Map(p.plantillas.map((t) => [t.nombre, t.cuerpo]));
  // Revisadas con Meta y sin texto = no existen allá todavía.
  const faltanEnMeta = p.plantillas.filter((t) => t.revisadaAt && !t.cuerpo).map((t) => t.nombre);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Recordatorios preventivos</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Antes de que venza la mensualidad: 5 días antes (solo semáforo rojo), 1 día antes (amarillo y rojo) y el día del pago (todos). La fecha sale de SIAC; reemplaza al flujo de n8n con el Google Sheet.
        </p>
      </div>

      <Card className="space-y-4">
        <EnvioToggle activo={p.activado} puedeEditar={esSuperAdmin} tipo="preventivo" />
        {p.bloqueos.length > 0 ? (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">Hoy no saldría ningún recordatorio preventivo:</p>
            <ul className="mt-1 list-disc pl-5">
              {p.bloqueos.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-emerald-700">Todo listo: la próxima corrida enviará {salen.length === 1 ? "1 recordatorio" : `${salen.length} recordatorios`}.</p>
        )}
        {faltaMonto > 0 && (
          <div className="space-y-2 rounded-lg bg-finbra-purple/5 p-3 text-sm">
            <p>
              {faltaMonto === 1 ? "A 1 crédito solo le falta" : `A ${faltaMonto} créditos solo les falta`} el monto de la mensualidad. Se le pregunta a SIAC (su saldo
              vencido a la fecha de vencimiento): la corrida de las 9:00 lo hace sola antes de enviar.
            </p>
            {esSuperAdmin && <ConsultarMontos cuantos={faltaMonto} />}
          </div>
        )}
        {esSuperAdmin && <EnviarAhora disponible={p.bloqueosManual.length === 0} cuantos={salen.length} tipo="preventivo" />}
        <p className="text-xs text-finbra-gray">
          Mientras este envío no esté encendido, los preventivos los sigue mandando n8n desde el Google Sheet. Al prender este, hay que apagar el de n8n el mismo día para que nadie reciba dos.
        </p>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Semáforo</h2>
        <p className="text-sm text-finbra-gray">
          Con el historial de SIAC, lo peor de todos los créditos del cliente: <strong>rojo</strong> con {p.umbrales.rojoVeces} o más veces en mora o un atraso máximo de más de{" "}
          {p.umbrales.rojoAtraso} días; <strong>amarillo</strong> si alguna vez se atrasó; <strong>verde</strong> si nunca.
        </p>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Plantillas</h2>
        <p className="mb-3 text-sm text-finbra-gray">
          Llevan la cuenta de pago del cliente en el mismo mensaje. Para actualizar su estado, usa{" "}
          <Link href="/backoffice/cobranza/whatsapp" className="font-medium text-finbra-purple hover:underline">&quot;Revisar con Meta&quot; en WhatsApp</Link>.
        </p>
        <ul className="divide-y divide-black/5">
          {p.plantillas.map((t) => (
            <li key={t.id} className="space-y-1 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{t.nombre}</span>
                  <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium">{ESTADO_META[t.estadoMeta] ?? t.estadoMeta}</span>
                </span>
                <PlantillaToggle id={t.id} activa={t.activa} puedeEditar={esSuperAdmin} noActivable={motivoNoActivable(t)} />
              </div>
              {!t.activa && motivoNoActivable(t) && t.revisadaAt && <p className="text-xs text-finbra-gray">{motivoNoActivable(t)}</p>}
              {t.cuerpo && <p className="rounded-lg bg-black/[0.03] p-2 text-sm">{t.cuerpo}</p>}
            </li>
          ))}
        </ul>
        {esSuperAdmin && faltanEnMeta.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-black/5 pt-4">
            <p className="text-sm">
              {faltanEnMeta.length === 1 ? "Esta plantilla no existe" : "Estas plantillas no existen"} en Meta todavía. Se pueden dar de alta desde aquí, con estos
              textos, y quedan en revisión de Meta (de minutos a 24 horas):
            </p>
            {PLANTILLAS_PREVENTIVAS.filter((t) => faltanEnMeta.includes(t.nombre)).map((t) => (
              <div key={t.nombre} className="text-sm">
                <p className="font-mono text-xs text-finbra-gray">{t.nombre}</p>
                <p className="rounded-lg bg-black/[0.03] p-2">{t.cuerpo}</p>
              </div>
            ))}
            <p className="text-xs text-finbra-gray">
              Ejemplos que se mandan a Meta: {EJEMPLO_PREVENTIVA.map((e, i) => `{{${i + 1}}} ${e}`).join(", ")}.
            </p>
            <CrearPlantillas faltan={faltanEnMeta} />
          </div>
        )}
      </Card>

      <Card className="p-0">
        <div className="px-6 pt-5">
          <h2 className="text-lg font-bold">Hoy</h2>
          <p className="mt-1 text-sm text-finbra-gray">
            Créditos que vencen hoy, mañana o en 5 días, con la foto del {formatFecha(p.fechaCorte)}. {salen.length} recibirían recordatorio y {p.filas.length - salen.length} no.
          </p>
        </div>
        {p.filas.length === 0 ? (
          <p className="px-6 pb-5 pt-2 text-sm text-finbra-gray">Hoy no le toca recordatorio a ningún crédito.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th className="px-4 py-2">Cliente</th>
                  <th className="px-4 py-2">Vence</th>
                  <th className="px-4 py-2">Semáforo</th>
                  <th className="px-4 py-2">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {p.filas.map((f) => (
                  <tr key={f.creditId} className="border-b border-black/5 align-top last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/backoffice/cobranza/clientes/${f.clientId}`} className="font-medium hover:text-finbra-purple hover:underline">{f.nombre}</Link>
                      <span className="block font-mono text-xs text-finbra-gray">{f.noCredito}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {formatFecha(f.proximoVencimiento)}
                      <span className="block text-xs text-finbra-gray">{ETAPAS[f.decision.etapa].etiqueta}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEMAFORO[f.decision.semaforo].clase}`}>{SEMAFORO[f.decision.semaforo].label}</span>
                    </td>
                    <td className="px-4 py-2">
                      {f.decision.enviar ? (
                        <span className="text-emerald-700">
                          Recibe <span className="font-mono">{f.decision.plantilla}</span> en {formatTelefono(f.decision.telefono)}
                          {cuerpoDe.get(f.decision.plantilla) && (
                            <span className="mt-1 block rounded-lg bg-emerald-50 p-2 text-sm text-black">
                              {renderPlantilla(cuerpoDe.get(f.decision.plantilla)!, f.decision.parametros)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-finbra-gray">No recibe: {minusculaInicial(f.decision.motivo)}</span>
                      )}
                      {f.decision.aviso && <span className="mt-1 block text-xs text-amber-800">{f.decision.aviso}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {p.proximos.length > 0 && (
        <Card>
          <h2 className="mb-1 text-lg font-bold">En los próximos días</h2>
          <p className="mb-3 text-sm text-finbra-gray">Vencen en 2 a 4 días: hoy no les toca recordatorio.</p>
          <ul className="space-y-1 text-sm">
            {p.proximos.map((x) => (
              <li key={x.creditId} className="flex flex-wrap items-center gap-2">
                <span className="w-28 text-finbra-gray">{formatFecha(x.proximoVencimiento)}</span>
                <Link href={`/backoffice/cobranza/clientes/${x.clientId}`} className="hover:text-finbra-purple hover:underline">{x.nombre}</Link>
                <span className="font-mono text-xs text-finbra-gray">{x.noCredito}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEMAFORO[x.semaforo].clase}`}>{SEMAFORO[x.semaforo].label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

    </div>
  );
}
