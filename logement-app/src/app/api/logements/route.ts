import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export async function POST(req: Request) {
  const check = await requirePermission("gererResidences");
  if (!check.ok) return check.response;

  const body = await req.json();
  if (!body.residenceId || !body.numero || !body.type) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }

  const logement = await prisma.logement.create({
    data: {
      residenceId: body.residenceId,
      numero: body.numero,
      type: body.type,
      capacite: Number(body.capacite) || 1,
      prixParNuit: Number(body.prixParNuit) || 0,
      prixParMois: Number(body.prixParMois) || 0,
      description: body.description || null,
    },
  });
  return NextResponse.json(logement, { status: 201 });
}
