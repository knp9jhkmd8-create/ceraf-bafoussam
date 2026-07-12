import { getSession } from "@/lib/session";
import { peut } from "@/lib/roles";
import { redirect } from "next/navigation";
import { NavLinks } from "./NavLinks";
import { UserMenu } from "./UserMenu";

export async function Shell({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const role = session.user.role;
  const nav = [
    { href: "/dashboard", label: "Tableau de bord", show: true },
    { href: "/residences", label: "Residences & logements", show: peut(role, "gererResidences") || peut(role, "gererOccupants") },
    { href: "/occupants", label: "Occupants", show: peut(role, "gererOccupants") },
    { href: "/reservations", label: "Reservations", show: peut(role, "gererReservations") },
    { href: "/finances", label: "Finances", show: peut(role, "voirFinances") },
    { href: "/utilisateurs", label: "Utilisateurs", show: peut(role, "gererUtilisateurs") },
  ].filter((item) => item.show);

  return (
    <div className="min-h-screen flex">
      <aside className="hidden md:flex md:w-64 md:flex-col border-r border-slate-200 bg-white">
        <div className="px-5 py-5 border-b border-slate-200">
          <p className="text-lg font-semibold text-brand-700">GesLogement</p>
          <p className="text-xs text-slate-500">Gestion de residence</p>
        </div>
        <NavLinks items={nav} />
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 md:px-6 py-3">
          <p className="md:hidden text-base font-semibold text-brand-700">GesLogement</p>
          <div className="ml-auto">
            <UserMenu name={session.user.name} role={role} />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
