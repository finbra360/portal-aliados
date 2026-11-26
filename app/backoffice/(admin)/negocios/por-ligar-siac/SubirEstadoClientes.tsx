"use client";

// Subir el Excel «Estado de Clientes» de SIAC Suite. Se lee aquí, en el
// navegador, y al servidor solo van las columnas para ligar (número de
// crédito, cliente, nombre, RFC, monto, fechas y estado); domicilios,
// teléfonos, CURP y saldos no salen de la computadora.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { leerXlsx } from "@/lib/clientes/xlsx";
import { leerEstadoClientes, type LecturaEstadoClientes } from "@/lib/clientes/siac-historico";
import { formatFechaHora } from "@/lib/format";
import { importarHistoricosAction } from "../actions";

const boton = "rounded-lg bg-finbra-purple px-3 py-1.5 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const MAX_BYTES = 15 * 1024 * 1024;

async function inflar(datos: Uint8Array): Promise<Uint8Array> {
  const flujo = new Blob([datos as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString("es-MX")} ${n === 1 ? uno : varios}`;

export default function SubirEstadoClientes({ total, ultimaVez }: { total: number; ultimaVez: string | null }) {
  const router = useRouter();
  const [lectura, setLectura] = useState<(LecturaEstadoClientes & { archivo: string }) | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [pendiente, start] = useTransition();

  const elegir = async (f: File | undefined) => {
    setLectura(null);
    setAviso(null);
    setError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) return setError("El archivo es demasiado grande.");
    setLeyendo(true);
    try {
      const renglones = await leerXlsx(new Uint8Array(await f.arrayBuffer()), inflar);
      setLectura({ ...leerEstadoClientes(renglones), archivo: f.name });
    } catch (e) {
      setError(e instanceof Error && /Excel/.test(e.message) ? e.message : "No pudimos leer el archivo. Revisa que sea el Excel del Estado de Clientes de SIAC.");
    } finally {
      setLeyendo(false);
    }
  };

  const guardar = () =>
    start(async () => {
      if (!lectura) return;
      setError(null);
      const x = await importarHistoricosAction(lectura.creditos);
      if (!x.ok) return setError(x.error);
      setAviso(
        `Listo: ${plural(x.r.nuevos, "crédito nuevo", "créditos nuevos")} y ${plural(x.r.actualizados, "actualizado", "actualizados")}. ` +
          `${plural(x.r.enCobranza, "sigue", "siguen")} en cobranza y ${plural(x.r.libres, "quedó", "quedaron")} para ligar.`,
      );
      setLectura(null);
      router.refresh();
    });

  const porEstado = new Map<string, number>();
  for (const c of lectura?.creditos ?? []) porEstado.set(c.estado ?? "SIN ESTADO", (porEstado.get(c.estado ?? "SIN ESTADO") ?? 0) + 1);

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">Créditos pagados de SIAC</h2>
        <span className="text-xs text-finbra-gray">
          {total > 0 ? `${plural(total, "crédito", "créditos")} del Estado de Clientes${ultimaVez ? ` · subido ${formatFechaHora(ultimaVez)}` : ""}` : "Todavía no se sube"}
        </span>
      </div>
      <p className="text-finbra-gray">
        El listado de cobranza solo trae los créditos vigentes. Para ligar negocios con créditos ya pagados, sube el reporte <b>Estado de Clientes</b> de SIAC
        Suite (Excel, con todos los estados). Se queda solo lo necesario para ligar; volver a subirlo actualiza, no duplica.
      </p>
      <label className="inline-flex cursor-pointer items-center gap-2">
        <span className="rounded-lg border border-black/10 px-3 py-1.5 font-semibold hover:bg-black/5">{leyendo ? "Leyendo…" : "Elegir el Excel"}</span>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={leyendo || pendiente}
          onChange={(e) => {
            void elegir(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {lectura && (
        <div className="space-y-2 rounded-lg border border-black/5 bg-black/[0.02] p-3">
          <p className="font-medium">{lectura.archivo}</p>
          {lectura.faltan.length > 0 ? (
            <p className="text-red-700" role="alert">
              Este archivo no parece el Estado de Clientes: le faltan las columnas {lectura.faltan.map((f) => `«${f}»`).join(", ")}.
            </p>
          ) : lectura.creditos.length === 0 ? (
            <p className="text-red-700" role="alert">El archivo no trae créditos.</p>
          ) : (
            <>
              <p>
                {plural(lectura.creditos.length, "crédito", "créditos")}:{" "}
                {[...porEstado.entries()].map(([e, n]) => `${n} ${e.toLowerCase()}`).join(" · ")}
              </p>
              {lectura.errores.length > 0 && (
                <details className="text-amber-800">
                  <summary className="cursor-pointer">{plural(lectura.errores.length, "renglón no se pudo leer", "renglones no se pudieron leer")} (no se suben)</summary>
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {lectura.errores.slice(0, 50).map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
              <button type="button" onClick={guardar} disabled={pendiente} className={boton}>
                {pendiente ? "Guardando…" : `Guardar ${plural(lectura.creditos.length, "crédito", "créditos")}`}
              </button>
            </>
          )}
        </div>
      )}
      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800" role="status">{aviso}</p>}
      {error && <p className="text-red-700" role="alert">{error}</p>}
    </div>
  );
}
