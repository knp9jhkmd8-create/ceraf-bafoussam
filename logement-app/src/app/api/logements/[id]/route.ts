import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const check = await requirePermission("gererResidences");
  if (!check.ok) return check.response;

  const body = await req.json();
  const logement = await prisma.logement.update({
    where: { id: params.id },
    data: {
      ...(body.statut ? { statut: body.statut } : {}),
      ...(body.numero ? { numero: body.numero } : {}),
      ...(body.type ? { type: body.type } : {}),
      ...(body.capacite !== undefined ? { capacite: Number(body.capacite) } : {}),
      ...(body.prixParNuit !== undefined ? { prixParNuit: Number(body.prixParNuit) } : {}),
      ...(body.prixParMois !== undefined ? { prixParMois: Number(body.prixParMois) } : {}),
    },
  });
  return NextResponse.json(logement);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const check = await requirePermission("gererResidences");
  if (!check.ok) return check.response;

  await prisma.logement.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
