import type { CatalogInstallTranslations } from './types_catalog_install'

export const zhCatalogInstall: CatalogInstallTranslations = {
  preparing: '正在准备安装…',
  install: '安装',
  advanced: '高级',
  skip: '跳过',
  installing: '正在安装…',
  installed: '已安装',
  notInstalled: '未安装',
  failed: '失败',
  showNames: '显示名称',
  hideNames: '隐藏名称',
  skill: name => `技能 ${name}`,
  kind: { plugin: '插件', skill: '技能' },
  tier: { official: '官方', community: '社区' },
  targetProfile: profile => `安装到你的 ${profile} 配置文件`,
  sendFailed: '无法发送你的回复，请重试。',
  commitLabel: '提交',
  subdirLabel: '文件夹',
  securityHeading: '安全',
  scan: { passed: '扫描通过', warnings: '扫描发现警告', failed: '扫描未通过' },
  requirementsLabel: '要求',
  credentialsHeading: '凭据'
}
