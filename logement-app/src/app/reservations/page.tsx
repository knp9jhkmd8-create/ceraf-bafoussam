import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/prisma";
import { ReservationsClient } from "@/components/reservations/ReservationsClient";
import { getSession } from "@/lib/session";
import { peut } from "@/lib/roles";
import { redirect } from "next/navigation";

export default async function ReservationsPage() {
  const session = await getSession();
  if (!peut(session?.user.role, "gererReservations")) redirect("/dashboard");

  const [reservations, logements] = await Promise.all([
    prisma.reservation.findMany({
      include: { logement: { include: { residence: true } }, paiements: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.logement.findMany({
      where: { statut: { in: ["DISPONIBLE", "RESERVE"] } },
      include: { residence: true },
      orderBy: { numero: "asc" },
    }),
  ]);

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Reservations & paiements</h1>
      <p className="text-sm text-slate-500 mb-6">Cree une reservation puis encaisse le paiement en toute securite.</p>
      <ReservationsClient reservations={reservations} logements={logements} />
    </Shell>
  );
}
