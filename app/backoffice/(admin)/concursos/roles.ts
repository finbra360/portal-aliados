import type { AdminRole } from "@/lib/db/admin-users";

/** Quién crea, activa, excluye brokers y finaliza concursos. Verlos pueden todos. */
export const CONCURSOS_EDITAN: AdminRole[] = ["super_admin", "comercial"];
