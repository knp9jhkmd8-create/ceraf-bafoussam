import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/prisma";
import { ResidencesClient } from "@/components/residences/ResidencesClient";
import { getSession } from "@/lib/session";
import { peut } from "@/lib/roles";
import { redirect } from "next/navigation";

export default async function ResidencesPage() {
  const session = await getSession();
  if (!peut(session?.user.role, "gererOccupants")) redirect("/dashboard");

  const residences = await prisma.residence.findMany({
    include: { logements: { orderBy: { numero: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  const peutGerer = peut(session?.user.role, "gererResidences");

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Residences & logements</h1>
      <p className="text-sm text-slate-500 mb-6">Cree une residence puis ajoute ses logements.</p>
      <ResidencesClient residences={residences} peutGerer={peutGerer} />
    </Shell>
  );
}
