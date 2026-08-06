// Adaptateur Netlify — la logique vit dans api/core.mjs, partagé avec le
// Worker Cloudflare. Ce fichier ne fait que brancher l'environnement et
// traduire les conventions de la plateforme.
import { configurerEnv, traiterRequete } from '../../api/core.mjs';

export default async (req, context) => {
  configurerEnv({ DATABASE_URL: Netlify.env.get('DATABASE_URL') });
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip');
  return traiterRequete(req, { ip });
};

export const config = { path: '/api' };
