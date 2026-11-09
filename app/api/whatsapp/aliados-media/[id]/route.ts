import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { ChatAliadosError, archivoAliado } from "@/lib/db/aliados-chat";
import { codigoDeError } from "@/lib/collections/errors";
import { BROKERS_EDITAN } from "@/app/backoffice/(admin)/brokers/roles";

export const dynamic = "force-dynamic";

/** Foto o documento que mandó un aliado por WhatsApp. Se descarga de Meta en el momento: no se guarda copia. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasRole(await getAdminSession(), BROKERS_EDITAN)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ error: "Archivo no válido" }, { status: 400 });
  try {
    const a = await archivoAliado(id);
    const nombre = (a.nombre ?? `whatsapp-aliado-${id}`).replace(/[^\w.\- ]/g, "_");
    return new NextResponse(a.datos, {
      headers: {
        "Content-Type": a.mime,
        "Content-Disposition": `inline; filename="${nombre}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ChatAliadosError) return NextResponse.json({ error: e.message }, { status: 404 });
    const c = codigoDeError("archivo whatsapp aliados", e);
    return NextResponse.json({ error: `No se pudo obtener el archivo (código ${c})` }, { status: 502 });
  }
}
