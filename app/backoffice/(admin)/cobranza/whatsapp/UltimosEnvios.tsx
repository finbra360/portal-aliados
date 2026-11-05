import Link from "next/link";
import type { EnvioReciente } from "@/lib/db/whatsapp-mora";
import { formatFechaHora, formatTelefono } from "@/lib/format";
import Card from "@/components/ui/Card";

const ESTADO: Record<string, { label: string; clase: string }> = {
  pendiente: { label: "Pendiente", clase: "bg-black/5 text-finbra-gray" },
  enviado: { label: "Enviado", clase: "bg-emerald-100 text-emerald-700" },
  entregado: { label: "Entregado", clase: "bg-emerald-100 text-emerald-700" },
  leido: { label: "Leído", clase: "bg-emerald-100 text-emerald-700" },
  fallido: { label: "Falló", clase: "bg-red-100 text-red-700" },
};

/** Tabla de los últimos mensajes enviados, con el estado que reporta Meta. */
export default function UltimosEnvios({ envios, vacio }: { envios: EnvioReciente[]; vacio: string }) {
  return (
    <Card className="p-0">
      <h2 className="px-6 pt-5 text-lg font-bold">Últimos envíos</h2>
      <p className="px-6 pt-1 text-sm text-finbra-gray">El estado se actualiza solo con lo que reporta Meta: Enviado → Entregado → Leído, o Falló con el motivo.</p>
      {envios.length === 0 ? (
        <p className="px-6 pb-5 pt-2 text-sm text-finbra-gray">{vacio}</p>
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
              {envios.map((m) => (
                <tr key={m.id} className="border-b border-black/5 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-2">{formatFechaHora(m.at)}</td>
                  <td className="px-4 py-2">
                    {m.clientId ? (
                      <Link href={`/backoffice/cobranza/clientes/${m.clientId}`} className="hover:text-finbra-purple hover:underline">{m.cliente}</Link>
                    ) : (
                      <span className="text-finbra-gray">{m.cliente}</span>
                    )}
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
  );
}
