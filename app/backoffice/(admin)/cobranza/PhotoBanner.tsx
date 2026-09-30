import type { PhotoStatus } from "@/lib/db/collections";
import { formatFecha } from "@/lib/format";

const hora = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * De qué fecha son los datos y si hay que desconfiar de ellos. Va arriba de
 * cada pantalla de cobranza: nadie debe cobrar con una foto vieja sin saberlo.
 */
export default function PhotoBanner({ status }: { status: PhotoStatus }) {
  const ultima = status.ultimaCorrida;
  const fallo = ultima && ultima.status !== "completado" && ultima.fechaCorte !== status.fechaCorte;
  const atrasada = (status.diasDeAtraso ?? 0) >= 1;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {status.fechaCorte && (
        <span className="text-finbra-gray">
          Datos de SIAC al <strong className="text-black">{formatFecha(status.fechaCorte)}</strong>
          {status.tomadaAt && <> · actualizados a las {hora(status.tomadaAt)}</>}
        </span>
      )}
      {status.ambiente === "pruebas" && (
        <span className="rounded-full bg-finbra-lilac/40 px-3 py-1 text-xs font-semibold text-finbra-purple">
          Ambiente de pruebas de SIAC: sirve para revisar la plataforma, no para decidir cobranza
        </span>
      )}
      {(fallo || atrasada) && (
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
          {fallo && ultima?.status === "foto_vieja"
            ? `SIAC no actualizó la foto del ${formatFecha(ultima.fechaCorte)}; se muestra la anterior`
            : fallo
              ? `Falló la sincronización del ${formatFecha(ultima?.fechaCorte ?? null)}; se muestra la última foto completa`
              : `La foto más reciente es de hace ${status.diasDeAtraso} día${status.diasDeAtraso === 1 ? "" : "s"}`}
        </span>
      )}
    </div>
  );
}
