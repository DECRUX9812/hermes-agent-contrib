import type { TranslationOverride } from '@hermes/shared/i18n'

import type { CatalogInstallTranslations } from './types_catalog_install'

export const esCatalogInstall: TranslationOverride<CatalogInstallTranslations> = {
  preparing: 'Preparando la instalación…',
  install: 'Instalar',
  advanced: 'Avanzado',
  skip: 'Omitir',
  installing: 'Instalando…',
  installed: 'Instalado',
  notInstalled: 'No instalado',
  failed: 'Falló',
  showNames: 'mostrar nombres',
  hideNames: 'ocultar nombres',
  skill: (name: string) => `skill ${name}`,
  kind: {
    plugin: 'plugin',
    skill: 'skill'
  },
  tier: {
    official: 'oficial',
    community: 'comunidad'
  },
  targetProfile: (profile: string) => `Se instala en tu perfil ${profile}`,
  sendFailed: 'No se pudo enviar tu respuesta. Vuelve a intentarlo.',
  commitLabel: 'Commit',
  subdirLabel: 'Carpeta',
  securityHeading: 'Seguridad',
  scan: {
    passed: 'Análisis superado',
    warnings: 'El análisis encontró advertencias',
    failed: 'Falló el análisis'
  },
  requirementsLabel: 'Requiere',
  credentialsHeading: 'Credenciales'
}
