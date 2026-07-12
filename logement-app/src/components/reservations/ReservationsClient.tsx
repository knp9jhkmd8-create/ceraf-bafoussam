"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatutBadge } from "@/components/StatutBadge";
import { formatMontant, formatDate } from "@/lib/utils";

type Logement = { id: string; numero: string; prixParNuit: number; residence: { nom: string } };
type Paiement = { id: string; montant: number; moyen: string; statut: string; reference: string };
type Reservation = {
  id: string;
  clientNom: string;
  clientTelephone: string;
  dateDebut: string;
  dateFin: string;
  montantTotal: number;
  statut: string;
  logement: Logement;
  paiements: Paiement[];
};

const MOYENS = [
  { value: "ORANGE_MONEY", label: "Orange Money" },
  { value: "MOBILE_MONEY", label: "Mobile Money" },
  { value: "CARTE_BANCAIRE", label: "Carte bancaire" },
];

export function ReservationsClient({ reservations, logements }: { reservations: Reservation[]; logements: Logement[] }) {
  const router = useRouter();
  const [ouvrirForm, setOuvrirForm] = useState(false);
  const [paiementPour, setPaiementPour] = useState<string | null>(null);
  const [moyen, setMoyen] = useState("ORANGE_MONEY");
  const [coordonnees, setCoordonnees] = useState("");
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");
  const [resultatPaiement, setResultatPaiement] = useState<Record<string, string>>({});

  async function creerReservation(formData: FormData) {
    setChargement(true);
    setErreur("");
    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logementId: formData.get("logementId"),
        clientNom: formData.get("clientNom"),
        clientTelephone: formData.get("clientTelephone"),
        clientEmail: formData.get("clientEmail"),
        dateDebut: formData.get("dateDebut"),
        dateFin: formData.get("dateFin"),
        montantTotal: formData.get("montantTotal"),
      }),
    });
    setChargement(false);
    if (!res.ok) {
      setErreur("Impossible de creer la reservation.");
      return;
    }
    setOuvrirForm(false);
    router.refresh();
  }

  async function payer(reservationId: string) {
    setChargement(true);
    const res = await fetch(`/api/reservations/${reservationId}/paiement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moyen, telephoneOuCarte: coordonnees }),
    });
    const data = await res.json();
    setChargement(false);
    setResultatPaiement((prev) => ({ ...prev, [reservationId]: data.resultat?.message ?? "Erreur." }));
    if (data.resultat?.succes) {
      setPaiementPour(null);
      setCoordonnees("");
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="card">
        {!ouvrirForm ? (
          <button className="btn-primary" onClick={() => setOuvrirForm(true)}>
            + Nouvelle reservation
          </button>
        ) : (
          <form action={(fd) => creerReservation(fd)} className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="label">Logement</label>
              <select name="logementId" required className="input">
                <option value="">Choisir...</option>
                {logements.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.residence.nom} — {l.numero} ({formatMontant(l.prixParNuit)}/nuit)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Nom du client</label>
              <input name="clientNom" required className="input" />
            </div>
            <div>
              <label className="label">Telephone du client</label>
              <input name="clientTelephone" required className="input" />
            </div>
            <div>
              <label className="label">Email (optionnel)</label>
              <input name="clientEmail" type="email" className="input" />
            </div>
            <div>
              <label className="label">Date debut</label>
              <input name="dateDebut" type="date" required className="input" />
            </div>
            <div>
              <label className="label">Date fin</label>
              <input name="dateFin" type="date" required className="input" />
            </div>
            <div>
              <label className="label">Montant total (FCFA)</label>
              <input name="montantTotal" type="number" min={0} required className="input" />
            </div>
            <div className="md:col-span-3 flex gap-2">
              <button type="submit" disabled={chargement} className="btn-primary">
                {chargement ? "Creation..." : "Creer la reservation"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setOuvrirForm(false)}>
                Annuler
              </button>
            </div>
          </form>
        )}
        {erreur && <p className="text-sm text-red-600 mt-2">{erreur}</p>}
      </div>

      <div className="space-y-4">
        {reservations.length === 0 && <p className="text-sm text-slate-500">Aucune reservation.</p>}
        {reservations.map((r) => {
          const dejaPayee = r.paiements.some((p) => p.statut === "PAYE");
          return (
            <div key={r.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{r.clientNom} <span className="text-slate-400 font-normal">— {r.clientTelephone}</span></p>
                  <p className="text-sm text-slate-500">
                    {r.logement.residence.nom} — {r.logement.numero} · {formatDate(r.dateDebut)} au {formatDate(r.dateFin)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-900">{formatMontant(r.montantTotal)}</p>
                  <StatutBadge statut={r.statut} />
                </div>
              </div>

              {r.paiements.length > 0 && (
                <div className="mt-3 space-y-1 text-xs text-slate-500">
                  {r.paiements.map((p) => (
                    <p key={p.id}>
                      {MOYENS.find((m) => m.value === p.moyen)?.label ?? p.moyen} · ref {p.reference} · <StatutBadge statut={p.statut} />
                    </p>
                  ))}
                </div>
              )}

              {!dejaPayee && (
                <div className="mt-3">
                  {paiementPour !== r.id ? (
                    <button className="btn-primary text-xs" onClick={() => setPaiementPour(r.id)}>
                      Encaisser le paiement
                    </button>
                  ) : (
                    <div className="bg-slate-50 rounded-lg p-3 space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {MOYENS.map((m) => (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => setMoyen(m.value)}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                              moyen === m.value ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600"
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      <div>
                        <label className="label">
                          {moyen === "CARTE_BANCAIRE" ? "Numero de carte" : "Numero de telephone"}
                        </label>
                        <input
                          className="input"
                          value={coordonnees}
                          onChange={(e) => setCoordonnees(e.target.value)}
                          placeholder={moyen === "CARTE_BANCAIRE" ? "4242 4242 4242 4242" : "+221 77 000 00 00"}
                        />
                        <p className="text-xs text-slate-400 mt-1">
                          Paiement chiffre de bout en bout (simulation en environnement de demonstration).
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button disabled={chargement} className="btn-primary text-xs" onClick={() => payer(r.id)}>
                          {chargement ? "Traitement..." : `Payer ${formatMontant(r.montantTotal)}`}
                        </button>
                        <button className="btn-secondary text-xs" onClick={() => setPaiementPour(null)}>
                          Annuler
                        </button>
                      </div>
                      {resultatPaiement[r.id] && (
                        <p className="text-xs text-slate-600">{resultatPaiement[r.id]}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
