import type { TranslationOverride } from '@hermes/shared/i18n'

import type { CatalogInstallTranslations } from './types_catalog_install'

export const jaCatalogInstall: TranslationOverride<CatalogInstallTranslations> = {
  preparing: 'インストールを準備中…',
  install: 'インストール',
  advanced: '詳細設定',
  skip: 'スキップ',
  installing: 'インストール中…',
  installed: 'インストール済み',
  notInstalled: '未インストール',
  failed: '失敗',
  showNames: '名前を表示',
  hideNames: '名前を隠す',
  skill: name => `スキル ${name}`,
  kind: { plugin: 'プラグイン', skill: 'スキル' },
  tier: { official: '公式', community: 'コミュニティ' },
  targetProfile: profile => `${profile} プロファイルにインストールします`,
  sendFailed: '回答を送信できませんでした。もう一度お試しください。',
  commitLabel: 'コミット',
  subdirLabel: 'フォルダー',
  securityHeading: 'セキュリティ',
  scan: { passed: 'スキャン合格', warnings: 'スキャンで警告あり', failed: 'スキャン不合格' },
  requirementsLabel: '必要条件',
  credentialsHeading: '認証情報'
}
