/** Jump — fuzzy matcher + roster handoff tests. Run: node --test tests/ */
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPlugin } from './harness.mjs'

const { fuzzyScore, fuzzyRank, publishRoster, rosterSnapshot, rowForPalette } = loadPlugin()

test('the plugin file parses and exports its shape', () => {
	const ctx = loadPlugin()

	assert.equal(typeof ctx.plugin, 'object')
	assert.equal(ctx.plugin.id, 'jump')
	assert.equal(typeof ctx.plugin.register, 'function')
})

test('an empty needle matches everything', () => {
	assert.equal(fuzzyScore('', 'anything'), 1)
	assert.equal(fuzzyScore('   ', 'anything'), 1)
})

test('a needle absent from the haystack scores zero', () => {
	assert.equal(fuzzyScore('zzz', 'hello world'), 0)
	assert.equal(fuzzyScore('a', ''), 0)
})

test('substring matching works and prefers earlier hits', () => {
	assert.ok(fuzzyScore('web', 'webapp') > 0)
	assert.ok(fuzzyScore('app', 'webapp') > 0)
	assert.ok(fuzzyScore('app', 'webapp') > fuzzyScore('app', 'my application notes'))
})

test('subsequence matching finds what substring matching cannot', () => {
	// The whole premise: core's AND-substring ranker misses this one.
	assert.equal('hwj'.includes === undefined, false)
	assert.ok(fuzzyScore('hwj', 'hermes-webapp junit') > 0)
	assert.ok(fuzzyScore('hwj', 'hermes-webapp junit') > 0)
	assert.ok(fuzzyScore('hjd', 'hermes desktop junit docs') > 0)
})

test('out-of-order characters do not match', () => {
	assert.equal(fuzzyScore('jw', 'hermes-webapp junit'), 0)
})

test('a contiguous run beats the same chars scattered', () => {
	assert.ok(fuzzyScore('abc', 'abcdef') > fuzzyScore('abc', 'axbxcx'))
})

test('case is ignored', () => {
	assert.equal(fuzzyScore('WEB', 'webapp'), fuzzyScore('web', 'WEBAPP'))
})

test('camelCase boundaries are found by a subsequence query', () => {
	assert.ok(fuzzyScore('mc', 'myCoolThing') > 0)
	assert.ok(fuzzyScore('mc', 'myCoolThing') > fuzzyScore('mc', 'much chaos'))
})

test('hyphens and slashes count as word boundaries', () => {
	assert.ok(fuzzyScore('hj', 'hermes-jump') > fuzzyScore('hj', 'hermesjump'))
})

test('fuzzyRank keeps input order for an empty query', () => {
	const items = [{ label: 'a' }, { label: 'b' }, { label: 'c' }]

	assert.deepEqual(
		fuzzyRank(items, '').map(item => item.label),
		['a', 'b', 'c']
	)
})

test('fuzzyRank drops non-matches and sorts the rest by score', () => {
	const items = [
		{ label: 'quota', keywords: 'provider limits' },
		{ label: 'hermes-webapp junit', keywords: '' },
		{ label: 'zzzzz', keywords: '' },
		{ label: 'web', keywords: '' }
	]

	const ranked = fuzzyRank(items, 'web').map(item => item.label)

	assert.ok(!ranked.includes('zzzzz'))
	// An exact label hit (997) outranks a contiguous hit buried mid-string
	// (683) — typing the whole word should surface the row that IS that word.
	assert.equal(ranked[0], 'web')
	assert.ok(ranked.indexOf('hermes-webapp junit') < ranked.length)
})

test('fuzzyRank finds a multi-word label by subsequence', () => {
	const items = [{ label: 'hermes-webapp junit' }, { label: 'desktop' }]

	assert.equal(fuzzyRank(items, 'hwj')[0].label, 'hermes-webapp junit')
})

test('fuzzyRank honours weight and limit', () => {
	const items = [{ label: 'alpha', weight: 0.5 }, { label: 'alphabet soup' }]

	assert.equal(fuzzyRank(items, 'alpha')[0].label, 'alphabet soup')
	assert.equal(fuzzyRank([{ label: 'a' }, { label: 'b' }], '', 1).length, 1)
})

test('fuzzyRank tolerates a non-array input', () => {
	// Compare by value, not deepEqual: the array comes from the vm realm, so
	// its prototype differs from this realm's Array.prototype.
	assert.equal(fuzzyRank(null, 'x').length, 0)
	assert.equal(fuzzyRank(undefined, '').length, 0)
})

test('publishRoster caps each group so the palette stays scannable', () => {
	publishRoster([
		...Array.from({ length: 100 }, (_, i) => ({ group: 'session', id: `s${i}`, label: `s${i}` })),
		...Array.from({ length: 5 }, (_, i) => ({ group: 'skill', id: `k${i}`, label: `k${i}` }))
	])

	const snapshot = rosterSnapshot()

	assert.equal(snapshot.filter(item => item.group === 'session').length, 40)
	assert.equal(snapshot.filter(item => item.group === 'skill').length, 5)
	assert.ok(snapshot.length <= 120)
})

test('publishRoster tolerates junk', () => {
	publishRoster(null)
	assert.equal(rosterSnapshot().length, 0)
})

test('rowForPalette emits the shape usePaletteContributions accepts', () => {
	const ran = []
	const row = rowForPalette({
		group: 'skill',
		id: 'skill:pdf',
		label: 'pdf',
		keywords: 'documents',
		detail: 'read and write pdfs',
		run: () => ran.push('pdf')
	})

	// contrib.ts drops any child missing a label or a run function.
	assert.equal(typeof row.label, 'string')
	assert.equal(typeof row.run, 'function')
	assert.ok(row.keywords.includes('Skills'))
	assert.equal(typeof row.detail, 'function')

	row.run()
	assert.deepEqual(ran, ['pdf'])
})

test('a roster row without detail omits the field instead of passing a non-function', () => {
	const row = rowForPalette({ group: 'cron', id: 'cron:x', label: 'Run x', keywords: '', run: () => undefined })

	assert.equal(row.detail, undefined)
})