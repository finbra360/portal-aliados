import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { previewCorreos } from "@/lib/db/correos-cobranza";
import { codigoDeError } from "@/lib/collections/errors";
import { formatFecha, formatFechaHora, formatMoney } from "@/lib/format";
import Card from "@/components/ui/Card";
import { CorreoPrueba, CorreoToggle, EnviarCorreosAhora } from "./CorreosControls";

const ESTADO: Record<string, { label: string; clase: string }> = {
  pendiente: { label: "Pendiente", clase: "bg-black/5 text-finbra-gray" },
  enviado: { label: "Enviado", clase: "bg-emerald-100 text-emerald-700" },
  fallido: { label: "Falló", clase: "bg-red-100 text-red-700" },
};

const ORIGEN: Record<string, string> = { recordatorio_mora: "Mora", recordatorio_preventivo: "Preventivo", prueba: "Prueba" };

function Resultado({ decision }: { decision: { enviar: true; destinatarios: string[] } | { enviar: false; motivo: string } }) {
  return decision.enviar ? (
    <span className="text-emerald-700">Recibe en {decision.destinatarios.join(", ")}</span>
  ) : (
    <span className="text-finbra-gray">No recibe: {decision.motivo.charAt(0).toLowerCase() + decision.motivo.slice(1)}</span>
  );
}

function Bloqueos({ bloqueos }: { bloqueos: string[] }) {
  if (bloqueos.length === 0) return <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Listo: en la siguiente corrida de las 9:00 salen los correos de la tabla.</p>;
  return (
    <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
      <p className="font-medium">Hoy no saldría ningún correo:</p>
      <ul className="mt-1 list-disc pl-5">
        {bloqueos.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

export default async function CorreosPage() {
  const session = await getAdminSession();
  if (!puede(session, "cartera.ver")) return null;
  const esSuperAdmin = puede(session, "cobranza.configurar");

  let p: Awaited<ReturnType<typeof previewCorreos>>;
  try {
    p = await previewCorreos();
  } catch (e) {
    const c = codigoDeError("correos", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los correos de cobranza. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  const moraSalen = p.mora.filas.filter((f) => f.decision.enviar).length;
  const prevSalen = p.preventivos.filas.filter((f) => f.decision.enviar).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Correos de cobranza</h1>
        <p className="mt-1 max-w-3xl text-sm text-finbra-gray">
          Los mismos recordatorios que por WhatsApp, por correo a los correos del deudor (nunca a avales ni referencias). Salen de lunes a viernes después de la foto de las 9:00; lo
          que tocaría en fin de semana o día inhábil se adelanta al día hábil anterior. Los manda n8n con la cuenta de Gmail &quot;Correo Cobranza&quot;, así que las respuestas llegan
          a ese buzón. Cada interruptor es independiente del de WhatsApp.
        </p>
      </div>

      {esSuperAdmin && (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">Prueba</h2>
          <p className="text-sm text-finbra-gray">Te manda un correo de ejemplo (preventivo del día, datos ficticios y la primera cuenta de pago activa) para que veas cómo le llega al cliente. Funciona aunque el envío esté apagado.</p>
          <CorreoPrueba correo={session.email} />
        </Card>
      )}

      <Card className="space-y-4">
        <h2 className="text-lg font-bold">Mora</h2>
        <CorreoToggle tipo="mora" activo={p.mora.activado} puedeEditar={esSuperAdmin} />
        <Bloqueos bloqueos={p.mora.bloqueos} />
        {esSuperAdmin && <EnviarCorreosAhora tipo="mora" disponible={p.mora.bloqueosManual.length === 0} cuantos={moraSalen} />}
        <p className="text-sm text-finbra-gray">
          Con la foto del {p.fechaCorte ? formatFecha(p.fechaCorte) : "—"}: {moraSalen} {moraSalen === 1 ? "recibiría correo" : "recibirían correo"} y {p.mora.filas.length - moraSalen} no.
        </p>
        {p.mora.filas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th scope="col" className="py-2 pr-4">Cliente</th>
                  <th scope="col" className="py-2 pr-4 text-right">Vencido</th>
                  <th scope="col" className="py-2">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {p.mora.filas.map((f) => (
                  <tr key={f.clientId} className="border-b border-black/5 align-top last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/backoffice/cobranza/clientes/${f.clientId}`} className="font-medium hover:text-finbra-purple hover:underline">{f.nombre}</Link>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(f.totalVencido)}</td>
                    <td className="py-2"><Resultado decision={f.decision} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-bold">Preventivos</h2>
        <CorreoToggle tipo="preventivo" activo={p.preventivos.activado} puedeEditar={esSuperAdmin} />
        <Bloqueos bloqueos={p.preventivos.bloqueos} />
        {esSuperAdmin && <EnviarCorreosAhora tipo="preventivo" disponible={p.preventivos.bloqueosManual.length === 0} cuantos={prevSalen} />}
        <p className="text-sm text-finbra-gray">
          Créditos a los que hoy les toca recordatorio (5 días antes solo semáforo rojo, 1 día antes amarillo y rojo, el día del pago todos): {prevSalen} {prevSalen === 1 ? "recibiría correo" : "recibirían correo"} y{" "}
          {p.preventivos.filas.length - prevSalen} no.
        </p>
        {p.preventivos.filas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th scope="col" className="py-2 pr-4">Cliente</th>
                  <th scope="col" className="py-2 pr-4">Vence</th>
                  <th scope="col" className="py-2">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {p.preventivos.filas.map((f) => (
                  <tr key={f.creditId} className="border-b border-black/5 align-top last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/backoffice/cobranza/clientes/${f.clientId}`} className="font-medium hover:text-finbra-purple hover:underline">{f.nombre}</Link>
                      <span className="block font-mono text-xs text-finbra-gray">{f.noCredito}</span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4">
                      {formatFecha(f.proximoVencimiento)}
                      <span className="block text-xs text-finbra-gray">{f.etiqueta}</span>
                    </td>
                    <td className="py-2"><Resultado decision={f.decision} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-0">
        <h2 className="px-6 pt-5 text-lg font-bold">Últimos correos</h2>
        <p className="px-6 pt-1 text-sm text-finbra-gray">&quot;Enviado&quot; quiere decir que Gmail lo aceptó; si el correo rebota, la notificación llega al buzón de &quot;Correo Cobranza&quot;.</p>
        {p.ultimos.length === 0 ? (
          <p className="px-6 pb-5 pt-2 text-sm text-finbra-gray">Todavía no se ha enviado ningún correo desde el backoffice.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th scope="col" className="px-4 py-2">Cuándo</th>
                  <th scope="col" className="px-4 py-2">Cliente</th>
                  <th scope="col" className="px-4 py-2">Para</th>
                  <th scope="col" className="px-4 py-2">Tipo</th>
                  <th scope="col" className="px-4 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {p.ultimos.map((m) => (
                  <tr key={m.id} className="border-b border-black/5 align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-2">{formatFechaHora(m.at)}</td>
                    <td className="px-4 py-2">
                      {m.clientId ? (
                        <Link href={`/backoffice/cobranza/clientes/${m.clientId}`} className="hover:text-finbra-purple hover:underline">{m.cliente}</Link>
                      ) : (
                        <span className="text-finbra-gray">{m.cliente}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-finbra-gray">{m.destinatarios.join(", ")}</td>
                    <td className="px-4 py-2">{ORIGEN[m.origen] ?? m.origen}</td>
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
