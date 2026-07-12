import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/prisma";
import { OccupantsClient } from "@/components/occupants/OccupantsClient";
import { getSession } from "@/lib/session";
import { peut } from "@/lib/roles";
import { redirect } from "next/navigation";

export default async function OccupantsPage() {
  const session = await getSession();
  if (!peut(session?.user.role, "gererOccupants")) redirect("/dashboard");

  const [occupants, logementsDisponibles] = await Promise.all([
    prisma.occupant.findMany({
      include: { logement: { include: { residence: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.logement.findMany({
      where: { statut: "DISPONIBLE" },
      include: { residence: true },
      orderBy: { numero: "asc" },
    }),
  ]);

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Occupants</h1>
      <p className="text-sm text-slate-500 mb-6">Enregistre les occupants et associe-les a un logement.</p>
      <OccupantsClient occupants={occupants} logementsDisponibles={logementsDisponibles} />
    </Shell>
  );
}
