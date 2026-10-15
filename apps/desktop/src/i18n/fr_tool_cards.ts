import type { ToolCardsCopy } from './types_tool_cards'

export const frToolCards: ToolCardsCopy = {
  activityLabel: 'Activité des outils',
  families: {
    browser: 'Navigateur',
    code: 'Code',
    files: 'Fichiers',
    generic: 'Outil',
    mcp: 'Connecteur',
    search: 'Recherche',
    terminal: 'Terminal',
    web: 'Web'
  },
  names: {
    memory: 'Mémoire',
    message: 'Messages',
    schedule: 'Planification',
    skills: 'Compétences',
    vision: 'Vision'
  },
  usedTimes: (name, count) => `Utilisé ${name} ×${count}`,
  usedTools: count => `${count} outils utilisés`,
  working: 'En cours…',
  awaitingApproval: 'En attente de votre approbation',
  reviewApproval: 'Examiner',
  failed: 'Échec',
  stopped: 'Arrêté',
  statuses: {
    browser_back: { done: 'Est revenu en arrière', pending: 'Revient en arrière' },
    browser_console: { done: 'A lu la console de la page', pending: 'Lit la console de la page' },
    browser_get_images: { done: 'A rassemblé les images de la page', pending: 'Rassemble les images de la page' },
    browser_press: { done: 'A appuyé sur une touche', pending: 'Appuie sur une touche' },
    browser_scroll: { done: 'A fait défiler la page', pending: 'Fait défiler la page' },
    browser_vision: { done: 'A regardé la page', pending: 'Regarde la page' }
  },
  details: {
    request: 'Demande',
    output: 'Sortie',
    duration: 'Durée',
    noOutput: 'Aucune sortie'
  },
  argLabels: {
    code: 'Code',
    command: 'Commande',
    input: 'Entrée',
    path: 'Fichier',
    query: 'Recherche',
    target: 'Cible',
    text: 'Texte',
    url: 'Adresse'
  },
  viewer: {
    action: 'Action',
    title: name => `Étapes de ${name}`,
    step: (index, total) => `Étape ${index} sur ${total}`,
    noScreenshot: 'Pas de capture pour cette étape',
    thumbnail: 'Capture d’écran',
    snapshot: 'Instantané du DOM',
    url: 'URL',
    previous: 'Étape précédente',
    next: 'Étape suivante'
  }
}
