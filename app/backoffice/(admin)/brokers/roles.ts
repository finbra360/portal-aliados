import type { AdminRole } from "@/lib/db/admin-users";

/** Quién da de alta, edita, importa y suspende brokers. Verlos pueden todos. */
export const BROKERS_EDITAN: AdminRole[] = ["super_admin", "comercial"];
