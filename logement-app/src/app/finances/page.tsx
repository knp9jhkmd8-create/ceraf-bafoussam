import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { peut } from "@/lib/roles";
import { redirect } from "next/navigation";
import { formatMontant, formatDate } from "@/lib/utils";
import { StatutBadge } from "@/components/StatutBadge";

const MOYEN_LABELS: Record<string, string> = {
  ORANGE_MONEY: "Orange Money",
  MOBILE_MONEY: "Mobile Money",
  CARTE_BANCAIRE: "Carte bancaire",
  ESPECES: "Especes",
};

export default async function FinancesPage() {
  const session = await getSession();
  if (!peut(session?.user.role, "voirFinances")) redirect("/dashboard");

  const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [paiements, totalMois, totalGlobal, parMoyen] = await Promise.all([
    prisma.paiement.findMany({
      include: { reservation: { include: { logement: { include: { residence: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.paiement.aggregate({ _sum: { montant: true }, where: { statut: "PAYE", createdAt: { gte: debutMois } } }),
    prisma.paiement.aggregate({ _sum: { montant: true }, where: { statut: "PAYE" } }),
    prisma.paiement.groupBy({ by: ["moyen"], _sum: { montant: true }, where: { statut: "PAYE" } }),
  ]);

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Suivi financier</h1>
      <p className="text-sm text-slate-500 mb-6">Revenus encaisses via les reservations.</p>

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="card">
          <p className="text-xs text-slate-500">Revenus ce mois-ci</p>
          <p className="text-2xl font-semibold mt-1 text-green-700">{formatMontant(totalMois._sum.montant ?? 0)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-500">Revenus totaux</p>
          <p className="text-2xl font-semibold mt-1 text-slate-900">{formatMontant(totalGlobal._sum.montant ?? 0)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-500 mb-2">Par moyen de paiement</p>
          <div className="space-y-1">
            {parMoyen.map((m) => (
              <div key={m.moyen} className="flex justify-between text-sm">
                <span>{MOYEN_LABELS[m.moyen] ?? m.moyen}</span>
                <span className="font-medium">{formatMontant(m._sum.montant ?? 0)}</span>
              </div>
            ))}
            {parMoyen.length === 0 && <p className="text-sm text-slate-400">Aucun paiement.</p>}
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <p className="text-sm font-medium text-slate-800 mb-3">Historique des paiements</p>
        {paiements.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun paiement enregistre.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Logement</th>
                <th className="py-2 pr-4">Client</th>
                <th className="py-2 pr-4">Moyen</th>
                <th className="py-2 pr-4">Reference</th>
                <th className="py-2 pr-4">Montant</th>
                <th className="py-2 pr-4">Statut</th>
              </tr>
            </thead>
            <tbody>
              {paiements.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-4">{formatDate(p.createdAt)}</td>
                  <td className="py-2 pr-4">{p.reservation.logement.residence.nom} — {p.reservation.logement.numero}</td>
                  <td className="py-2 pr-4">{p.reservation.clientNom}</td>
                  <td className="py-2 pr-4">{MOYEN_LABELS[p.moyen] ?? p.moyen}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{p.reference}</td>
                  <td className="py-2 pr-4">{formatMontant(p.montant)}</td>
                  <td className="py-2 pr-4"><StatutBadge statut={p.statut} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
