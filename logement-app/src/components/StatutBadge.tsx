const STYLES: Record<string, string> = {
  DISPONIBLE: "bg-green-100 text-green-700",
  OCCUPE: "bg-blue-100 text-blue-700",
  RESERVE: "bg-amber-100 text-amber-700",
  MAINTENANCE: "bg-slate-200 text-slate-600",
  EN_ATTENTE: "bg-amber-100 text-amber-700",
  CONFIRMEE: "bg-green-100 text-green-700",
  ANNULEE: "bg-red-100 text-red-700",
  TERMINEE: "bg-slate-200 text-slate-600",
  PAYE: "bg-green-100 text-green-700",
  ECHOUE: "bg-red-100 text-red-700",
  REMBOURSE: "bg-slate-200 text-slate-600",
};

const LABELS: Record<string, string> = {
  DISPONIBLE: "Disponible",
  OCCUPE: "Occupe",
  RESERVE: "Reserve",
  MAINTENANCE: "Maintenance",
  EN_ATTENTE: "En attente",
  CONFIRMEE: "Confirmee",
  ANNULEE: "Annulee",
  TERMINEE: "Terminee",
  PAYE: "Paye",
  ECHOUE: "Echoue",
  REMBOURSE: "Rembourse",
};

export function StatutBadge({ statut }: { statut: string }) {
  return (
    <span className={`badge ${STYLES[statut] ?? "bg-slate-100 text-slate-600"}`}>
      {LABELS[statut] ?? statut}
    </span>
  );
}
