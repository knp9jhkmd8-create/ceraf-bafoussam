import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import bcrypt from "bcryptjs";

export async function GET() {
  const check = await requirePermission("gererUtilisateurs");
  if (!check.ok) return check.response;

  const utilisateurs = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, actif: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(utilisateurs);
}

export async function POST(req: Request) {
  const check = await requirePermission("gererUtilisateurs");
  if (!check.ok) return check.response;

  const body = await req.json();
  if (!body.name || !body.email || !body.password || !body.role) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(body.password, 10);
  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email.toLowerCase(),
      passwordHash,
      role: body.role,
    },
  });

  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
