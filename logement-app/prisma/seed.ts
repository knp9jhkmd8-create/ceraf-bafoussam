import { PrismaClient, Role, StatutLogement, StatutReservation, StatutPaiement, MoyenPaiement } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("password123", 10);

  await prisma.user.upsert({
    where: { email: "admin@logement.app" },
    update: {},
    create: {
      name: "Awa Diallo",
      email: "admin@logement.app",
      passwordHash: password,
      role: Role.ADMIN,
    },
  });

  await prisma.user.upsert({
    where: { email: "gestionnaire@logement.app" },
    update: {},
    create: {
      name: "Moussa Kone",
      email: "gestionnaire@logement.app",
      passwordHash: password,
      role: Role.GESTIONNAIRE,
    },
  });

  await prisma.user.upsert({
    where: { email: "agent@logement.app" },
    update: {},
    create: {
      name: "Fatou Sow",
      email: "agent@logement.app",
      passwordHash: password,
      role: Role.AGENT,
    },
  });

  await prisma.user.upsert({
    where: { email: "comptable@logement.app" },
    update: {},
    create: {
      name: "Ibrahima Ba",
      email: "comptable@logement.app",
      passwordHash: password,
      role: Role.COMPTABLE,
    },
  });

  const residence = await prisma.residence.create({
    data: {
      nom: "Residence Les Palmiers",
      adresse: "Rue 12, Almadies",
      ville: "Dakar",
      description: "Residence meublee proche de la plage.",
      logements: {
        create: [
          { numero: "A1", type: "Studio", capacite: 2, prixParNuit: 15000, prixParMois: 180000, statut: StatutLogement.DISPONIBLE },
          { numero: "A2", type: "Studio", capacite: 2, prixParNuit: 15000, prixParMois: 180000, statut: StatutLogement.OCCUPE },
          { numero: "B1", type: "Appartement 2 pieces", capacite: 4, prixParNuit: 25000, prixParMois: 300000, statut: StatutLogement.RESERVE },
          { numero: "B2", type: "Appartement 2 pieces", capacite: 4, prixParNuit: 25000, prixParMois: 300000, statut: StatutLogement.MAINTENANCE },
          { numero: "C1", type: "Appartement 3 pieces", capacite: 6, prixParNuit: 35000, prixParMois: 420000, statut: StatutLogement.DISPONIBLE },
        ],
      },
    },
    include: { logements: true },
  });

  const occupe = residence.logements.find((l) => l.numero === "A2")!;
  await prisma.occupant.create({
    data: {
      logementId: occupe.id,
      prenom: "Cheikh",
      nom: "Ndiaye",
      telephone: "+221771234567",
      email: "cheikh.ndiaye@example.com",
      dateEntree: new Date(),
      actif: true,
    },
  });

  const reserve = residence.logements.find((l) => l.numero === "B1")!;
  const reservation = await prisma.reservation.create({
    data: {
      logementId: reserve.id,
      clientNom: "Aminata Diop",
      clientTelephone: "+221781112233",
      clientEmail: "aminata.diop@example.com",
      dateDebut: new Date(),
      dateFin: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      montantTotal: 125000,
      statut: StatutReservation.CONFIRMEE,
    },
  });

  await prisma.paiement.create({
    data: {
      reservationId: reservation.id,
      montant: 125000,
      moyen: MoyenPaiement.ORANGE_MONEY,
      statut: StatutPaiement.PAYE,
      reference: "OM-SEED-0001",
    },
  });

  console.log("Seed termine.");
  console.log("Comptes de demo (mot de passe: password123) :");
  console.log("  admin@logement.app / gestionnaire@logement.app / agent@logement.app / comptable@logement.app");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
