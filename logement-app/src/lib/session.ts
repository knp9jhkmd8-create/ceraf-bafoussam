import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { peut, PERMISSIONS } from "@/lib/roles";

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requirePermission(permission: keyof typeof PERMISSIONS) {
  const session = await getSession();
  if (!session || !peut(session.user.role, permission)) {
    return { ok: false as const, response: NextResponse.json({ error: "Non autorise." }, { status: 403 }) };
  }
  return { ok: true as const, session };
}
