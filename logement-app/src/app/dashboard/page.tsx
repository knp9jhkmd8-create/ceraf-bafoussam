import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/prisma";
import { formatMontant } from "@/lib/utils";
import { StatutBadge } from "@/components/StatutBadge";
import { peut } from "@/lib/roles";
import { getSession } from "@/lib/session";

export default async function DashboardPage() {
  const session = await getSession();
  const role = session?.user.role;

  const [totalLogements, disponibles, occupes, reserves, maintenance, reservationsRecentes, paiementsMois] = await Promise.all([
    prisma.logement.count(),
    prisma.logement.count({ where: { statut: "DISPONIBLE" } }),
    prisma.logement.count({ where: { statut: "OCCUPE" } }),
    prisma.logement.count({ where: { statut: "RESERVE" } }),
    prisma.logement.count({ where: { statut: "MAINTENANCE" } }),
    prisma.reservation.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { logement: { include: { residence: true } } },
    }),
    peut(role, "voirFinances")
      ? prisma.paiement.aggregate({
          _sum: { montant: true },
          where: {
            statut: "PAYE",
            createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
          },
        })
      : Promise.resolve(null),
  ]);

  const tauxOccupation = totalLogements > 0 ? Math.round(((occupes + reserves) / totalLogements) * 100) : 0;

  const stats = [
    { label: "Logements", valeur: totalLogements, couleur: "text-slate-900" },
    { label: "Disponibles", valeur: disponibles, couleur: "text-green-600" },
    { label: "Occupes", valeur: occupes, couleur: "text-blue-600" },
    { label: "Reserves", valeur: reserves, couleur: "text-amber-600" },
    { label: "En maintenance", valeur: maintenance, couleur: "text-slate-500" },
  ];

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Tableau de bord</h1>
      <p className="text-sm text-slate-500 mb-6">Vue d&apos;ensemble de la residence.</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`text-2xl font-semibold mt-1 ${s.couleur}`}>{s.valeur}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="card">
          <p className="text-xs text-slate-500">Taux d&apos;occupation</p>
          <p className="text-2xl font-semibold mt-1 text-brand-700">{tauxOccupation}%</p>
          <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-brand-600" style={{ width: `${tauxOccupation}%` }} />
          </div>
        </div>
        {paiementsMois && (
          <div className="card md:col-span-2">
            <p className="text-xs text-slate-500">Revenus encaisses ce mois-ci</p>
            <p className="text-2xl font-semibold mt-1 text-green-700">
              {formatMontant(paiementsMois._sum.montant ?? 0)}
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <p className="text-sm font-medium text-slate-800 mb-3">Reservations recentes</p>
        {reservationsRecentes.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune reservation pour le moment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-4">Client</th>
                  <th className="py-2 pr-4">Logement</th>
                  <th className="py-2 pr-4">Montant</th>
                  <th className="py-2 pr-4">Statut</th>
                </tr>
              </thead>
              <tbody>
                {reservationsRecentes.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pr-4">{r.clientNom}</td>
                    <td className="py-2 pr-4">{r.logement.residence.nom} — {r.logement.numero}</td>
                    <td className="py-2 pr-4">{formatMontant(r.montantTotal)}</td>
                    <td className="py-2 pr-4"><StatutBadge statut={r.statut} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
