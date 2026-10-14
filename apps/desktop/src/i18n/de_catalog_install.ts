import type { CatalogInstallTranslations } from './types_catalog_install'

export const deCatalogInstall: CatalogInstallTranslations = {
  preparing: 'Installation wird vorbereitet…',
  install: 'Installieren',
  advanced: 'Erweitert',
  skip: 'Überspringen',
  installing: 'Wird installiert…',
  installed: 'Installiert',
  notInstalled: 'Nicht installiert',
  failed: 'Fehlgeschlagen',
  showNames: 'Namen anzeigen',
  hideNames: 'Namen ausblenden',
  skill: (name: string) => `Skill ${name}`,
  kind: {
    plugin: 'Plugin',
    skill: 'Skill'
  },
  tier: {
    official: 'offiziell',
    community: 'Community'
  },
  targetProfile: (profile: string) => `Wird in Ihr Profil ${profile} installiert`,
  sendFailed: 'Ihre Antwort konnte nicht gesendet werden. Versuchen Sie es erneut.',
  commitLabel: 'Commit',
  subdirLabel: 'Ordner',
  securityHeading: 'Sicherheit',
  scan: {
    passed: 'Scan bestanden',
    warnings: 'Scan hat Warnungen gefunden',
    failed: 'Scan fehlgeschlagen'
  },
  requirementsLabel: 'Erfordert',
  credentialsHeading: 'Zugangsdaten'
}
