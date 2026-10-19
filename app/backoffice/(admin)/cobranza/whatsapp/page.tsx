import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, hasRole } from "@/lib/rbac";
import { previewMora } from "@/lib/db/whatsapp-mora";
import { EJEMPLO_MORA, PLANTILLAS_MORA, VARIABLES_MORA, motivoNoActivable, renderPlantilla } from "@/lib/collections/whatsapp-mora";
import { codigoDeError } from "@/lib/collections/errors";
import { formatFecha, formatFechaHora, formatMoney, formatTelefono } from "@/lib/format";
import Card from "@/components/ui/Card";
import { CrearPlantillas, EnviarAhora, EnviarPrueba, EnvioToggle, PlantillaToggle, RevisarConMeta } from "./WhatsAppControls";

/** "Sin WhatsApp válido" → "sin WhatsApp válido": solo la primera letra, para no perder siglas (SIAC, CLABE). */
const minusculaInicial = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

const ESTADO: Record<string, { label: string; clase: string }> = {
  pendiente: { label: "Pendiente", clase: "bg-black/5 text-finbra-gray" },
  enviado: { label: "Enviado", clase: "bg-emerald-100 text-emerald-700" },
  entregado: { label: "Entregado", clase: "bg-emerald-100 text-emerald-700" },
  leido: { label: "Leído", clase: "bg-emerald-100 text-emerald-700" },
  fallido: { label: "Falló", clase: "bg-red-100 text-red-700" },
};

const ESTADO_META: Record<string, { label: string; clase: string }> = {
  pendiente: { label: "Pendiente en Meta", clase: "bg-black/5 text-finbra-gray" },
  aprobada: { label: "Aprobada", clase: "bg-emerald-100 text-emerald-700" },
  rechazada: { label: "Rechazada", clase: "bg-red-100 text-red-700" },
  pausada: { label: "Pausada por Meta", clase: "bg-amber-100 text-amber-800" },
};

const CALIDAD: Record<string, string> = { GREEN: "alta", YELLOW: "media", RED: "baja", UNKNOWN: "sin calificar" };

const ETIQUETA_VARIABLE: Record<(typeof VARIABLES_MORA)[number], string> = {
  nombre: "Nombre",
  total_vencido: "Monto vencido",
  creditos: "Crédito(s)",
  banco: "Banco",
  beneficiario: "Beneficiario",
  clabe: "CLABE",
};

export default async function WhatsAppMoraPage() {
  const session = await getAdminSession();
  if (!hasRole(session, COBRANZA_ROLES)) return null;
  const esSuperAdmin = session.role === "super_admin";

  let p: Awaited<ReturnType<typeof previewMora>>;
  try {
    p = await previewMora();
  } catch (e) {
    const c = codigoDeError("whatsapp", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los recordatorios de WhatsApp. <span className="text-sm opacity-70">(código {c})</span></div>;
  }

  const cuerpoDe = new Map(p.plantillas.map((t) => [t.nombre, t.cuerpo]));
  const aprobadas = p.plantillas.filter((t) => motivoNoActivable(t) === null);
  // Revisadas con Meta y sin texto = no existen allá todavía.
  const faltanEnMeta = p.revisionMeta ? p.plantillas.filter((t) => t.revisadaAt && !t.cuerpo).map((t) => t.nombre) : [];
  const salen = p.filas.filter((f) => f.decision.enviar);
  const noSalen = p.filas.filter((f) => !f.decision.enviar);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">WhatsApp de mora</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Todos los días, después de la sincronización de las 9:00, cada cliente en mora recibe un recordatorio con su saldo vencido y su cuenta de pago. Máximo un mensaje por cliente al día; las plantillas se rotan.
        </p>
      </div>

      <Card className="space-y-4">
        <EnvioToggle activo={p.activado} puedeEditar={esSuperAdmin} />
        {p.bloqueos.length > 0 ? (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">Hoy no saldría ningún mensaje:</p>
            <ul className="mt-1 list-disc pl-5">
              {p.bloqueos.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-emerald-700">Todo listo: la próxima corrida enviará {salen.length === 1 ? "1 recordatorio" : `${salen.length} recordatorios`}.</p>
        )}
        {esSuperAdmin && <EnviarAhora disponible={p.bloqueosManual.length === 0} cuantos={salen.length} />}
        {!esSuperAdmin && <p className="text-xs text-finbra-gray">Solo Super Admin puede prender el envío, activar plantillas o enviar a mano.</p>}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="mb-1 text-lg font-bold">Conexión con Meta</h2>
          <p className="text-sm text-finbra-gray">
            Comprueba el token y el número, y trae de Meta el estado y el texto de cada plantilla. No envía ningún mensaje.
          </p>
        </div>
        {p.revisionMeta ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-finbra-gray">Número</dt>
            <dd>{p.revisionMeta.nombreVerificado ?? "—"} {p.revisionMeta.numero && <span className="text-finbra-gray">· {p.revisionMeta.numero}</span>}</dd>
            <dt className="text-finbra-gray">Calidad</dt>
            <dd>{p.revisionMeta.calidad ? (CALIDAD[p.revisionMeta.calidad] ?? p.revisionMeta.calidad) : "—"}</dd>
            <dt className="text-finbra-gray">Última revisión</dt>
            <dd>{formatFechaHora(p.revisionMeta.at)} · {p.revisionMeta.por}</dd>
          </dl>
        ) : (
          <p className="text-sm text-finbra-gray">Todavía no se ha revisado.</p>
        )}
        {esSuperAdmin && <RevisarConMeta />}
        {esSuperAdmin && (
          <div className="border-t border-black/5 pt-4">
            <h3 className="mb-1 font-semibold">Enviar prueba a mi número</h3>
            <p className="mb-3 text-sm text-finbra-gray">
              Manda una plantilla aprobada con datos de ejemplo (“Prueba Finbra”, $1,234.56, crédito 0000) y la primera cuenta de pago activa. Funciona aunque el envío diario esté bloqueado. Máximo 10 al día.
            </p>
            <EnviarPrueba plantillas={aprobadas.map((t) => ({ id: t.id, nombre: t.nombre }))} />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Plantillas</h2>
        <p className="mb-4 text-sm text-finbra-gray">
          Solo se puede activar una plantilla que Meta aprobó y que tiene las 6 variables, en este orden:{" "}
          {VARIABLES_MORA.map((v, i) => `{{${i + 1}}} ${ETIQUETA_VARIABLE[v]}`).join(", ")}.
        </p>
        <ul className="divide-y divide-black/5">
          {p.plantillas.map((t) => (
            <li key={t.id} className="space-y-1 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{t.nombre}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_META[t.estadoMeta]?.clase ?? ""}`}>{ESTADO_META[t.estadoMeta]?.label ?? t.estadoMeta}</span>
                  {t.revisadaAt && <span className="text-xs text-finbra-gray">revisada {formatFechaHora(t.revisadaAt)}</span>}
                </span>
                <PlantillaToggle id={t.id} activa={t.activa} puedeEditar={esSuperAdmin} noActivable={motivoNoActivable(t)} />
              </div>
              {t.motivoRechazo && <p className="text-xs text-red-700">Motivo de Meta: {t.motivoRechazo}</p>}
              {!t.activa && motivoNoActivable(t) && t.revisadaAt && <p className="text-xs text-finbra-gray">{motivoNoActivable(t)}</p>}
              {t.cuerpo && (
                <details>
                  <summary className="cursor-pointer text-xs text-finbra-purple">Ver texto en Meta</summary>
                  <p className="mt-1 whitespace-pre-line rounded-lg bg-black/[0.03] p-2 text-sm">{t.cuerpo}</p>
                </details>
              )}
            </li>
          ))}
        </ul>
        {esSuperAdmin && faltanEnMeta.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-black/5 pt-4">
            <p className="text-sm">
              {faltanEnMeta.length === 1 ? "Esta plantilla no existe" : "Estas plantillas no existen"} en Meta todavía. Se pueden dar de alta desde aquí, con estos textos, y
              quedan en revisión de Meta (de minutos a 24 horas):
            </p>
            {PLANTILLAS_MORA.filter((t) => faltanEnMeta.includes(t.nombre)).map((t) => (
              <div key={t.nombre} className="text-sm">
                <p className="font-mono text-xs text-finbra-gray">{t.nombre}</p>
                <p className="rounded-lg bg-black/[0.03] p-2">{t.cuerpo}</p>
              </div>
            ))}
            <p className="text-xs text-finbra-gray">
              Ejemplos que se mandan a Meta para revisarlas: {EJEMPLO_MORA.map((e, i) => `{{${i + 1}}} ${e}`).join(", ")}.
            </p>
            <CrearPlantillas faltan={faltanEnMeta} />
          </div>
        )}
      </Card>

      <Card className="p-0">
        <div className="px-6 pt-5">
          <h2 className="text-lg font-bold">Vista previa de hoy</h2>
          <p className="mt-1 text-sm text-finbra-gray">
            Con la foto del {formatFecha(p.fechaCorte)}. {salen.length} recibirían recordatorio y {noSalen.length} no.
          </p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th scope="col" className="px-4 py-2">Cliente</th>
                <th scope="col" className="px-4 py-2 text-right">Vencido</th>
                <th scope="col" className="px-4 py-2">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {[...salen, ...noSalen].map((f) => (
                <tr key={f.clientId} className="border-b border-black/5 align-top last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/backoffice/cobranza/clientes/${f.clientId}`} className="font-medium hover:text-finbra-purple hover:underline">{f.nombre}</Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(f.totalVencido)}</td>
                  <td className="px-4 py-2">
                    {f.decision.enviar ? (
                      <details>
                        <summary className="cursor-pointer text-emerald-700">
                          Recibe <span className="font-mono">{f.decision.plantilla}</span> en {formatTelefono(f.decision.telefono)}
                        </summary>
                        {cuerpoDe.get(f.decision.plantilla) && (
                          <p className="mt-2 whitespace-pre-line rounded-lg bg-emerald-50 p-2 text-sm">
                            {renderPlantilla(cuerpoDe.get(f.decision.plantilla)!, f.decision.parametros)}
                          </p>
                        )}
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                          {VARIABLES_MORA.map((v, i) => (
                            <div key={v} className="contents">
                              <dt className="text-finbra-gray">{`{{${i + 1}}}`} {ETIQUETA_VARIABLE[v]}</dt>
                              <dd className={v === "clabe" ? "font-mono" : ""}>{f.decision.enviar ? f.decision.parametros[i] : ""}</dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    ) : (
                      <span className="text-finbra-gray">No recibe: {minusculaInicial(f.decision.motivo)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.filas.length === 0 && <p className="px-6 pb-5 text-sm text-finbra-gray">No hay clientes en mora en la última foto.</p>}
      </Card>

      <Card className="p-0">
        <h2 className="px-6 pt-5 text-lg font-bold">Últimos envíos</h2>
        {p.ultimos.length === 0 ? (
          <p className="px-6 pb-5 pt-2 text-sm text-finbra-gray">Todavía no se ha enviado ningún recordatorio de mora.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th scope="col" className="px-4 py-2">Cuándo</th>
                  <th scope="col" className="px-4 py-2">Cliente</th>
                  <th scope="col" className="px-4 py-2">Teléfono</th>
                  <th scope="col" className="px-4 py-2">Plantilla</th>
                  <th scope="col" className="px-4 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {p.ultimos.map((m) => (
                  <tr key={m.id} className="border-b border-black/5 align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-2">{formatFechaHora(m.at)}</td>
                    <td className="px-4 py-2">
                      {m.clientId ? <Link href={`/backoffice/cobranza/clientes/${m.clientId}`} className="hover:text-finbra-purple hover:underline">{m.cliente}</Link> : <span className="text-finbra-gray">{m.cliente}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">{formatTelefono(m.telefono)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{m.plantilla}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO[m.estado]?.clase ?? ""}`}>{ESTADO[m.estado]?.label ?? m.estado}</span>
                      {m.error && <span className="mt-1 block text-xs text-red-700">{m.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
