"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatutBadge } from "@/components/StatutBadge";
import { formatMontant } from "@/lib/utils";

type Logement = {
  id: string;
  numero: string;
  type: string;
  capacite: number;
  prixParNuit: number;
  prixParMois: number;
  statut: string;
};

type Residence = {
  id: string;
  nom: string;
  adresse: string;
  ville: string | null;
  logements: Logement[];
};

const STATUTS = ["DISPONIBLE", "OCCUPE", "RESERVE", "MAINTENANCE"];

export function ResidencesClient({ residences, peutGerer }: { residences: Residence[]; peutGerer: boolean }) {
  const router = useRouter();
  const [ouvrirForm, setOuvrirForm] = useState(false);
  const [nouvLogementPour, setNouvLogementPour] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  async function creerResidence(formData: FormData) {
    setChargement(true);
    setErreur("");
    const res = await fetch("/api/residences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nom: formData.get("nom"),
        adresse: formData.get("adresse"),
        ville: formData.get("ville"),
        description: formData.get("description"),
      }),
    });
    setChargement(false);
    if (!res.ok) {
      setErreur("Impossible de creer la residence.");
      return;
    }
    setOuvrirForm(false);
    router.refresh();
  }

  async function creerLogement(residenceId: string, formData: FormData) {
    setChargement(true);
    setErreur("");
    const res = await fetch("/api/logements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        residenceId,
        numero: formData.get("numero"),
        type: formData.get("type"),
        capacite: formData.get("capacite"),
        prixParNuit: formData.get("prixParNuit"),
        prixParMois: formData.get("prixParMois"),
      }),
    });
    setChargement(false);
    if (!res.ok) {
      setErreur("Impossible d'ajouter le logement.");
      return;
    }
    setNouvLogementPour(null);
    router.refresh();
  }

  async function changerStatut(logementId: string, statut: string) {
    await fetch(`/api/logements/${logementId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statut }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {peutGerer && (
        <div className="card">
          {!ouvrirForm ? (
            <button className="btn-primary" onClick={() => setOuvrirForm(true)}>
              + Nouvelle residence
            </button>
          ) : (
            <form
              action={(fd) => creerResidence(fd)}
              className="grid md:grid-cols-2 gap-3"
            >
              <div>
                <label className="label">Nom de la residence</label>
                <input name="nom" required className="input" placeholder="Residence Les Palmiers" />
              </div>
              <div>
                <label className="label">Ville</label>
                <input name="ville" className="input" placeholder="Dakar" />
              </div>
              <div className="md:col-span-2">
                <label className="label">Adresse</label>
                <input name="adresse" required className="input" placeholder="Rue 12, Almadies" />
              </div>
              <div className="md:col-span-2">
                <label className="label">Description</label>
                <textarea name="description" className="input" rows={2} />
              </div>
              <div className="md:col-span-2 flex gap-2">
                <button type="submit" disabled={chargement} className="btn-primary">
                  {chargement ? "Creation..." : "Creer"}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setOuvrirForm(false)}>
                  Annuler
                </button>
              </div>
            </form>
          )}
          {erreur && <p className="text-sm text-red-600 mt-2">{erreur}</p>}
        </div>
      )}

      {residences.length === 0 && (
        <p className="text-sm text-slate-500">Aucune residence pour le moment.</p>
      )}

      {residences.map((r) => (
        <div key={r.id} className="card">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="font-medium text-slate-900">{r.nom}</p>
              <p className="text-sm text-slate-500">{r.adresse}{r.ville ? `, ${r.ville}` : ""}</p>
            </div>
            {peutGerer && (
              <button className="btn-secondary text-xs" onClick={() => setNouvLogementPour(nouvLogementPour === r.id ? null : r.id)}>
                + Logement
              </button>
            )}
          </div>

          {nouvLogementPour === r.id && (
            <form action={(fd) => creerLogement(r.id, fd)} className="grid md:grid-cols-3 gap-3 mb-4 bg-slate-50 rounded-lg p-3">
              <div>
                <label className="label">Numero</label>
                <input name="numero" required className="input" placeholder="A1" />
              </div>
              <div>
                <label className="label">Type</label>
                <input name="type" required className="input" placeholder="Studio" />
              </div>
              <div>
                <label className="label">Capacite</label>
                <input name="capacite" type="number" min={1} defaultValue={1} className="input" />
              </div>
              <div>
                <label className="label">Prix / nuit (FCFA)</label>
                <input name="prixParNuit" type="number" min={0} className="input" />
              </div>
              <div>
                <label className="label">Prix / mois (FCFA)</label>
                <input name="prixParMois" type="number" min={0} className="input" />
              </div>
              <div className="flex items-end gap-2">
                <button type="submit" disabled={chargement} className="btn-primary">
                  Ajouter
                </button>
              </div>
            </form>
          )}

          {r.logements.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun logement enregistre.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100">
                    <th className="py-2 pr-4">Numero</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Capacite</th>
                    <th className="py-2 pr-4">Prix/nuit</th>
                    <th className="py-2 pr-4">Prix/mois</th>
                    <th className="py-2 pr-4">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {r.logements.map((l) => (
                    <tr key={l.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2 pr-4 font-medium">{l.numero}</td>
                      <td className="py-2 pr-4">{l.type}</td>
                      <td className="py-2 pr-4">{l.capacite}</td>
                      <td className="py-2 pr-4">{formatMontant(l.prixParNuit)}</td>
                      <td className="py-2 pr-4">{formatMontant(l.prixParMois)}</td>
                      <td className="py-2 pr-4">
                        {peutGerer ? (
                          <select
                            className="input py-1 text-xs w-auto"
                            value={l.statut}
                            onChange={(e) => changerStatut(l.id, e.target.value)}
                          >
                            {STATUTS.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <StatutBadge statut={l.statut} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
