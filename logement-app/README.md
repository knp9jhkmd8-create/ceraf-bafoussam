# GesLogement — Gestion de residence

Application web (installable comme app mobile via PWA) pour la gestion d'une residence : logements, occupants, reservations avec paiement securise (Orange Money, Mobile Money, carte bancaire), tableau de bord et suivi financier.

## Stack technique

- Next.js 14 (App Router, TypeScript, React 18)
- Tailwind CSS
- Prisma + SQLite (facile a remplacer par PostgreSQL/MySQL en production)
- NextAuth (authentification par email/mot de passe, sessions JWT)
- PWA basique (manifest.json, installable sur mobile)

## Fonctionnalites incluses (V1 / MVP)

- Creation de residences et de leurs logements (numero, type, capacite, prix/nuit, prix/mois)
- Statuts de logement : disponible, occupe, reserve, maintenance
- Enregistrement des occupants, association a un logement, sortie
- Reservations avec encaissement simule via Orange Money / Mobile Money / Carte bancaire (voir plus bas)
- Tableau de bord : compteurs par statut, taux d'occupation, revenus du mois, dernieres reservations
- Suivi financier : historique des paiements, totaux par periode et par moyen de paiement
- Comptes utilisateurs avec 4 roles : Administrateur, Gestionnaire, Agent, Comptable (acces differencie par role)

## A propos des paiements

Le module de paiement (`src/lib/paiement.ts`) simule Orange Money, Mobile Money et Carte bancaire : il n'y a pas encore de compte marchand connecte. La simulation reproduit un vrai flux (latence, reference de transaction, taux d'echec realiste) pour que l'ecran de reservation soit deja utilisable en demonstration.

Pour brancher les vrais paiements plus tard, il suffit de remplacer le contenu de la fonction `processMockPayment` par un appel aux API reelles :
- Orange Money : API Orange Money Developer (webpay ou API marchande selon le pays)
- Mobile Money : un agregateur comme CinetPay, PayDunya ou Wave Business (couvre plusieurs operateurs d'un coup)
- Carte bancaire : Stripe, ou un PSP local compatible carte (CinetPay/PayDunya proposent aussi la carte)

Aucun autre fichier n'a besoin d'etre modifie : toute l'app appelle uniquement `processMockPayment`.

## Installation (sur votre machine)

Prerequis : Node.js 18+ et npm.

```bash
cd logement-app
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev
```

L'application est alors disponible sur http://localhost:3000

## Comptes de demonstration

Le script de seed cree 4 comptes (mot de passe pour tous : password123) :

- admin@logement.app -> Administrateur
- gestionnaire@logement.app -> Gestionnaire
- agent@logement.app -> Agent
- comptable@logement.app -> Comptable

Une residence de demonstration avec 5 logements, un occupant et une reservation payee sont aussi crees.

## Roles et permissions

- Administrateur : acces total (residences, occupants, reservations, finances, gestion des comptes)
- Gestionnaire : residences/logements, occupants, reservations
- Agent : occupants, reservations (pas de gestion des logements ni des finances)
- Comptable : tableau de bord + finances uniquement

Modifiable dans src/lib/roles.ts.

## Passer en production

1. Remplacer SQLite par PostgreSQL/MySQL : changer "provider" dans prisma/schema.prisma et DATABASE_URL dans .env.
2. Generer un vrai secret pour NEXTAUTH_SECRET (openssl rand -base64 32).
3. Brancher les vraies API de paiement (voir section ci-dessus).
4. Deployer sur Vercel, ou tout hebergeur Node.js.

## Note sur l'installation dans cet environnement de developpement

Le sandbox utilise pour construire ce projet bloque l'acces au CDN de Prisma (binaries.prisma.sh), donc `prisma generate` n'a pas pu etre verifie ici. C'est une restriction reseau propre a cet environnement : sur votre machine ou sur n'importe quel hebergeur standard (Vercel, VPS, CI), `npm install` puis `npx prisma migrate dev` fonctionnent normalement sans configuration particuliere.

## Structure du projet

```
src/app/            pages (App Router) + routes API
src/components/      composants d'interface reutilisables
src/lib/             logique metier (auth, permissions, paiement, utilitaires)
prisma/schema.prisma  modele de donnees
prisma/seed.ts        donnees de demonstration
```
