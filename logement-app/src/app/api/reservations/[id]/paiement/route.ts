import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { processMockPayment } from "@/lib/paiement";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const check = await requirePermission("gererReservations");
  if (!check.ok) return check.response;

  const body = await req.json();
  const reservation = await prisma.reservation.findUnique({ where: { id: params.id } });
  if (!reservation) {
    return NextResponse.json({ error: "Reservation introuvable." }, { status: 404 });
  }

  const resultat = await processMockPayment({
    montant: reservation.montantTotal,
    moyen: body.moyen,
    telephoneOuCarte: body.telephoneOuCarte,
  });

  const paiement = await prisma.paiement.create({
    data: {
      reservationId: reservation.id,
      montant: reservation.montantTotal,
      moyen: body.moyen,
      statut: resultat.succes ? "PAYE" : "ECHOUE",
      reference: resultat.reference,
      detailsMasque: body.telephoneOuCarte ? `••••${String(body.telephoneOuCarte).slice(-4)}` : null,
    },
  });

  if (resultat.succes) {
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { statut: "CONFIRMEE" },
    });
  }

  return NextResponse.json({ paiement, resultat });
}
