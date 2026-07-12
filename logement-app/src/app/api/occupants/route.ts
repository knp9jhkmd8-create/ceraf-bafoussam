import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export async function GET() {
  const check = await requirePermission("gererOccupants");
  if (!check.ok) return check.response;

  const occupants = await prisma.occupant.findMany({
    include: { logement: { include: { residence: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(occupants);
}

export async function POST(req: Request) {
  const check = await requirePermission("gererOccupants");
  if (!check.ok) return check.response;

  const body = await req.json();
  if (!body.prenom || !body.nom || !body.telephone) {
    return NextResponse.json({ error: "Prenom, nom et telephone requis." }, { status: 400 });
  }

  const occupant = await prisma.occupant.create({
    data: {
      prenom: body.prenom,
      nom: body.nom,
      telephone: body.telephone,
      email: body.email || null,
      logementId: body.logementId || null,
      pieceIdentite: body.pieceIdentite || null,
      dateEntree: body.dateEntree ? new Date(body.dateEntree) : new Date(),
      notes: body.notes || null,
    },
  });

  if (body.logementId) {
    await prisma.logement.update({
      where: { id: body.logementId },
      data: { statut: "OCCUPE" },
    });
  }

  return NextResponse.json(occupant, { status: 201 });
}
