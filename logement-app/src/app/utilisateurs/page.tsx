import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { peut } from "@/lib/roles";
import { redirect } from "next/navigation";
import { UtilisateursClient } from "@/components/utilisateurs/UtilisateursClient";

export default async function UtilisateursPage() {
  const session = await getSession();
  if (!peut(session?.user.role, "gererUtilisateurs")) redirect("/dashboard");

  const utilisateurs = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, actif: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Utilisateurs</h1>
      <p className="text-sm text-slate-500 mb-6">Gere les comptes et leurs roles.</p>
      <UtilisateursClient utilisateurs={utilisateurs} />
    </Shell>
  );
}
