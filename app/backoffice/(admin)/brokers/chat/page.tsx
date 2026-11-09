import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { conversacionAliado, conversacionesAliados, estadoConexionAliados } from "@/lib/db/aliados-chat";
import { formatFechaHora, formatTelefono } from "@/lib/format";
import Card from "@/components/ui/Card";
import { BROKERS_EDITAN } from "../roles";
import { MarcarLeido, ResponderAliado } from "./ChatAliadosControls";

const ESTADO: Record<string, string> = { pendiente: "Enviando", enviado: "Enviado", entregado: "Entregado", leido: "Leído", fallido: "Falló" };

export default async function ChatAliadosPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const session = await getAdminSession();
  if (!hasRole(session, BROKERS_EDITAN)) return null;
  const { t } = await searchParams;
  const telefono = t && /^\d{10,15}$/.test(t) ? t : null;

  let conversaciones: Awaited<ReturnType<typeof conversacionesAliados>>;
  let abierta: Awaited<ReturnType<typeof conversacionAliado>> | null = null;
  let conexion: Awaited<ReturnType<typeof estadoConexionAliados>>;
  try {
    [conversaciones, conexion] = await Promise.all([conversacionesAliados(), estadoConexionAliados()]);
    if (telefono) abierta = await conversacionAliado(telefono);
  } catch (e) {
    const c = codigoDeError("chat aliados", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar el chat de aliados. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  const actual = conversaciones.find((c) => c.telefono === telefono) ?? null;
  const motivoNoResponder = !conexion.ok
    ? conexion.detalle
    : abierta && !abierta.ventanaAbierta
      ? "Pasaron más de 24 h desde su último mensaje: WhatsApp solo deja contestar con texto libre dentro de esa ventana. Si hace falta, escríbele desde otro medio."
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Chat de aliados</h1>
        <p className="mt-1 max-w-3xl text-sm text-finbra-gray">
          Lo que los aliados le escriben al WhatsApp de Aliados (55 9990 0795), por ejemplo cuando contestan el seguimiento de cada 15 días. Cada mensaje nuevo también avisa a Slack.
          Las respuestas salen desde ese mismo número.
        </p>
        <p className={`mt-2 text-sm ${conexion.ok ? "text-emerald-700" : "text-amber-800"}`}>{conexion.detalle}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="p-0">
          <h2 className="px-4 pt-4 text-sm font-semibold uppercase tracking-wide text-finbra-gray">Conversaciones</h2>
          {conversaciones.length === 0 ? (
            <p className="p-4 text-sm text-finbra-gray">Todavía no ha escrito ningún aliado.</p>
          ) : (
            <ul className="mt-2 divide-y divide-black/5">
              {conversaciones.map((c) => (
                <li key={c.telefono}>
                  <Link
                    href={`/backoffice/brokers/chat?t=${c.telefono}`}
                    className={`block px-4 py-3 text-sm hover:bg-black/5 ${c.telefono === telefono ? "bg-finbra-purple/5" : ""}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{c.nombre}</span>
                      {c.sinLeer > 0 && <span className="rounded-full bg-finbra-purple px-2 py-0.5 text-xs font-semibold text-white">{c.sinLeer}</span>}
                    </span>
                    <span className="block truncate text-finbra-gray">{c.ultimo ?? "—"}</span>
                    <span className="block text-xs text-finbra-gray">{formatFechaHora(c.ultimoAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4">
          {!telefono || !abierta ? (
            <p className="text-sm text-finbra-gray">Elige una conversación.</p>
          ) : (
            <>
              <MarcarLeido telefono={telefono} sinLeer={actual?.sinLeer ?? 0} />
              <div>
                <h2 className="text-lg font-bold">{actual?.nombre ?? formatTelefono(telefono)}</h2>
                <p className="text-sm text-finbra-gray">
                  {formatTelefono(telefono)}
                  {actual?.brokerId && (
                    <>
                      {" · "}
                      <Link href={`/backoffice/brokers/${actual.brokerId}`} className="text-finbra-purple hover:underline">Aliado {actual.brokerId}</Link>
                    </>
                  )}
                  {!actual?.brokerId && " · No coincide con ningún aliado de Brokers"}
                </p>
              </div>
              <ol className="max-h-[60vh] space-y-2 overflow-y-auto">
                {abierta.mensajes.map((m) => (
                  <li key={m.id} className={`flex ${m.direccion === "saliente" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${m.direccion === "saliente" ? "bg-finbra-purple/10" : "bg-black/5"}`}>
                      {m.cuerpo && <p className="whitespace-pre-wrap break-words">{m.cuerpo}</p>}
                      {m.media && (
                        <a href={`/api/whatsapp/aliados-media/${m.id}`} target="_blank" rel="noreferrer" className="text-finbra-purple hover:underline">
                          Ver archivo{m.media.nombre ? `: ${m.media.nombre}` : ""}
                        </a>
                      )}
                      <p className="mt-1 text-xs text-finbra-gray">
                        {formatFechaHora(m.at)}
                        {m.direccion === "saliente" && ` · ${ESTADO[m.estado] ?? m.estado}${m.enviadoPor ? ` · ${m.enviadoPor}` : ""}`}
                      </p>
                      {m.error && <p className="text-xs text-red-700">{m.error}</p>}
                    </div>
                  </li>
                ))}
              </ol>
              <ResponderAliado telefono={telefono} habilitado={!motivoNoResponder} motivo={motivoNoResponder} />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
