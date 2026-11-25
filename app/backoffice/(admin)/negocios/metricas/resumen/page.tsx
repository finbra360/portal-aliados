import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { formatFecha } from "@/lib/format";
import { getResumenSemanal, slackOnboardingConfigurado } from "@/lib/db/resumen-semanal";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import MandarResumen from "./MandarResumen";

/** Un renglón del mensaje como se ve en Slack: *negritas* y <url|ligas>. */
function RenglonSlack({ texto }: { texto: string }) {
  const partes = texto.split(/(\*[^*\n]+\*|<[^|>\n]+\|[^>\n]+>)/g);
  return (
    <>
      {partes.map((p, i) => {
        if (/^\*[^*]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>;
        const liga = p.match(/^<([^|>]+)\|([^>]+)>$/);
        if (liga) return <a key={i} href={liga[1]} className="text-finbra-purple underline">{liga[2]}</a>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

/** Vista previa del resumen semanal de originación que sale los lunes a Slack. */
export default async function ResumenSemanalPage() {
  const session = await getAdminSession();
  if (!puede(session, "originacion.ver")) {
    return <EmptyState title="No tienes acceso a Negocios" description="Tu rol no puede ver la originación." />;
  }
  let r: Awaited<ReturnType<typeof getResumenSemanal>>;
  try {
    r = await getResumenSemanal();
  } catch (e) {
    const c = codigoDeError("originación: resumen semanal", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos armar el resumen. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  const configurado = slackOnboardingConfigurado();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/backoffice/negocios/metricas" className="text-sm text-finbra-purple hover:underline">← Métricas</Link>
        <h1 className="mt-1 text-2xl font-bold">Resumen semanal en Slack</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Cada lunes a las 9:00 sale al canal de onboarding de Slack con lo de la semana anterior (lunes a domingo): lo que entró, avanzó, se dispersó o se
          cerró, cómo está el embudo y qué hay que atender. Así se ve el de la semana del {formatFecha(r.semana.desde)} al {formatFecha(r.semana.hasta)}.
        </p>
      </div>
      {!configurado && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Todavía no sale: falta <span className="font-mono">SLACK_ONBOARDING_WEBHOOK_URL</span> en Vercel (un «Incoming Webhook» de Slack apuntando al canal de
          onboarding).
        </p>
      )}
      <Card>
        <div className="space-y-0.5 text-sm leading-relaxed">
          {r.texto.split("\n").map((linea, i) =>
            linea.trim() === "" ? <div key={i} className="h-3" aria-hidden="true" /> : (
              <p key={i} className="whitespace-pre-wrap break-words">
                <RenglonSlack texto={linea} />
              </p>
            ),
          )}
        </div>
      </Card>
      {configurado && puede(session, "clientes.configurar") && <MandarResumen />}
    </div>
  );
}
