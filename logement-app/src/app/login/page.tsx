"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

const COMPTES_DEMO = [
  { email: "admin@logement.app", role: "Administrateur" },
  { email: "gestionnaire@logement.app", role: "Gestionnaire" },
  { email: "agent@logement.app", role: "Agent" },
  { email: "comptable@logement.app", role: "Comptable" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    setChargement(true);

    const res = await signIn("credentials", { email, password, redirect: false });
    setChargement(false);

    if (res?.error) {
      setErreur("Email ou mot de passe incorrect.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold text-brand-700">GesLogement</h1>
          <p className="text-sm text-slate-500 mt-1">Gestion de residence, simplement.</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.com" />
          </div>
          <div>
            <label className="label">Mot de passe</label>
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {erreur && <p className="text-sm text-red-600">{erreur}</p>}
          <button type="submit" disabled={chargement} className="btn-primary w-full">
            {chargement ? "Connexion..." : "Se connecter"}
          </button>
        </form>

        <div className="card mt-4 text-xs text-slate-500 space-y-1">
          <p className="font-medium text-slate-600">Comptes de demonstration (mot de passe : password123)</p>
          {COMPTES_DEMO.map((c) => (
            <p key={c.email}>{c.email} — {c.role}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
