import type { AdminRole } from "../db/admin-users.ts";

/**
 * Permisos del área Credit Health en el backoffice (decididos por Santiago, 2026-10-19):
 * super_admin todo; comercial opera; finanzas solo consulta, sin datos de contacto.
 */
export const CH_VEN: AdminRole[] = ["super_admin", "comercial", "finanzas"];
export const CH_OPERAN: AdminRole[] = ["super_admin", "comercial"];
export const CH_VEN_CONTACTO: AdminRole[] = ["super_admin", "comercial"];
export const CH_EXPORTAN: AdminRole[] = ["super_admin", "comercial"];
export const CH_BORRAN: AdminRole[] = ["super_admin"];
export const CH_EDITAN_POLITICAS: AdminRole[] = ["super_admin"];
