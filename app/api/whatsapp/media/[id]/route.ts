import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, hasRole } from "@/lib/rbac";
import { ChatError, archivoDeMensaje } from "@/lib/db/whatsapp-chat";
import { codigoDeError } from "@/lib/collections/errors";

export const dynamic = "force-dynamic";

/**
 * Foto o documento que mandó un cliente por WhatsApp (por ejemplo, un
 * comprobante de pago). Solo para el equipo de cobranza, y solo archivos que
 * están en un mensaje registrado. Se descarga de Meta en el momento: no se
 * guarda copia.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasRole(await getAdminSession(), COBRANZA_ROLES)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^\d{5,30}$/.test(id)) return NextResponse.json({ error: "Archivo no válido" }, { status: 400 });
  try {
    const a = await archivoDeMensaje(id);
    const nombre = (a.nombre ?? `whatsapp-${id}`).replace(/[^\w.\- ]/g, "_");
    return new NextResponse(a.datos, {
      headers: {
        "Content-Type": a.mime,
        "Content-Disposition": `inline; filename="${nombre}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ChatError) return NextResponse.json({ error: e.message }, { status: 404 });
    const c = codigoDeError("archivo whatsapp", e);
    return NextResponse.json({ error: `No se pudo obtener el archivo (código ${c})` }, { status: 502 });
  }
}
