import { Role } from "@prisma/client";

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrateur",
  GESTIONNAIRE: "Gestionnaire",
  AGENT: "Agent",
  COMPTABLE: "Comptable",
};

// Definit qui peut voir/faire quoi dans l'app.
export const PERMISSIONS = {
  gererResidences: ["ADMIN", "GESTIONNAIRE"] as Role[],
  gererOccupants: ["ADMIN", "GESTIONNAIRE", "AGENT"] as Role[],
  gererReservations: ["ADMIN", "GESTIONNAIRE", "AGENT"] as Role[],
  voirFinances: ["ADMIN", "COMPTABLE"] as Role[],
  gererUtilisateurs: ["ADMIN"] as Role[],
};

export function peut(role: Role | undefined, permission: keyof typeof PERMISSIONS) {
  if (!role) return false;
  return PERMISSIONS[permission].includes(role);
}
