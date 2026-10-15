import type { TranslationOverride } from '@hermes/shared/i18n'

import type { CatalogInstallTranslations } from './types_catalog_install'

export const frCatalogInstall: TranslationOverride<CatalogInstallTranslations> = {
  preparing: 'Préparation de l’installation…',
  install: 'Installer',
  advanced: 'Avancé',
  skip: 'Ignorer',
  installing: 'Installation…',
  installed: 'Installé',
  notInstalled: 'Non installé',
  failed: 'Échec',
  showNames: 'afficher les noms',
  hideNames: 'masquer les noms',
  skill: (name: string) => `skill ${name}`,
  kind: {
    plugin: 'plugin',
    skill: 'skill'
  },
  tier: {
    official: 'officiel',
    community: 'communauté'
  },
  targetProfile: (profile: string) => `S’installe dans votre profil ${profile}`,
  sendFailed: 'Impossible d’envoyer votre réponse. Réessayez.',
  commitLabel: 'Commit',
  subdirLabel: 'Dossier',
  securityHeading: 'Sécurité',
  scan: {
    passed: 'Analyse réussie',
    warnings: 'L’analyse a relevé des avertissements',
    failed: 'Échec de l’analyse'
  },
  requirementsLabel: 'Nécessite',
  credentialsHeading: 'Identifiants'
}
