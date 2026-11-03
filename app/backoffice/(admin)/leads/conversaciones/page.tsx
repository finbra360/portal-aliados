import Link from "next/link";
import {
  listConversacionesPendientes,
  resumenProspeccionHoy,
  VENTANA_HORAS,
  type ConversacionPendiente,
} from "@/lib/db/prospeccion";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import { IconFlame, IconTarget, IconListChecks, IconUsers } from "@/components/ui/icons";
import { marcarAtendidaAction } from "./actions";

const HORA_MX = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "short",
});

const PESOS = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

/**
 * wa.me necesita el número en internacional sin signos. DENUE lo entrega a diez
 * dígitos y WhatsApp lo entrega con el 52 por delante, así que hay que aceptar
 * los dos. El 1 que México usaba después del 52 ya no se escribe, pero sigue
 * apareciendo en datos viejos y wa.me lo tolera, así que no lo tocamos.
 */
function waHref(raw: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `https://wa.me/52${d}`;
  if (d.length === 12 && d.startsWith("52")) return `https://wa.me/${d}`;
  if (d.length === 13 && d.startsWith("521")) return `https://wa.me/${d}`;
  return null;
}

type Urgencia = "vencida" | "critica" | "pronto" | "holgada";

function ventana(ultimoMensaje: string, ahora: number): { restanteMin: number; urgencia: Urgencia; etiqueta: string } {
  const cierra = new Date(ultimoMensaje).getTime() + VENTANA_HORAS * 3600_000;
  const restanteMin = Math.floor((cierra - ahora) / 60_000);

  if (restanteMin <= 0) return { restanteMin, urgencia: "vencida", etiqueta: "Vencida" };

  const h = Math.floor(restanteMin / 60);
  const m = restanteMin % 60;
  const etiqueta = h > 0 ? `${h} h ${m} min` : `${m} min`;
  const urgencia: Urgencia = restanteMin < 240 ? "critica" : restanteMin < 720 ? "pronto" : "holgada";
  return { restanteMin, urgencia, etiqueta };
}

const ESTILO_URGENCIA: Record<Urgencia, string> = {
  vencida: "bg-black/5 text-finbra-gray",
  critica: "bg-red-100 text-red-700",
  pronto: "bg-amber-100 text-amber-800",
  holgada: "bg-emerald-100 text-emerald-700",
};

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-finbra-gray">{etiqueta}</dt>
      <dd className="font-semibold">{valor}</dd>
    </div>
  );
}

function Conversacion({ c, ahora }: { c: ConversacionPendiente; ahora: number }) {
  const v = ventana(c.ultimoMensaje, ahora);
  const wa = waHref(c.telefono);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-bold">{c.nombreComercial}</p>
          <p className="text-xs text-finbra-gray">
            {c.totalScore != null && <span className="font-semibold text-finbra-purple">{c.totalScore}/100</span>}
            {c.totalScore != null && " · "}
            Último mensaje {HORA_MX.format(new Date(c.ultimoMensaje))}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${ESTILO_URGENCIA[v.urgencia]}`}>
          {v.urgencia === "vencida" ? "Ventana vencida" : `Quedan ${v.etiqueta}`}
        </span>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <Dato etiqueta="Unidades propias" valor={c.unidades != null ? String(c.unidades) : "sin confirmar"} />
        <Dato
          etiqueta="Libres de gravamen"
          valor={c.libresGravamen == null ? "sin confirmar" : c.libresGravamen ? "Sí" : "No"}
        />
        <Dato etiqueta="Ventas anuales" valor={c.ventas != null ? PESOS.format(c.ventas) : "sin confirmar"} />
      </dl>

      {c.mensajeRecibido && (
        <div className="rounded-xl bg-black/[0.03] p-3 text-sm">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-finbra-gray">Lo último que escribió</p>
          <p className="italic">“{c.mensajeRecibido}”</p>
          {c.respuestaEnviada && (
            <p className="mt-2 text-xs text-finbra-gray">
              El agente contestó: {c.respuestaEnviada.split("\n")[0]}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {v.urgencia === "vencida" ? (
          <span className="text-xs text-finbra-gray">
            Pasaron más de {VENTANA_HORAS} horas: ya no se le puede escribir sin plantilla aprobada.
          </span>
        ) : wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            Abrir WhatsApp
          </a>
        ) : (
          <span className="text-xs text-finbra-gray">Sin teléfono utilizable para WhatsApp.</span>
        )}

        <form action={marcarAtendidaAction} className="flex flex-1 flex-wrap items-center gap-2">
          <input type="hidden" name="companyId" value={c.companyId} />
          <input
            name="nota"
            placeholder="Qué pasó (opcional)…"
            className="min-w-[180px] flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold hover:bg-black/5"
          >
            Ya la atendí
          </button>
        </form>
      </div>
    </Card>
  );
}

export default async function ConversacionesPage() {
  let conversaciones: ConversacionPendiente[] = [];
  let resumen = { hoyHandoff: 0, hoyEnCurso: 0, hoyCerradas: 0, hoyCorreos: 0, hoyAtendidas: 0 };
  let loadError = false;

  try {
    [conversaciones, resumen] = await Promise.all([
      listConversacionesPendientes(),
      resumenProspeccionHoy(),
    ]);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar las conversaciones en este momento.
      </div>
    );
  }

  const ahora = Date.now();
  const criticas = conversaciones.filter((c) => {
    const v = ventana(c.ultimoMensaje, ahora);
    return v.urgencia === "critica";
  }).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Conversaciones</h1>
        <p className="text-sm text-finbra-gray">
          Prospectos que el agente ya filtró y dejó listos para una persona. Ordenados por lo que queda
          de ventana, no por score: la de arriba es la que se vence primero.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="En cola" value={String(conversaciones.length)} icon={<IconListChecks />} />
        <StatCard label="Vencen en menos de 4 h" value={String(criticas)} icon={<IconFlame />} />
        <StatCard label="Atendidas hoy" value={String(resumen.hoyAtendidas)} icon={<IconUsers />} />
        <StatCard
          label="Conversaciones hoy"
          value={String(resumen.hoyHandoff + resumen.hoyEnCurso + resumen.hoyCerradas)}
          sublabel={`${resumen.hoyHandoff} pasaron a humano`}
          icon={<IconTarget />}
        />
        <StatCard label="Correos enviados hoy" value={String(resumen.hoyCorreos)} />
      </div>

      {conversaciones.length === 0 ? (
        <EmptyState
          icon={<IconTarget />}
          title="Nadie esperando"
          description="Cuando un prospecto conteste el correo por WhatsApp y el agente confirme que cumple el perfil, aparece aquí con su reloj corriendo."
        />
      ) : (
        <div className="space-y-4">
          {conversaciones.map((c) => (
            <Conversacion key={c.companyId} c={c} ahora={ahora} />
          ))}
        </div>
      )}

      <p className="text-xs text-finbra-gray">
        ¿Buscas la base completa de leads?{" "}
        <Link href="/backoffice/leads" className="text-finbra-purple hover:underline">
          Ir a Leads
        </Link>
        .
      </p>
    </div>
  );
}
