import Link from "next/link";
import {
  listLeadCompanies,
  countLeadsByCategoria,
  listPendingHitlReviews,
  LEAD_PAGE_SIZES,
  DEFAULT_LEAD_PAGE_SIZE,
  type LeadPageSize,
} from "@/lib/db/leads";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import { IconFlame, IconTarget, IconTrendingUp, IconListChecks } from "@/components/ui/icons";
import CategoriaPill from "./CategoriaPill";
import EstatusSelect from "./EstatusSelect";
import { updateLeadEstatusAction, resolveHitlReviewAction } from "./actions";

const TABS: { value: string | undefined; label: string }[] = [
  { value: undefined, label: "Todos" },
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "qualified", label: "Qualified" },
  { value: "contacto_directo", label: "Contacto directo" },
  { value: "discarded", label: "Discarded" },
];

function formatTelefono(raw: string | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("52")) {
    const local = digits.slice(2);
    return `+52 ${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
  }
  return raw;
}

function buildHref(base: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string; page?: string; perPage?: string }>;
}) {
  const { categoria, page: pageParam, perPage: perPageParam } = await searchParams;

  const page = Math.max(1, Number(pageParam) || 1);
  const perPage = (LEAD_PAGE_SIZES.includes(Number(perPageParam) as LeadPageSize)
    ? Number(perPageParam)
    : DEFAULT_LEAD_PAGE_SIZE) as LeadPageSize;

  let leadsPage: Awaited<ReturnType<typeof listLeadCompanies>> = { items: [], total: 0 };
  let counts: Awaited<ReturnType<typeof countLeadsByCategoria>> = { hot: 0, warm: 0, qualified: 0, discarded: 0, sin_calificar: 0 };
  let hitlReviews: Awaited<ReturnType<typeof listPendingHitlReviews>> = [];
  let loadError = false;

  try {
    [leadsPage, counts, hitlReviews] = await Promise.all([
      listLeadCompanies({ categoria }, { page, perPage }),
      countLeadsByCategoria(),
      listPendingHitlReviews(),
    ]);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar los leads en este momento.
      </div>
    );
  }

  const { items: leads, total } = leadsPage;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(total, page * perPage);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Leads</h1>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Hot" value={String(counts.hot)} icon={<IconFlame />} />
        <StatCard label="Warm" value={String(counts.warm)} icon={<IconTrendingUp />} />
        <StatCard label="Qualified" value={String(counts.qualified)} icon={<IconTarget />} />
        <StatCard
          label="Contacto directo"
          value={String(counts.contacto_directo)}
          sublabel="sin sitio web: llamar o mandar correo"
        />
        <StatCard label="Discarded" value={String(counts.discarded)} icon={<IconListChecks />} />
        <StatCard label="Sin calificar todavía" value={String(counts.sin_calificar)} sublabel="en proceso en el pipeline" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {TABS.map((tab) => {
            const href = buildHref("/backoffice/leads", { categoria: tab.value, perPage });
            const active = categoria === tab.value;
            return (
              <Link
                key={tab.label}
                href={href}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                  active ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-1 text-xs text-finbra-gray">
          <span>Por página:</span>
          {LEAD_PAGE_SIZES.map((size) => (
            <Link
              key={size}
              href={buildHref("/backoffice/leads", { categoria, perPage: size })}
              className={`rounded-lg px-2 py-1 font-semibold ${
                perPage === size ? "bg-finbra-purple/10 text-finbra-purple" : "hover:bg-black/5"
              }`}
            >
              {size}
            </Link>
          ))}
        </div>
      </div>

      {leads.length === 0 ? (
        <EmptyState
          icon={<IconTarget />}
          title="Sin leads en esta categoría"
          description="El pipeline sigue corriendo solo cada 10-15 minutos -- vuelve en un rato."
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[1100px] table-fixed text-left text-sm">
            <colgroup>
              {/* Contacto se lleva el ancho que sobra de Ubicación: los correos
                  corporativos son largos y truncados no sirven de nada. Empresa y
                  Antigüedad se mantienen porque el nombre es el identificador y
                  "9.9 años" no debe partirse en dos líneas. */}
              <col className="w-[22%]" />
              <col className="w-[19%]" />
              <col className="w-[10%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Contacto</th>
                <th className="px-4 py-3">Ubicación</th>
                <th className="px-4 py-3">Empleados</th>
                <th className="px-4 py-3">Antigüedad</th>
                <th className="px-4 py-3">Garantía</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Categoría</th>
                <th className="px-4 py-3">Estatus</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const garantiaLabel = lead.tieneGarantiaVehicular
                  ? "Vehicular"
                  : lead.tieneGarantiaInmobiliaria
                    ? "Inmobiliaria"
                    : null;
                return (
                  <tr key={lead.id} className="border-b border-black/5 last:border-0 align-top">
                    <td className="px-4 py-3">
                      <p className="truncate font-semibold" title={lead.nombreComercial}>
                        {lead.nombreComercial}
                      </p>
                      {lead.websiteUrl && (
                        <a
                          href={lead.websiteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-xs text-finbra-purple hover:underline"
                        >
                          {lead.domain}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {lead.correoCorporativo || lead.telefonoPrincipal ? (
                        <div className="space-y-0.5">
                          {lead.correoCorporativo && (
                            <a
                              href={`mailto:${lead.correoCorporativo}`}
                              className="block truncate text-finbra-purple hover:underline"
                              title={lead.correoCorporativo}
                            >
                              {lead.correoCorporativo}
                            </a>
                          )}
                          {lead.telefonoPrincipal && (
                            <a href={`tel:${lead.telefonoPrincipal}`} className="block hover:underline">
                              {formatTelefono(lead.telefonoPrincipal)}
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-finbra-gray">Pendiente</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-finbra-gray">
                      {[lead.municipio, lead.estado].filter(Boolean).join(", ") || "Pendiente"}
                    </td>
                    <td className="px-4 py-3 text-xs">{lead.empleadosEstimado ?? "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      {lead.antiguedadAniosEstimado != null ? `${lead.antiguedadAniosEstimado} años` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {garantiaLabel ? (
                        <span
                          className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                          title={
                            lead.garantiaVerificado
                              ? "Confirmada"
                              : `Sin verificar por humano (confidence ${lead.garantiaConfidence ?? "—"})`
                          }
                        >
                          {garantiaLabel}
                          {!lead.garantiaVerificado && " *"}
                        </span>
                      ) : (
                        <span className="text-xs text-finbra-gray">Pendiente</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lead.totalScore != null ? (
                        <span
                          className="cursor-help"
                          title={
                            (lead.scoreExplicacion ?? "") +
                            `\n\nFit ${lead.fitScore ?? 0} · Intent ${lead.intentScore ?? 0} · Data Quality ${lead.dataQualityScore ?? 0}`
                          }
                        >
                          <span className="font-bold text-finbra-purple">{lead.totalScore}</span>
                          <span className="text-finbra-gray">/100</span>
                        </span>
                      ) : (
                        <span className="text-finbra-gray">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <CategoriaPill categoria={lead.categoria} />
                      {lead.categoria === "discarded" && lead.discardReason && (
                        <p className="mt-1 truncate text-[11px] text-finbra-gray" title={lead.discardReason}>
                          {lead.discardReason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <EstatusSelect id={lead.id} current={lead.estatusComercial} action={updateLeadEstatusAction} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-finbra-gray">
            Mostrando <span className="font-semibold text-black">{rangeStart}-{rangeEnd}</span> de{" "}
            <span className="font-semibold text-black">{total}</span>
          </p>
          <div className="flex items-center gap-2">
            <Link
              href={buildHref("/backoffice/leads", { categoria, perPage, page: Math.max(1, page - 1) })}
              aria-disabled={page <= 1}
              className={`rounded-lg border border-black/10 px-3 py-1.5 font-medium ${
                page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-black/5"
              }`}
            >
              Anterior
            </Link>
            <span className="text-xs text-finbra-gray">
              Página {page} de {totalPages}
            </span>
            <Link
              href={buildHref("/backoffice/leads", { categoria, perPage, page: Math.min(totalPages, page + 1) })}
              aria-disabled={page >= totalPages}
              className={`rounded-lg border border-black/10 px-3 py-1.5 font-medium ${
                page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-black/5"
              }`}
            >
              Siguiente
            </Link>
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-lg font-bold">Revisión pendiente (HITL)</h2>
        {hitlReviews.length === 0 ? (
          <EmptyState title="Sin revisiones pendientes" description="Todo lo ambiguo del pipeline ya fue resuelto." />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th className="px-6 py-3">Empresa</th>
                  <th className="px-6 py-3">Motivo</th>
                  <th className="px-6 py-3">Resolución</th>
                </tr>
              </thead>
              <tbody>
                {hitlReviews.map((item) => (
                  <tr key={item.id} className="border-b border-black/5 last:border-0 align-top">
                    <td className="px-6 py-4">
                      <p className="font-semibold">{item.companyNombre}</p>
                      <CategoriaPill categoria={item.companyCategoria} />
                    </td>
                    <td className="px-6 py-4 max-w-xs text-xs text-finbra-gray">{item.reason}</td>
                    <td className="px-6 py-4">
                      <form action={resolveHitlReviewAction} className="flex gap-2">
                        <input type="hidden" name="id" value={item.id} />
                        <input
                          name="resolutionNotes"
                          required
                          placeholder="Nota de resolución…"
                          className="rounded-lg border border-black/10 px-2 py-1 text-xs"
                        />
                        <button type="submit" className="rounded-lg bg-finbra-purple px-3 py-1 text-xs font-bold text-white">
                          Resolver
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
