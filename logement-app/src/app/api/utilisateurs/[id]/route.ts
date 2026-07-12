import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const check = await requirePermission("gererUtilisateurs");
  if (!check.ok) return check.response;

  const body = await req.json();
  const user = await prisma.user.update({
    where: { id: params.id },
    data: { ...(body.actif !== undefined ? { actif: body.actif } : {}), ...(body.role ? { role: body.role } : {}) },
  });
  return NextResponse.json({ id: user.id });
}
