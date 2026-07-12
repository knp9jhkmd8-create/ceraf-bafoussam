import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export async function GET() {
  const check = await requirePermission("gererOccupants");
  if (!check.ok) return check.response;

  const residences = await prisma.residence.findMany({
    include: { logements: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(residences);
}

export async function POST(req: Request) {
  const check = await requirePermission("gererResidences");
  if (!check.ok) return check.response;

  const body = await req.json();
  if (!body.nom || !body.adresse) {
    return NextResponse.json({ error: "Nom et adresse requis." }, { status: 400 });
  }

  const residence = await prisma.residence.create({
    data: {
      nom: body.nom,
      adresse: body.adresse,
      ville: body.ville || null,
      description: body.description || null,
    },
  });
  return NextResponse.json(residence, { status: 201 });
}
