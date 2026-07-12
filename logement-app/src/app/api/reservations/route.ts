import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export async function GET() {
  const check = await requirePermission("gererReservations");
  if (!check.ok) return check.response;

  const reservations = await prisma.reservation.findMany({
    include: { logement: { include: { residence: true } }, paiements: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(reservations);
}

export async function POST(req: Request) {
  const check = await requirePermission("gererReservations");
  if (!check.ok) return check.response;

  const body = await req.json();
  const required = ["logementId", "clientNom", "clientTelephone", "dateDebut", "dateFin", "montantTotal"];
  for (const field of required) {
    if (!body[field]) {
      return NextResponse.json({ error: `Champ requis manquant: ${field}` }, { status: 400 });
    }
  }

  const reservation = await prisma.reservation.create({
    data: {
      logementId: body.logementId,
      clientNom: body.clientNom,
      clientTelephone: body.clientTelephone,
      clientEmail: body.clientEmail || null,
      dateDebut: new Date(body.dateDebut),
      dateFin: new Date(body.dateFin),
      montantTotal: Number(body.montantTotal),
    },
  });

  await prisma.logement.update({
    where: { id: body.logementId },
    data: { statut: "RESERVE" },
  });

  return NextResponse.json(reservation, { status: 201 });
}
