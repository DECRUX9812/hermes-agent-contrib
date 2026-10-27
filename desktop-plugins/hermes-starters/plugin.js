/**
 * Starters — three one-tap prompt starters under the empty-chat intro.
 *
 * Rides core's `chat.intro` area (CHAT_INTRO_AREA), which mounts under the intro
 * wherever core shows it: a new chat, and an empty session with the Appearance
 * intro on. A tap appends the prompt to the visible composer as its own block,
 * ready to finish; nothing is sent.
 *
 * Plain ESM, loaded uncompiled. UI is jsx() calls, not JSX syntax.
 */

import { Button, CHAT_INTRO_AREA, Codicon, host, usePluginI18n } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-starters'

const STARTERS = [
	{ key: 'featureSquad', icon: 'zap' },
	{ key: 'bugHunt', icon: 'bug' },
	{ key: 'research', icon: 'search' }
]

const bundle = (featureSquad, bugHunt, research) => ({
	featureSquad: { label: featureSquad[0], prompt: featureSquad[1] },
	bugHunt: { label: bugHunt[0], prompt: bugHunt[1] },
	research: { label: research[0], prompt: research[1] }
})

const BUNDLES = {
	en: bundle(
		['Feature Squad', 'Plan, build, and test a feature in parallel: '],
		['Bug Hunt', 'Reproduce and fix this bug: '],
		['Research', 'Search the web and docs to summarize: ']
	),
	de: bundle(
		['Feature-Team', 'Plane, baue und teste ein Feature parallel: '],
		['Bugjagd', 'Reproduziere und behebe diesen Bug: '],
		['Recherche', 'Durchsuche Web und Doku und fasse zusammen: ']
	),
	es: bundle(
		['Equipo de función', 'Planifica, construye y prueba una función en paralelo: '],
		['Caza de bugs', 'Reproduce y corrige este bug: '],
		['Investigar', 'Busca en la web y la documentación y resume: ']
	),
	fr: bundle(
		['Équipe fonctionnalité', 'Planifie, construis et teste une fonctionnalité en parallèle : '],
		['Chasse aux bugs', 'Reproduis et corrige ce bug : '],
		['Recherche', 'Cherche sur le web et dans la doc, puis résume : ']
	),
	ja: bundle(
		['機能チーム', '機能を並行して計画・実装・テストして: '],
		['バグ調査', 'このバグを再現して修正して: '],
		['リサーチ', 'Web とドキュメントを調べて要約して: ']
	),
	zh: bundle(['功能小队', '并行规划、构建并测试一个功能：'], ['捉虫', '复现并修复这个 bug：'], ['调研', '搜索网页和文档并总结：']),
	'zh-hant': bundle(['功能小隊', '平行規劃、建置並測試一個功能：'], ['抓蟲', '重現並修復這個錯誤：'], ['研究', '搜尋網頁和文件並摘要：'])
}

function Starters() {
	const t = usePluginI18n(ID)

	return jsx('div', {
		className: 'pointer-events-auto mt-4 flex flex-wrap items-center justify-center gap-1.5',
		'data-slot': 'intro_starters',
		children: STARTERS.map(({ key, icon }) =>
			jsxs(
				Button,
				{
					className: 'rounded-full',
					onClick: () => void host.composer.insertText(null, t(`${key}.prompt`), { mode: 'block' }),
					size: 'xs',
					type: 'button',
					variant: 'chip',
					children: [jsx(Codicon, { name: icon, size: '0.8rem' }), t(`${key}.label`)]
				},
				key
			)
		)
	})
}

export default {
	id: ID,
	name: 'Starters',
	description: 'One-tap prompt starters under the new-chat intro.',

	register(ctx) {
		ctx.i18n.register(BUNDLES)
		ctx.register({ id: 'starters', area: CHAT_INTRO_AREA, order: 10, render: () => jsx(Starters, {}) })
	}
}
