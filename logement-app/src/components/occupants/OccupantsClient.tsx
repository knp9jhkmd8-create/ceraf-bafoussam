"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";

type Logement = { id: string; numero: string; residence: { nom: string } };
type Occupant = {
  id: string;
  prenom: string;
  nom: string;
  telephone: string;
  email: string | null;
  actif: boolean;
  dateEntree: string | null;
  logement: (Logement & { statut?: string }) | null;
};

export function OccupantsClient({
  occupants,
  logementsDisponibles,
}: {
  occupants: Occupant[];
  logementsDisponibles: Logement[];
}) {
  const router = useRouter();
  const [ouvrirForm, setOuvrirForm] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  async function creerOccupant(formData: FormData) {
    setChargement(true);
    setErreur("");
    const logementId = formData.get("logementId");
    const res = await fetch("/api/occupants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prenom: formData.get("prenom"),
        nom: formData.get("nom"),
        telephone: formData.get("telephone"),
        email: formData.get("email"),
        pieceIdentite: formData.get("pieceIdentite"),
        logementId: logementId || null,
      }),
    });
    setChargement(false);
    if (!res.ok) {
      setErreur("Impossible d'enregistrer l'occupant.");
      return;
    }
    setOuvrirForm(false);
    router.refresh();
  }

  async function liberer(occupantId: string) {
    await fetch(`/api/occupants/${occupantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actif: false, dateSortie: new Date().toISOString(), liberer: true }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="card">
        {!ouvrirForm ? (
          <button className="btn-primary" onClick={() => setOuvrirForm(true)}>
            + Nouvel occupant
          </button>
        ) : (
          <form action={(fd) => creerOccupant(fd)} className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="label">Prenom</label>
              <input name="prenom" required className="input" />
            </div>
            <div>
              <label className="label">Nom</label>
              <input name="nom" required className="input" />
            </div>
            <div>
              <label className="label">Telephone</label>
              <input name="telephone" required className="input" placeholder="+221 77 000 00 00" />
            </div>
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" className="input" />
            </div>
            <div>
              <label className="label">Piece d&apos;identite (N°)</label>
              <input name="pieceIdentite" className="input" />
            </div>
            <div>
              <label className="label">Logement (optionnel)</label>
              <select name="logementId" className="input">
                <option value="">— Aucun —</option>
                {logementsDisponibles.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.residence.nom} — {l.numero}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3 flex gap-2">
              <button type="submit" disabled={chargement} className="btn-primary">
                {chargement ? "Enregistrement..." : "Enregistrer"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setOuvrirForm(false)}>
                Annuler
              </button>
            </div>
          </form>
        )}
        {erreur && <p className="text-sm text-red-600 mt-2">{erreur}</p>}
      </div>

      <div className="card overflow-x-auto">
        {occupants.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun occupant enregistre.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-4">Nom</th>
                <th className="py-2 pr-4">Telephone</th>
                <th className="py-2 pr-4">Logement</th>
                <th className="py-2 pr-4">Entree</th>
                <th className="py-2 pr-4">Statut</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {occupants.map((o) => (
                <tr key={o.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-4 font-medium">{o.prenom} {o.nom}</td>
                  <td className="py-2 pr-4">{o.telephone}</td>
                  <td className="py-2 pr-4">{o.logement ? `${o.logement.residence.nom} — ${o.logement.numero}` : "—"}</td>
                  <td className="py-2 pr-4">{o.dateEntree ? formatDate(o.dateEntree) : "—"}</td>
                  <td className="py-2 pr-4">
                    <span className={`badge ${o.actif ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>
                      {o.actif ? "Actif" : "Sorti"}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    {o.actif && o.logement && (
                      <button className="btn-secondary text-xs" onClick={() => liberer(o.id)}>
                        Marquer sorti
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
