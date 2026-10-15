import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, hasRole } from "@/lib/rbac";
import { conversacion, listarConversaciones, marcarLeida, plantillaContacto, type MensajeChat } from "@/lib/db/whatsapp-chat";
import { EJEMPLO_CONTACTO, PLANTILLA_CONTACTO } from "@/lib/collections/chat";
import { codigoDeError } from "@/lib/collections/errors";
import { formatFechaHora, formatTelefono } from "@/lib/format";
import Card from "@/components/ui/Card";
import { AlFinal, AutoRefresh, BajaToggle, Responder, Retomar } from "./ChatControls";
import { CrearPlantillas } from "../whatsapp/WhatsAppControls";

const BASE = "/backoffice/cobranza/chat";

const ORIGEN: Record<string, string> = {
  recordatorio_mora: "Recordatorio de mora",
  recordatorio_preventivo: "Recordatorio preventivo",
  backoffice_manual: "Envío de prueba",
  chat: "Respuesta",
};

function Palomitas({ m }: { m: MensajeChat }) {
  if (m.direccion !== "saliente") return null;
  if (m.estado === "fallido") return <span className="text-red-200" title={m.error ?? "No se entregó"}>✕ No se entregó</span>;
  if (m.estado === "leido") return <span className="text-sky-200" title="Leído">✓✓</span>;
  if (m.estado === "entregado") return <span title="Entregado">✓✓</span>;
  if (m.estado === "enviado") return <span title="Enviado">✓</span>;
  return <span title="Pendiente">…</span>;
}

function Burbuja({ m }: { m: MensajeChat }) {
  const sale = m.direccion === "saliente";
  return (
    <div className={`flex ${sale ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] space-y-1 rounded-2xl px-3 py-2 text-sm sm:max-w-[70%] ${sale ? "bg-finbra-purple text-white" : "bg-black/5"}`}>
        {sale && (
          <p className={`text-[11px] ${sale ? "text-white/70" : "text-finbra-gray"}`}>
            {ORIGEN[m.origen] ?? "Mensaje"}
            {m.enviadoPor && m.enviadoPor !== "sistema" && m.origen === "chat" ? ` · ${m.enviadoPor}` : ""}
          </p>
        )}
        {m.media &&
          (m.media.mime?.startsWith("image/") ? (
            <a href={`/api/whatsapp/media/${m.media.id}`} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/whatsapp/media/${m.media.id}`} alt={m.texto} className="max-h-64 rounded-lg" />
            </a>
          ) : (
            <a href={`/api/whatsapp/media/${m.media.id}`} target="_blank" rel="noopener noreferrer" className="block underline">
              📎 Abrir {m.media.nombre ?? "archivo"}
            </a>
          ))}
        {!(m.media && !m.media.mime?.startsWith("image/") && m.texto === m.media.nombre) && <p className="whitespace-pre-line break-words">{m.texto}</p>}
        <p className={`flex justify-end gap-2 text-[11px] ${sale ? "text-white/70" : "text-finbra-gray"}`}>
          <span>{formatFechaHora(m.at)}</span>
          <Palomitas m={m} />
        </p>
        {m.estado === "fallido" && m.error && <p className="text-[11px] text-red-100">{m.error}</p>}
      </div>
    </div>
  );
}

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ t?: string; todos?: string }> }) {
  const session = await getAdminSession();
  if (!hasRole(session, COBRANZA_ROLES)) return null;
  const esSuperAdmin = session.role === "super_admin";
  const sp = await searchParams;
  const telefono = sp.t && /^\d{10,15}$/.test(sp.t) ? sp.t : null;
  const todos = sp.todos === "1";

  let lista: Awaited<ReturnType<typeof listarConversaciones>>;
  let abierta: Awaited<ReturnType<typeof conversacion>> = null;
  let contacto: Awaited<ReturnType<typeof plantillaContacto>> = null;
  try {
    // Abrir la conversación es leerla.
    if (telefono) await marcarLeida(telefono);
    [lista, abierta, contacto] = await Promise.all([
      listarConversaciones({ soloConRespuesta: !todos }),
      telefono ? conversacion(telefono) : Promise.resolve(null),
      plantillaContacto(),
    ]);
  } catch (e) {
    const c = codigoDeError("chat", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar el chat. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  const sinLeer = lista.reduce((s, c) => s + c.sinLeer, 0);
  const qs = (t: string | null) => {
    const p = new URLSearchParams();
    if (t) p.set("t", t);
    if (todos) p.set("todos", "1");
    const s = p.toString();
    return s ? `${BASE}?${s}` : BASE;
  };

  return (
    <div className="space-y-4">
      <AutoRefresh />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Chat de WhatsApp</h1>
          <p className="mt-1 text-sm text-finbra-gray">
            Lo que contestan los clientes y las respuestas del equipo. {sinLeer > 0 ? `${sinLeer} sin leer.` : "Todo leído."} Se actualiza solo cada 15 segundos.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href={telefono ? `${BASE}?t=${telefono}` : BASE} prefetch={false} className={`rounded-full px-4 py-1.5 font-medium ${!todos ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"}`}>
            Con respuesta
          </Link>
          <Link href={telefono ? `${BASE}?t=${telefono}&todos=1` : `${BASE}?todos=1`} prefetch={false} className={`rounded-full px-4 py-1.5 font-medium ${todos ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"}`}>
            Todos los envíos
          </Link>
        </div>
      </div>

      {esSuperAdmin && contacto && !contacto.tieneTexto && (
        <Card className="space-y-2">
          <p className="text-sm">
            Para escribirle a un cliente cuando ya pasaron 24 horas desde su último mensaje, Meta pide una plantilla aprobada. Esta todavía no existe en Meta:
          </p>
          <p className="rounded-lg bg-black/[0.03] p-2 text-sm">{PLANTILLA_CONTACTO.cuerpo}</p>
          <p className="text-xs text-finbra-gray">Ejemplo que se manda a Meta: {"{{1}}"} {EJEMPLO_CONTACTO[0]}.</p>
          <CrearPlantillas faltan={[PLANTILLA_CONTACTO.nombre]} />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <Card className={`p-0 ${telefono ? "hidden lg:block" : ""}`}>
          {lista.length === 0 ? (
            <p className="p-6 text-sm text-finbra-gray">
              {todos ? "Todavía no hay mensajes." : "Ningún cliente ha contestado todavía. Los mensajes llegan aquí cuando Meta está conectado al backoffice."}
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-black/5 overflow-y-auto">
              {lista.map((c) => (
                <li key={c.telefono}>
                  <Link
                    href={qs(c.telefono)}
                    prefetch={false}
                    className={`block px-4 py-3 hover:bg-black/[0.03] ${c.telefono === telefono ? "bg-finbra-purple/5" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${c.sinLeer ? "font-bold" : "font-medium"}`}>{c.cliente ?? c.perfilNombre ?? formatTelefono(c.telefono)}</span>
                      {c.sinLeer > 0 && <span className="rounded-full bg-finbra-purple px-2 py-0.5 text-xs font-semibold text-white">{c.sinLeer}</span>}
                    </div>
                    <p className="truncate text-xs text-finbra-gray">
                      {c.ultimo.direccion === "saliente" ? "Tú: " : ""}
                      {c.ultimo.texto}
                    </p>
                    <p className="text-[11px] text-finbra-gray">
                      {formatFechaHora(c.ultimo.at)}
                      {c.ventanaAbierta && " · ventana abierta"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className={`p-0 ${telefono ? "" : "hidden lg:block"}`}>
          {!abierta ? (
            <p className="p-6 text-sm text-finbra-gray">{telefono ? "No encontramos esa conversación." : "Elige una conversación."}</p>
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-black/5 px-4 py-3">
                <div>
                  <Link href={qs(null)} prefetch={false} className="text-xs text-finbra-purple hover:underline lg:hidden">← Conversaciones</Link>
                  <p className="font-semibold">
                    {abierta.cliente ? (
                      <Link href={`/backoffice/cobranza/clientes/${abierta.cliente.id}`} className="hover:text-finbra-purple hover:underline">{abierta.cliente.nombre}</Link>
                    ) : (
                      abierta.perfilNombre ?? "Número sin cliente"
                    )}
                  </p>
                  <p className="text-xs text-finbra-gray">
                    {formatTelefono(abierta.telefono)}
                    {abierta.cliente && abierta.perfilNombre ? ` · en WhatsApp: ${abierta.perfilNombre}` : ""}
                    {!abierta.cliente && " · no coincide con ningún contacto de un cliente"}
                  </p>
                  {abierta.dadoDeBaja && <p className="mt-1 text-xs font-medium text-amber-800">Pidió no recibir WhatsApp: no se le mandan recordatorios.</p>}
                </div>
                <div className="flex items-center gap-2">
                  {abierta.cliente && (
                    <Link href={`/backoffice/cobranza/clientes/${abierta.cliente.id}`} className="rounded-lg bg-black/5 px-3 py-1.5 text-xs font-medium hover:bg-black/10">
                      Perfil y promesas
                    </Link>
                  )}
                  {abierta.cliente && <BajaToggle telefono={abierta.telefono} dadoDeBaja={abierta.dadoDeBaja} />}
                </div>
              </div>

              <div className="max-h-[60vh] space-y-2 overflow-y-auto px-4 py-3">
                {abierta.mensajes.map((m) => (
                  <Burbuja key={m.id} m={m} />
                ))}
                <AlFinal cuantos={abierta.mensajes.length} />
              </div>

              <div className="border-t border-black/5 px-4 py-3">
                {abierta.ventana.abierta ? (
                  <div className="space-y-1">
                    <Responder telefono={abierta.telefono} />
                    <p className="text-[11px] text-finbra-gray">Puedes escribir libremente hasta el {formatFechaHora(abierta.ventana.cierraAt!)} (24 h después de su último mensaje).</p>
                  </div>
                ) : (
                  <Retomar telefono={abierta.telefono} disponible={abierta.retomarDisponible && !abierta.dadoDeBaja} />
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
