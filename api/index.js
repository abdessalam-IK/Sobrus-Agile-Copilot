// Fonction Vercel unique : toutes les URL y sont redirigées (voir vercel.json).
// La connexion Google protège l'interface comme l'API.
export { handler as default } from '../src/http.js';
