import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const check = await requirePermission("gererReservations");
  if (!check.ok) return check.response;

  const body = await req.json();
  const reservation = await prisma.reservation.update({
    where: { id: params.id },
    data: { ...(body.statut ? { statut: body.statut } : {}) },
  });

  if (body.statut === "ANNULEE") {
    await prisma.logement.update({
      where: { id: reservation.logementId },
      data: { statut: "DISPONIBLE" },
    });
  }

  return NextResponse.json(reservation);
}
