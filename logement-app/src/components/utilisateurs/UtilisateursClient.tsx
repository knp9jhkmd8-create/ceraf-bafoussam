"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS } from "@/lib/roles";

type Utilisateur = { id: string; name: string; email: string; role: string; actif: boolean };

const ROLES = ["ADMIN", "GESTIONNAIRE", "AGENT", "COMPTABLE"];

export function UtilisateursClient({ utilisateurs }: { utilisateurs: Utilisateur[] }) {
  const router = useRouter();
  const [ouvrirForm, setOuvrirForm] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  async function creerUtilisateur(formData: FormData) {
    setChargement(true);
    setErreur("");
    const res = await fetch("/api/utilisateurs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password"),
        role: formData.get("role"),
      }),
    });
    setChargement(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErreur(data.error || "Impossible de creer le compte.");
      return;
    }
    setOuvrirForm(false);
    router.refresh();
  }

  async function toggleActif(id: string, actif: boolean) {
    await fetch(`/api/utilisateurs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actif: !actif }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="card">
        {!ouvrirForm ? (
          <button className="btn-primary" onClick={() => setOuvrirForm(true)}>
            + Nouveau compte
          </button>
        ) : (
          <form action={(fd) => creerUtilisateur(fd)} className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="label">Nom complet</label>
              <input name="name" required className="input" />
            </div>
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" required className="input" />
            </div>
            <div>
              <label className="label">Mot de passe temporaire</label>
              <input name="password" type="password" required minLength={6} className="input" />
            </div>
            <div>
              <label className="label">Role</label>
              <select name="role" required className="input">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r as keyof typeof ROLE_LABELS]}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={chargement} className="btn-primary">
                {chargement ? "Creation..." : "Creer le compte"}
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
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-100">
              <th className="py-2 pr-4">Nom</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Statut</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {utilisateurs.map((u) => (
              <tr key={u.id} className="border-b border-slate-50 last:border-0">
                <td className="py-2 pr-4 font-medium">{u.name}</td>
                <td className="py-2 pr-4">{u.email}</td>
                <td className="py-2 pr-4">{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS]}</td>
                <td className="py-2 pr-4">
                  <span className={`badge ${u.actif ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>
                    {u.actif ? "Actif" : "Desactive"}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <button className="btn-secondary text-xs" onClick={() => toggleActif(u.id, u.actif)}>
                    {u.actif ? "Desactiver" : "Reactiver"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
