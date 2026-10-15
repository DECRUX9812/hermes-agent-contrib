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
  working: 'En cours…',
  awaitingApproval: 'En attente de votre approbation',
  reviewApproval: 'Examiner',
  failed: 'Échec',
  stopped: 'Arrêté',
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
    title: name => `Étapes de ${name}`,
    step: (index, total) => `Étape ${index} sur ${total}`,
    noScreenshot: 'Pas de capture pour cette étape',
    previous: 'Étape précédente',
    next: 'Étape suivante'
  }
}
