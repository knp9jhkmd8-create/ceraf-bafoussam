// Adaptateur de paiement --------------------------------------------------
// Cette couche simule les integrations Orange Money, Mobile Money et Carte
// Bancaire. Chaque fournisseur reel (Orange Money API, agregateur Mobile
// Money type CinetPay / PayDunya, Stripe pour carte) pourra remplacer la
// logique de "processMockPayment" ci-dessous sans toucher au reste de
// l'application : seule cette fonction doit changer.

import { MoyenPaiement } from "@prisma/client";

export type PaiementInput = {
  montant: number;
  moyen: MoyenPaiement;
  telephoneOuCarte: string; // numero mobile money / orange money, ou 4 derniers chiffres carte
};

export type PaiementResult = {
  succes: boolean;
  reference: string;
  message: string;
};

function genererReference(prefix: string) {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

// Simule un appel reseau vers le fournisseur de paiement (latence + succes).
export async function processMockPayment(input: PaiementInput): Promise<PaiementResult> {
  await new Promise((resolve) => setTimeout(resolve, 600));

  const prefixes: Record<MoyenPaiement, string> = {
    ORANGE_MONEY: "OM",
    MOBILE_MONEY: "MM",
    CARTE_BANCAIRE: "CB",
    ESPECES: "ESP",
  };

  const reference = genererReference(prefixes[input.moyen] ?? "PAY");

  if (!input.montant || input.montant <= 0) {
    return { succes: false, reference, message: "Montant invalide." };
  }

  if (!input.telephoneOuCarte || input.telephoneOuCarte.trim().length < 4) {
    return { succes: false, reference, message: "Coordonnees de paiement invalides." };
  }

  // Simulation : 95% de reussite pour imiter un vrai comportement reseau.
  const succes = Math.random() > 0.05;

  return {
    succes,
    reference,
    message: succes
      ? "Paiement confirme."
      : "Le paiement a echoue. Veuillez reessayer.",
  };
}
