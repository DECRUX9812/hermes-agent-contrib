import type { TranslationOverride } from '@hermes/shared/i18n'

import type { CatalogInstallTranslations } from './types_catalog_install'

export const ruCatalogInstall: TranslationOverride<CatalogInstallTranslations> = {
  preparing: 'Готовим установку…',
  install: 'Установить',
  advanced: 'Дополнительно',
  skip: 'Пропустить',
  installing: 'Установка…',
  installed: 'Установлено',
  notInstalled: 'Не установлено',
  failed: 'Ошибка',
  showNames: 'показать имена',
  hideNames: 'скрыть имена',
  skill: name => `навык ${name}`,
  kind: { plugin: 'плагин', skill: 'навык' },
  tier: { official: 'официальный', community: 'сообщество' },
  targetProfile: profile => `Установка в ваш профиль ${profile}`,
  sendFailed: 'Не удалось отправить ответ. Попробуйте ещё раз.',
  commitLabel: 'Коммит',
  subdirLabel: 'Папка',
  securityHeading: 'Безопасность',
  scan: { passed: 'Проверка пройдена', warnings: 'Проверка нашла предупреждения', failed: 'Проверка не пройдена' },
  requirementsLabel: 'Требования',
  credentialsHeading: 'Учётные данные'
}
