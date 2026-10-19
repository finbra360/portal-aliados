import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getOperationOfBroker, listOperationHistory } from "@/lib/db/operations";
import { diasEntre, pasosDeSeguimiento } from "@/lib/operaciones-seguimiento";
import { formatCurrency, formatFechaHora } from "@/lib/format";
import Card from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";

const ESTILO_PASO = {
  hecho: { punto: "bg-emerald-500 text-white", texto: "text-black" },
  actual: { punto: "bg-finbra-purple text-white ring-4 ring-finbra-purple/20", texto: "font-bold text-finbra-purple" },
  pendiente: { punto: "bg-black/10 text-finbra-gray", texto: "text-finbra-gray" },
  rechazada: { punto: "bg-red-500 text-white", texto: "font-bold text-red-700" },
} as const;

export const metadata: Metadata = { title: "Seguimiento de solicitud" };

export default async function OperacionDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idTexto } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) return null;

  const id = /^\d{1,9}$/.test(idTexto) ? Number(idTexto) : null;
  if (id === null) notFound();

  let operacion: Awaited<ReturnType<typeof getOperationOfBroker>> = null;
  let historial: Awaited<ReturnType<typeof listOperationHistory>> = [];
  try {
    operacion = await getOperationOfBroker(id, session.brokerId);
    if (operacion) historial = await listOperationHistory(operacion.id);
  } catch {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar esta solicitud en este momento. Intenta de nuevo más tarde.
      </div>
    );
  }
  if (!operacion) notFound();

  const ahora = new Date().toISOString();
  const pasos = pasosDeSeguimiento(operacion.etapa, historial);
  const dias = diasEntre(operacion.updatedAt, ahora);
  const enCurso = operacion.etapa !== "fondeada" && operacion.etapa !== "rechazada";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/operaciones" className="text-sm font-medium text-finbra-purple hover:underline">
          ← Mis Operaciones
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{operacion.clienteReferencia}</h1>
      </div>

      <Card>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-finbra-gray">Monto solicitado</dt>
            <dd className="mt-1 text-xl font-bold">{formatCurrency(operacion.montoSolicitado)}</dd>
          </div>
          <div>
            <dt className="text-finbra-gray">Etapa actual</dt>
            <dd className="mt-1">
              <StatusPill status={operacion.etapa} />
            </dd>
          </div>
          <div>
            <dt className="text-finbra-gray">Última actualización</dt>
            <dd className="mt-1 font-medium">
              {formatFechaHora(operacion.updatedAt)}
              {enCurso && <span className="block text-xs text-finbra-gray">{dias === 0 ? "Hoy" : `Hace ${dias} día${dias === 1 ? "" : "s"}`} en esta etapa</span>}
            </dd>
          </div>
        </dl>
      </Card>

      {operacion.mensajeBroker && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900" role="note">
          <p className="mb-1 font-bold">Mensaje de Finbra</p>
          <p className="whitespace-pre-line">{operacion.mensajeBroker}</p>
        </div>
      )}

      <Card>
        <p className="mb-4 text-sm font-medium text-finbra-gray">Seguimiento</p>
        <ol className="space-y-0">
          {pasos.map((p, i) => {
            const estilo = ESTILO_PASO[p.estado];
            const ultimo = i === pasos.length - 1;
            return (
              <li key={p.etapa} className="flex gap-4" aria-current={p.estado === "actual" ? "step" : undefined}>
                <div className="flex flex-col items-center">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${estilo.punto}`}>
                    {p.estado === "hecho" ? "✓" : p.estado === "rechazada" ? "✕" : i + 1}
                  </span>
                  {!ultimo && <span className={`w-0.5 flex-1 ${p.estado === "hecho" ? "bg-emerald-300" : "bg-black/10"}`} style={{ minHeight: 20 }} />}
                </div>
                <div className="pb-5">
                  <p className={`text-sm ${estilo.texto}`}>{p.nombre}</p>
                  {p.fecha && <p className="text-xs text-finbra-gray">{formatFechaHora(p.fecha)}</p>}
                  {p.estado === "actual" && p.etapa === "documentacion_pendiente" && (
                    <p className="mt-1 text-xs text-amber-800">Falta documentación del cliente para seguir con el análisis.</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
