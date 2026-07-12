import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const check = await requirePermission("gererOccupants");
  if (!check.ok) return check.response;

  const body = await req.json();
  const occupant = await prisma.occupant.update({
    where: { id: params.id },
    data: {
      ...(body.actif !== undefined ? { actif: body.actif } : {}),
      ...(body.dateSortie ? { dateSortie: new Date(body.dateSortie) } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  });

  if (body.liberer && occupant.logementId) {
    await prisma.logement.update({
      where: { id: occupant.logementId },
      data: { statut: "DISPONIBLE" },
    });
  }

  return NextResponse.json(occupant);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const check = await requirePermission("gererOccupants");
  if (!check.ok) return check.response;

  await prisma.occupant.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
