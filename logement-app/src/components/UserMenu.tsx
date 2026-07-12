"use client";

import { signOut } from "next-auth/react";
import { ROLE_LABELS } from "@/lib/roles";
import { Role } from "@prisma/client";

export function UserMenu({ name, role }: { name: string; role: Role }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-sm font-medium text-slate-800">{name}</p>
        <p className="text-xs text-slate-500">{ROLE_LABELS[role]}</p>
      </div>
      <button onClick={() => signOut({ callbackUrl: "/login" })} className="btn-secondary text-xs">
        Deconnexion
      </button>
    </div>
  );
}
