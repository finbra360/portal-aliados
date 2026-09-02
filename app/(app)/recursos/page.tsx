import { getRecursos, type Recurso } from "@/lib/n8n";
import { listResources } from "@/lib/db/resources";
import {
  PRODUCTO,
  PERFIL_CLIENTE_IDEAL,
  SECTORES_OBJETIVO,
  PROCESO_PASOS,
  CHECKLIST_EXPEDIENTE,
  OBJECIONES,
  FAQ,
  GLOSARIO,
} from "@/lib/resources-content";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import CreditSimulator from "./CreditSimulator";

function DraftSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">{title}</p>
        <Badge variant="draft">Borrador — pendiente de validar</Badge>
      </div>
      {children}
    </Card>
  );
}

export default async function RecursosPage() {
  let recursos: Recurso[] = [];
  let loadError = false;

  try {
    const data = await getRecursos();
    recursos = data.recursos;
  } catch {
    loadError = true;
  }

  let cmsResources: Awaited<ReturnType<typeof listResources>> = [];
  try {
    cmsResources = await listResources(true);
  } catch {
    // El CMS de recursos es un complemento — si falla, seguimos con lo que venga de n8n.
  }

  const porCategoria = recursos.reduce<Record<string, Recurso[]>>((acc, recurso) => {
    (acc[recurso.categoria] ??= []).push(recurso);
    return acc;
  }, {});
  const categorias = Object.keys(porCategoria);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Centro de Recursos</h1>
        <p className="text-sm text-finbra-gray">Herramientas y materiales para ayudarte a vender más con Finbra.</p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
          No pudimos cargar los materiales descargables en este momento.
        </div>
      ) : categorias.length ? (
        <div className="space-y-6">
          {categorias.map((categoria) => (
            <section key={categoria}>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-finbra-purple">{categoria}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {porCategoria[categoria].map((recurso) => (
                  <a
                    key={recurso.url}
                    href={recurso.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border border-finbra-purple/10 bg-white p-5 shadow-[0_2px_12px_rgba(93,91,219,0.12)] transition hover:shadow-[0_4px_24px_rgba(93,91,219,0.2)]"
                  >
                    <Badge>{recurso.tipo}</Badge>
                    <p className="mt-2 font-medium">{recurso.titulo}</p>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card>
          <p className="text-sm text-finbra-gray">
            Los materiales descargables (presentaciones, casos de uso, ficha de producto en PDF) están en preparación
            por el equipo de marketing. Mientras tanto, aquí tienes información clave para vender:
          </p>
        </Card>
      )}

      {cmsResources.length > 0 && (
        <div className="space-y-6">
          {Object.entries(
            cmsResources.reduce<Record<string, typeof cmsResources>>((acc, r) => {
              (acc[r.categoria] ??= []).push(r);
              return acc;
            }, {}),
          ).map(([categoria, items]) => (
            <section key={categoria}>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-finbra-purple">{categoria}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {items.map((item) =>
                  item.url ? (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl border border-finbra-purple/10 bg-white p-5 shadow-[0_2px_12px_rgba(93,91,219,0.12)] transition hover:shadow-[0_4px_24px_rgba(93,91,219,0.2)]"
                    >
                      <Badge>{item.tipo}</Badge>
                      <p className="mt-2 font-medium">{item.titulo}</p>
                    </a>
                  ) : (
                    <div key={item.id} className="rounded-xl border border-finbra-purple/10 bg-white p-5 shadow-[0_2px_12px_rgba(93,91,219,0.12)]">
                      <Badge>{item.tipo}</Badge>
                      <p className="mt-2 font-medium">{item.titulo}</p>
                      {item.contenido && <p className="mt-1 text-sm text-finbra-gray">{item.contenido}</p>}
                    </div>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      <DraftSection title="Ficha de producto">
        <p className="text-sm">
          <span className="font-semibold">{PRODUCTO.nombre}</span> · {PRODUCTO.tipoEmpresa} · {PRODUCTO.rango}
        </p>
        <p className="mt-2 text-sm text-finbra-gray">{PRODUCTO.descripcion}</p>
        <div className="mt-3 flex gap-2">
          {PRODUCTO.garantias.map((g) => (
            <Badge key={g} variant="gray">
              Garantía {g}
            </Badge>
          ))}
        </div>
      </DraftSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <DraftSection title="Perfil de cliente ideal">
          <p className="text-sm text-finbra-gray">{PERFIL_CLIENTE_IDEAL.descripcion}</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {PERFIL_CLIENTE_IDEAL.senales.map((s) => (
              <li key={s} className="flex gap-2">
                <span className="text-finbra-purple">•</span> {s}
              </li>
            ))}
          </ul>
        </DraftSection>

        <DraftSection title="Sectores objetivo">
          <div className="flex flex-wrap gap-2">
            {SECTORES_OBJETIVO.map((s) => (
              <Badge key={s} variant="gray">
                {s}
              </Badge>
            ))}
          </div>
        </DraftSection>
      </div>

      <DraftSection title="Proceso de crédito paso a paso">
        <ol className="grid gap-3 sm:grid-cols-3">
          {PROCESO_PASOS.map((paso, idx) => (
            <li key={paso.titulo} className="rounded-lg bg-finbra-purple/5 p-4">
              <p className="text-xs font-bold text-finbra-purple">Paso {idx + 1}</p>
              <p className="mt-1 text-sm font-semibold">{paso.titulo}</p>
              <p className="mt-1 text-xs text-finbra-gray">{paso.detalle}</p>
            </li>
          ))}
        </ol>
      </DraftSection>

      <DraftSection title="Checklist de expediente">
        <ul className="grid gap-2 sm:grid-cols-2">
          {CHECKLIST_EXPEDIENTE.map((item) => (
            <li key={item} className="flex gap-2 text-sm">
              <span className="text-finbra-purple">✓</span> {item}
            </li>
          ))}
        </ul>
      </DraftSection>

      <CreditSimulator />

      <DraftSection title="Objeciones frecuentes y cómo responderlas">
        <div className="space-y-3">
          {OBJECIONES.map((o) => (
            <div key={o.objecion} className="rounded-lg bg-finbra-purple/5 p-4 text-sm">
              <p className="font-semibold">{o.objecion}</p>
              <p className="mt-1 text-finbra-gray">{o.respuesta}</p>
            </div>
          ))}
        </div>
      </DraftSection>

      <DraftSection title="Preguntas frecuentes">
        <div className="space-y-3">
          {FAQ.map((f) => (
            <div key={f.pregunta} className="text-sm">
              <p className="font-semibold">{f.pregunta}</p>
              <p className="mt-1 text-finbra-gray">{f.respuesta}</p>
            </div>
          ))}
        </div>
      </DraftSection>

      <DraftSection title="Glosario financiero">
        <dl className="grid gap-3 sm:grid-cols-2">
          {GLOSARIO.map((g) => (
            <div key={g.termino}>
              <dt className="text-sm font-semibold text-finbra-purple">{g.termino}</dt>
              <dd className="text-sm text-finbra-gray">{g.definicion}</dd>
            </div>
          ))}
        </dl>
      </DraftSection>
    </div>
  );
}
