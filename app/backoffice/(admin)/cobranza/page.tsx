import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, hasRole } from "@/lib/rbac";
import { getCollectionsOverview, getPhotoStatus } from "@/lib/db/collections";
import type { Bucket } from "@/lib/collections/rules";
import { formatFecha, formatMoney, formatRatio } from "@/lib/format";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import { IconCoins, IconListChecks, IconWallet, IconTrendingUp } from "@/components/ui/icons";
import PhotoBanner from "./PhotoBanner";

const BUCKET_LABEL: Record<Bucket, string> = {
  al_corriente: "Al corriente",
  "1-7": "1 a 7 días",
  "8-30": "8 a 30 días",
  "31-60": "31 a 60 días",
  "61-90": "61 a 90 días",
  "90+": "Más de 90 días",
};

const BUCKET_COLOR: Record<Bucket, string> = {
  al_corriente: "bg-emerald-400",
  "1-7": "bg-finbra-lilac",
  "8-30": "bg-amber-300",
  "31-60": "bg-amber-500",
  "61-90": "bg-red-400",
  "90+": "bg-red-600",
};

function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">{children}</div>;
}

export default async function CobranzaInicioPage() {
  if (!hasRole(await getAdminSession(), COBRANZA_ROLES)) return null;

  let status: Awaited<ReturnType<typeof getPhotoStatus>>;
  try {
    status = await getPhotoStatus();
  } catch {
    return <ErrorBox>No pudimos leer el estado de la sincronización con SIAC.</ErrorBox>;
  }

  if (!status.fechaCorte) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Cobranza</h1>
        <PhotoBanner status={status} />
        <EmptyState
          icon={<IconWallet />}
          title="Todavía no hay datos de cartera"
          description="La primera foto de SIAC aparece aquí en cuanto corra la sincronización diaria (6:00 a.m.) o se lance a mano."
        />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof getCollectionsOverview>>;
  try {
    data = await getCollectionsOverview(status.fechaCorte);
  } catch {
    return <ErrorBox>No pudimos cargar la cartera en este momento.</ErrorBox>;
  }
  const { resumen: r, cobrado, umbral } = data;
  const maxAdeudoBucket = Math.max(1, ...r.aging.map((a) => a.adeudo));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Cobranza</h1>
        <Link
          href="/backoffice/cobranza/cola"
          className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90"
        >
          Ver cola de trabajo
        </Link>
      </div>
      <PhotoBanner status={status} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Adeudo total"
          value={formatMoney(r.adeudo)}
          sublabel={`${r.creditos} créditos · colocado ${formatMoney(r.colocado)}`}
          icon={<IconWallet />}
        />
        <StatCard
          label="Vencido"
          value={formatMoney(r.vencido)}
          sublabel={`${formatRatio(r.pctVencido)} del adeudo · moratorios ${formatMoney(r.moratorios)}`}
          icon={<IconTrendingUp />}
        />
        <StatCard
          label="Clientes en mora"
          value={`${r.clientesEnMora} de ${r.clientes}`}
          sublabel={`${formatMoney(r.vencidoEnMora)} vencidos · vencido ≥ ${formatMoney(umbral)}`}
          icon={<IconListChecks />}
        />
        <StatCard
          label="Cobrado en el día"
          value={formatMoney(cobrado.hoy.monto)}
          sublabel={`7 días: ${formatMoney(cobrado.semana.monto)} · mes: ${formatMoney(cobrado.mes.monto)}`}
          icon={<IconCoins />}
        />
      </div>
      {data.pagosSinMonto > 0 && (
        <p className="-mt-3 text-xs text-amber-800">
          {data.pagosSinMonto} pago{data.pagosSinMonto === 1 ? "" : "s"} detectado{data.pagosSinMonto === 1 ? "" : "s"} este mes
          todavía sin monto de ConsultarPagos: lo cobrado puede ser mayor.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <p className="mb-4 text-sm font-medium text-finbra-gray">Cartera por días de atraso</p>
          <div className="space-y-3">
            {r.aging.map((a) => (
              <div key={a.bucket} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm">
                <span className="font-medium">{BUCKET_LABEL[a.bucket]}</span>
                <div className="h-3 rounded-full bg-black/5">
                  <div className={`h-3 rounded-full ${BUCKET_COLOR[a.bucket]}`} style={{ width: `${(a.adeudo / maxAdeudoBucket) * 100}%` }} />
                </div>
                <span className="text-right tabular-nums text-finbra-gray">
                  <strong className="text-black">{a.creditos}</strong> · {formatMoney(a.adeudo)}
                  {a.vencido > 0 && <span className="block text-xs">vencido {formatMoney(a.vencido)}</span>}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <p className="mb-4 text-sm font-medium text-finbra-gray">Adeudo en atraso (PAR)</p>
          <dl className="space-y-3 text-sm">
            {[
              ["Más de 30 días", r.par30],
              ["Más de 60 días", r.par60],
              ["Más de 90 días", r.par90],
            ].map(([label, v]) => (
              <div key={label as string} className="flex items-baseline justify-between gap-3">
                <dt>{label}</dt>
                <dd className="text-xl font-bold tabular-nums text-finbra-purple">{formatRatio(v as number | null)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-finbra-gray">Porción del adeudo total en créditos con ese atraso, según los días de atraso de SIAC.</p>
          <Link href="/backoffice/cobranza/cola" className="mt-4 block rounded-lg bg-finbra-purple/5 p-3 text-sm hover:bg-finbra-purple/10">
            <strong>{data.alertasAbiertas}</strong> alerta{data.alertasAbiertas === 1 ? "" : "s"} abierta{data.alertasAbiertas === 1 ? "" : "s"}
            {data.alertasCriticas > 0 && <span className="text-red-700"> · {data.alertasCriticas} crítica{data.alertasCriticas === 1 ? "" : "s"}</span>}
          </Link>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pt-5">
            <p className="text-sm font-medium text-finbra-gray">Próximos vencimientos</p>
            <p className="text-xs text-finbra-gray">
              7 días: <strong className="text-black">{r.proximos.en7}</strong> · 15 días: <strong className="text-black">{r.proximos.en15}</strong> ·
              30 días: <strong className="text-black">{r.proximos.en30}</strong>
            </p>
          </div>
          {r.proximos.lista.length === 0 ? (
            <p className="px-6 py-5 text-sm text-finbra-gray">Sin vencimientos en los próximos 30 días.</p>
          ) : (
            <table className="mt-3 w-full min-w-[420px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th className="px-6 py-2">Fecha</th>
                  <th className="px-6 py-2">Cliente</th>
                  <th className="px-6 py-2">Crédito</th>
                </tr>
              </thead>
              <tbody>
                {r.proximos.lista.slice(0, 12).map((p) => (
                  <tr key={p.creditId} className="border-b border-black/5 last:border-0">
                    <td className="whitespace-nowrap px-6 py-2">
                      {formatFecha(p.fecha)} <span className="text-xs text-finbra-gray">({p.enDias === 0 ? "hoy" : `en ${p.enDias} d`})</span>
                    </td>
                    <td className="px-6 py-2">
                      <Link href={`/backoffice/cobranza/clientes/${p.clientId}`} className="hover:text-finbra-purple hover:underline">{p.cliente}</Link>
                    </td>
                    <td className="px-6 py-2 font-mono text-xs">{p.noCredito}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="px-6 pb-4 pt-2 text-xs text-finbra-gray">El monto de cada mensualidad llegará con el Listado Cobranza Personalizado de SIAC.</p>
        </Card>

        <Card className="overflow-x-auto p-0">
          <p className="px-6 pt-5 text-sm font-medium text-finbra-gray">Mayor exposición por cliente</p>
          <table className="mt-3 w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th className="px-6 py-2">Cliente</th>
                <th className="px-6 py-2 text-right">Adeudo</th>
                <th className="px-6 py-2 text-right">Vencido</th>
                <th className="px-6 py-2 text-right">Atraso</th>
              </tr>
            </thead>
            <tbody>
              {r.top.map((t) => (
                <tr key={t.clientId} className="border-b border-black/5 last:border-0">
                  <td className="px-6 py-2">
                    <Link href={`/backoffice/cobranza/clientes/${t.clientId}`} className="hover:text-finbra-purple hover:underline">{t.cliente}</Link>
                    {t.creditos > 1 && <span className="ml-1 text-xs text-finbra-gray">({t.creditos} créditos)</span>}
                  </td>
                  <td className="px-6 py-2 text-right tabular-nums">{formatMoney(t.adeudo)}</td>
                  <td className={`px-6 py-2 text-right tabular-nums ${t.vencido >= umbral ? "font-semibold text-red-700" : ""}`}>{formatMoney(t.vencido)}</td>
                  <td className="px-6 py-2 text-right tabular-nums">{t.maxAntiguedad ? `${t.maxAntiguedad} d` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-6 pb-4 pt-2 text-xs text-finbra-gray">
            "Adeudo" es el TotalAdeudo de SIAC; está pendiente que confirmen su diferencia con TotalGlobal.
          </p>
        </Card>
      </div>
    </div>
  );
}
