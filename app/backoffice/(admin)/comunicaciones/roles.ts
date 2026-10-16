import type { AdminRole } from "@/lib/db/admin-users";

/** Quién publica y retira anuncios para los brokers. Verlos pueden todos. */
export const COMUNICACIONES_EDITAN: AdminRole[] = ["super_admin", "comercial"];
