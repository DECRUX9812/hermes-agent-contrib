/**
 * Block registry for the AgentCraft voxel world — a TS mirror of the block-state
 * layer in `mod/.../hq/St.java` + `Plan.java`. A block STATE is a packed u16:
 * `id << 8 | meta`. Meta bits (per shape):
 *   bits 0-1  dir: N=0 E=1 S=2 W=3  (or axis X=0 Y=1 Z=2 for logs/chains)
 *   bit  2    top / upper / lit / open (contextual flag A)
 *   bit  3    hanging / secondary flag B
 *   bits 4-5  amount-1 (candles, flower beds, leaf litter)
 */

export type Shape =
  | 'air'
  | 'cube'        // full cube, texture set in tex
  | 'log'         // axis: side + end textures
  | 'stairs'      // dir + top
  | 'slab'        // top
  | 'pane'        // glass pane, connects to neighbours
  | 'fence'       // fence post, connects to neighbours
  | 'carpet'      // 1px slab
  | 'lantern'     // hanging flag
  | 'chain'       // axis
  | 'candle'      // amount, lit
  | 'bell'        // dir
  | 'cross'       // two diagonal quads (flowers, grass, ferns, seagrass)
  | 'bedcover'    // flowerbed / leaf litter: flat ground cover, amount
  | 'water'
  | 'lily'        // lily pad
  | 'trapdoor'    // dir + open + top
  | 'lamp'        // agentcraft status lamp (state in bits 4-6)
  | 'bulb'        // copper bulb (lit flag)
  | 'rod'         // lightning rod
  | 'brewing'
  | 'lectern'     // dir
  | 'campfire'
  | 'potted'      // flower pot + plant cross
  | 'bushcube'    // azalea bush: small leaves cube
  | 'path'        // dirt path, top lowered 1px
  | 'light'       // invisible light block, level in bits 4-7
  | 'screen'      // monitor / task board / console: front face textured
  | 'facing'      // directional cube w/ front/top/side textures
  | 'dome'        // reserved
  ;

/** Lamp status values — kept 1:1 with `LampStatus` in the mod. */
export const enum Lamp {
  OFF = 0,
  IDLE = 1,
  THINKING = 2,
  WORKING = 3,
  WAITING = 4,
  ERROR = 5,
  DONE = 6,
}

export const enum Dir {
  N = 0,
  E = 1,
  S = 2,
  W = 3,
}
export const DIR_X = [0, 1, 0, -1]
export const DIR_Z = [-1, 0, 1, 0]
/** MC `Direction.from2DDataValue`: S=0, W=1, N=2, E=3 → our Dir. */
export const MC_2D = [Dir.S, Dir.W, Dir.N, Dir.E] as const

export const enum Axis {
  X = 0,
  Y = 1,
  Z = 2,
}

export interface BlockTex {
  /** Tile key per face: 'all' default, then top/bottom/side/front/back/n/e/s/w overrides. */
  all?: string
  top?: string
  bottom?: string
  side?: string
  north?: string
  east?: string
  south?: string
  west?: string
  front?: string // the face the block's `dir` looks toward
  back?: string
  end?: string   // log axis caps
}

export interface BlockDef {
  key: string
  shape: Shape
  tex: BlockTex
  /** Fully opaque cube: culls neighbour faces, blocks light. */
  opaque?: boolean
  /** Cutout (alpha-tested) layer instead of opaque. */
  cutout?: boolean
  /** Alpha-blended translucent layer (water). */
  translucent?: boolean
  /** Emits block light at this level (0-15); lamps use state. */
  light?: number
  /** Face is drawn full-bright in the emissive pass. */
  emissive?: boolean
  /** Blocks walking / counts as solid for pathing. */
  solid?: boolean
  /** Occludes like a full block for AO purposes. */
  occludes?: boolean
  /** Grass/decoration etc. — never blocks a face from culling. */
  decor?: boolean
}

const defs: BlockDef[] = []
const ids = new Map<string, number>()

function def(d: BlockDef): number {
  const id = defs.length
  defs.push(d)
  ids.set(d.key, id)

  return id
}

export const B = {
  AIR: def({ key: 'air', shape: 'air', tex: {}, decor: true }),
  STONE: def({ key: 'stone', shape: 'cube', tex: { all: 'stone' }, opaque: true, solid: true }),
  DIRT: def({ key: 'dirt', shape: 'cube', tex: { all: 'dirt' }, opaque: true, solid: true }),
  GRASS: def({ key: 'grass', shape: 'cube', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, opaque: true, solid: true }),
  DIRT_PATH: def({ key: 'dirt_path', shape: 'path', tex: { top: 'dirt_path', bottom: 'dirt', side: 'dirt_path_side' }, solid: true }),
  GRAVEL: def({ key: 'gravel', shape: 'cube', tex: { all: 'gravel' }, opaque: true, solid: true }),
  SAND: def({ key: 'sand', shape: 'cube', tex: { all: 'sand' }, opaque: true, solid: true }),
  MUD: def({ key: 'mud', shape: 'cube', tex: { all: 'mud' }, opaque: true, solid: true }),
  WATER: def({ key: 'water', shape: 'water', tex: { all: 'water' }, translucent: true, decor: true }),
  MOSS: def({ key: 'moss_block', shape: 'cube', tex: { all: 'moss' }, opaque: true, solid: true }),
  MOSSY_COBBLE: def({ key: 'mossy_cobble', shape: 'cube', tex: { all: 'mossy_cobble' }, opaque: true, solid: true }),
  MUD_BRICKS: def({ key: 'mud_bricks', shape: 'cube', tex: { all: 'mud_bricks' }, opaque: true, solid: true }),
  MUD_BRICK_SLAB: def({ key: 'mud_brick_slab', shape: 'slab', tex: { all: 'mud_bricks' }, solid: true, occludes: true }),

  BIRCH_PLANKS: def({ key: 'birch_planks', shape: 'cube', tex: { all: 'birch_planks' }, opaque: true, solid: true }),
  DARK_OAK_PLANKS: def({ key: 'dark_oak_planks', shape: 'cube', tex: { all: 'dark_oak_planks' }, opaque: true, solid: true }),
  PALE_OAK_PLANKS: def({ key: 'pale_oak_planks', shape: 'cube', tex: { all: 'pale_oak_planks' }, opaque: true, solid: true }),
  SPRUCE_PLANKS: def({ key: 'spruce_planks', shape: 'cube', tex: { all: 'spruce_planks' }, opaque: true, solid: true }),
  STRIPPED_DARK_OAK_LOG: def({ key: 'stripped_dark_oak_log', shape: 'log', tex: { side: 'stripped_dark_oak_log', end: 'stripped_dark_oak_log_top' }, opaque: true, solid: true }),
  BIRCH_LOG: def({ key: 'birch_log', shape: 'log', tex: { side: 'birch_log', end: 'birch_log_top' }, opaque: true, solid: true }),
  OAK_LOG: def({ key: 'oak_log', shape: 'log', tex: { side: 'oak_log', end: 'oak_log_top' }, opaque: true, solid: true }),
  DARK_OAK_LOG: def({ key: 'dark_oak_log', shape: 'log', tex: { side: 'dark_oak_log', end: 'dark_oak_log_top' }, opaque: true, solid: true }),
  SPRUCE_LOG: def({ key: 'spruce_log', shape: 'log', tex: { side: 'spruce_log', end: 'spruce_log_top' }, opaque: true, solid: true }),
  CHERRY_LOG: def({ key: 'cherry_log', shape: 'log', tex: { side: 'cherry_log', end: 'cherry_log_top' }, opaque: true, solid: true }),
  POPLAR_LOG: def({ key: 'poplar_log', shape: 'log', tex: { side: 'poplar_log', end: 'poplar_log_top' }, opaque: true, solid: true }),

  DARK_OAK_STAIRS: def({ key: 'dark_oak_stairs', shape: 'stairs', tex: { all: 'dark_oak_planks' }, solid: true, occludes: true }),
  CUT_COPPER_STAIRS: def({ key: 'cut_copper_stairs', shape: 'stairs', tex: { all: 'cut_copper' }, solid: true, occludes: true }),
  PALE_OAK_STAIRS: def({ key: 'pale_oak_stairs', shape: 'stairs', tex: { all: 'pale_oak_planks' }, solid: true, occludes: true }),
  BIRCH_STAIRS: def({ key: 'birch_stairs', shape: 'stairs', tex: { all: 'birch_planks' }, solid: true, occludes: true }),
  SPRUCE_STAIRS: def({ key: 'spruce_stairs', shape: 'stairs', tex: { all: 'spruce_planks' }, solid: true, occludes: true }),
  WOOL_STAIRS: def({ key: 'wool_stairs', shape: 'stairs', tex: { all: 'wool_brown' }, solid: true, occludes: true }),

  DARK_OAK_SLAB: def({ key: 'dark_oak_slab', shape: 'slab', tex: { all: 'dark_oak_planks' }, solid: true, occludes: true }),
  CUT_COPPER_SLAB: def({ key: 'cut_copper_slab', shape: 'slab', tex: { all: 'cut_copper' }, solid: true, occludes: true }),
  PALE_OAK_SLAB: def({ key: 'pale_oak_slab', shape: 'slab', tex: { all: 'pale_oak_planks' }, solid: true, occludes: true }),
  SPRUCE_SLAB: def({ key: 'spruce_slab', shape: 'slab', tex: { all: 'spruce_planks' }, solid: true, occludes: true }),

  GLASS_PANE: def({ key: 'glass_pane', shape: 'pane', tex: { all: 'glass' }, cutout: true }),
  GLASS: def({ key: 'glass', shape: 'cube', tex: { all: 'glass' }, cutout: true }),

  BOOKSHELF: def({ key: 'bookshelf', shape: 'cube', tex: { top: 'pale_oak_planks', bottom: 'pale_oak_planks', side: 'bookshelf' }, opaque: true, solid: true }),
  CHISELED_BOOKSHELF: def({ key: 'chiseled_bookshelf', shape: 'facing', tex: { top: 'pale_oak_planks', bottom: 'pale_oak_planks', front: 'chiseled_bookshelf', side: 'chiseled_bookshelf_side' }, opaque: true, solid: true }),
  BARREL: def({ key: 'barrel', shape: 'cube', tex: { top: 'barrel_top', bottom: 'barrel_top', side: 'barrel_side' }, opaque: true, solid: true }),
  LECTERN: def({ key: 'lectern', shape: 'lectern', tex: { all: 'lectern' }, solid: true }),
  BREWING_STAND: def({ key: 'brewing_stand', shape: 'brewing', tex: { all: 'brewing_stand' }, solid: true }),

  LANTERN: def({ key: 'lantern', shape: 'lantern', tex: { all: 'lantern' }, light: 15, emissive: true, solid: true }),
  IRON_CHAIN: def({ key: 'iron_chain', shape: 'chain', tex: { all: 'iron_chain' }, cutout: true }),
  COPPER_CHAIN: def({ key: 'copper_chain', shape: 'chain', tex: { all: 'copper_chain' }, cutout: true }),
  CANDLE: def({ key: 'candle', shape: 'candle', tex: { all: 'candle' }, light: 12, cutout: true }),
  BELL: def({ key: 'bell', shape: 'bell', tex: { all: 'bell' }, solid: true }),
  COPPER_BULB: def({ key: 'copper_bulb', shape: 'bulb', tex: { all: 'copper_bulb' }, opaque: true, solid: true }),
  LIGHTNING_ROD: def({ key: 'lightning_rod', shape: 'rod', tex: { all: 'copper_rod' }, cutout: true }),
  CAMPFIRE: def({ key: 'campfire', shape: 'campfire', tex: { all: 'campfire' }, light: 15, solid: true }),
  SPRUCE_FENCE: def({ key: 'spruce_fence', shape: 'fence', tex: { all: 'spruce_planks' }, solid: true }),
  SPRUCE_TRAPDOOR: def({ key: 'spruce_trapdoor', shape: 'trapdoor', tex: { all: 'spruce_trapdoor' }, cutout: true }),

  CARPET_BROWN: def({ key: 'carpet_brown', shape: 'carpet', tex: { all: 'wool_brown' }, decor: true }),
  CARPET_WHITE: def({ key: 'carpet_white', shape: 'carpet', tex: { all: 'wool_white' }, decor: true }),
  CARPET_LIGHT_GRAY: def({ key: 'carpet_light_gray', shape: 'carpet', tex: { all: 'wool_light_gray' }, decor: true }),

  OAK_LEAVES: def({ key: 'oak_leaves', shape: 'cube', tex: { all: 'oak_leaves' }, cutout: true, solid: true }),
  BIRCH_LEAVES: def({ key: 'birch_leaves', shape: 'cube', tex: { all: 'birch_leaves' }, cutout: true, solid: true }),
  SPRUCE_LEAVES: def({ key: 'spruce_leaves', shape: 'cube', tex: { all: 'spruce_leaves' }, cutout: true, solid: true }),
  CHERRY_LEAVES: def({ key: 'cherry_leaves', shape: 'cube', tex: { all: 'cherry_leaves' }, cutout: true, solid: true }),
  AZALEA_LEAVES: def({ key: 'azalea_leaves', shape: 'cube', tex: { all: 'azalea_leaves' }, cutout: true, solid: true }),
  FLOWERING_AZALEA_LEAVES: def({ key: 'flowering_azalea_leaves', shape: 'cube', tex: { all: 'flowering_azalea_leaves' }, cutout: true, solid: true }),
  YELLOW_POPLAR_LEAVES: def({ key: 'yellow_poplar_leaves', shape: 'cube', tex: { all: 'yellow_poplar_leaves' }, cutout: true, solid: true }),
  ORANGE_POPLAR_LEAVES: def({ key: 'orange_poplar_leaves', shape: 'cube', tex: { all: 'orange_poplar_leaves' }, cutout: true, solid: true }),

  SHORT_GRASS: def({ key: 'short_grass', shape: 'cross', tex: { all: 'short_grass' }, cutout: true, decor: true }),
  TALL_GRASS: def({ key: 'tall_grass', shape: 'cross', tex: { all: 'tall_grass' }, cutout: true, decor: true }),
  FERN: def({ key: 'fern', shape: 'cross', tex: { all: 'fern' }, cutout: true, decor: true }),
  LARGE_FERN: def({ key: 'large_fern', shape: 'cross', tex: { all: 'large_fern' }, cutout: true, decor: true }),
  // upper halves reuse the same tile, top v-half (M_ALT set)
  BUSH: def({ key: 'bush', shape: 'cube', tex: { all: 'bush' }, cutout: true, decor: true }),
  AZALEA_PLANT: def({ key: 'azalea', shape: 'bushcube', tex: { all: 'azalea_leaves' }, cutout: true, decor: true }),
  FLOWERING_AZALEA_PLANT: def({ key: 'flowering_azalea', shape: 'bushcube', tex: { all: 'flowering_azalea_leaves' }, cutout: true, decor: true }),
  POTTED_FERN: def({ key: 'potted_fern', shape: 'potted', tex: { all: 'fern' }, cutout: true, decor: true }),
  POTTED_FLOWERING_AZALEA: def({ key: 'potted_flowering_azalea', shape: 'potted', tex: { all: 'flowering_azalea_plant' }, cutout: true, decor: true }),

  POPPY: def({ key: 'poppy', shape: 'cross', tex: { all: 'poppy' }, cutout: true, decor: true }),
  DANDELION: def({ key: 'dandelion', shape: 'cross', tex: { all: 'dandelion' }, cutout: true, decor: true }),
  CORNFLOWER: def({ key: 'cornflower', shape: 'cross', tex: { all: 'cornflower' }, cutout: true, decor: true }),
  OXEYE_DAISY: def({ key: 'oxeye_daisy', shape: 'cross', tex: { all: 'oxeye_daisy' }, cutout: true, decor: true }),
  AZURE_BLUET: def({ key: 'azure_bluet', shape: 'cross', tex: { all: 'azure_bluet' }, cutout: true, decor: true }),
  LILY_OF_THE_VALLEY: def({ key: 'lily_of_the_valley', shape: 'cross', tex: { all: 'lily_of_the_valley' }, cutout: true, decor: true }),
  ALLIUM: def({ key: 'allium', shape: 'cross', tex: { all: 'allium' }, cutout: true, decor: true }),
  PEONY: def({ key: 'peony', shape: 'cross', tex: { all: 'peony' }, cutout: true, decor: true }),
  LILAC: def({ key: 'lilac', shape: 'cross', tex: { all: 'lilac' }, cutout: true, decor: true }),
  ROSE_BUSH: def({ key: 'rose_bush', shape: 'cross', tex: { all: 'rose_bush' }, cutout: true, decor: true }),
  PINK_PETALS: def({ key: 'pink_petals', shape: 'bedcover', tex: { all: 'pink_petals' }, cutout: true, decor: true }),
  WILDFLOWERS: def({ key: 'wildflowers', shape: 'bedcover', tex: { all: 'wildflowers' }, cutout: true, decor: true }),
  LEAF_LITTER: def({ key: 'leaf_litter', shape: 'bedcover', tex: { all: 'leaf_litter' }, cutout: true, decor: true }),
  FIREFLY_BUSH: def({ key: 'firefly_bush', shape: 'cross', tex: { all: 'firefly_bush' }, cutout: true, decor: true, light: 4 }),
  LILY_PAD: def({ key: 'lily_pad', shape: 'lily', tex: { all: 'lily_pad' }, cutout: true, decor: true }),
  SEAGRASS: def({ key: 'seagrass', shape: 'cross', tex: { all: 'seagrass' }, cutout: true, decor: true }),

  // ------------------------------------------------- agentcraft mod blocks
  PLASTER_PANEL: def({ key: 'plaster_panel', shape: 'cube', tex: { all: 'ac:plaster_panel' }, opaque: true, solid: true }),
  PLASTER_FRAME: def({ key: 'plaster_frame', shape: 'cube', tex: { all: 'ac:plaster_frame' }, opaque: true, solid: true }),
  WALNUT_PANEL: def({ key: 'walnut_panel', shape: 'cube', tex: { all: 'ac:walnut_panel' }, opaque: true, solid: true }),
  WALNUT_TRIM: def({ key: 'walnut_trim', shape: 'cube', tex: { all: 'ac:walnut_trim' }, opaque: true, solid: true }),
  TERRACOTTA_TILE: def({ key: 'terracotta_tile', shape: 'cube', tex: { all: 'ac:terracotta_tile' }, opaque: true, solid: true }),
  OAK_PARQUET: def({ key: 'oak_parquet', shape: 'cube', tex: { all: 'ac:oak_parquet' }, opaque: true, solid: true }),
  GLOW_PANEL: def({ key: 'glow_panel', shape: 'cube', tex: { all: 'ac:glow_panel' }, opaque: true, solid: true, light: 15, emissive: true }),
  COPPER_BLOCK: def({ key: 'copper_block', shape: 'cube', tex: { all: 'copper_block' }, opaque: true, solid: true }),
  CUT_COPPER: def({ key: 'cut_copper', shape: 'cube', tex: { all: 'cut_copper' }, opaque: true, solid: true }),

  MONITOR: def({ key: 'monitor', shape: 'screen', tex: { front: 'ac:monitor_screen_on', back: 'ac:monitor_back', side: 'ac:monitor_side', top: 'ac:monitor_frame', bottom: 'ac:monitor_frame' }, opaque: true, solid: true, light: 7 }),
  TASK_BOARD: def({ key: 'task_board', shape: 'screen', tex: { front: 'ac:task_board_surface', back: 'ac:task_board_back', side: 'ac:task_board_frame', top: 'ac:task_board_frame', bottom: 'ac:task_board_frame' }, opaque: true, solid: true, light: 7 }),
  STATUS_LAMP: def({ key: 'status_lamp', shape: 'lamp', tex: { all: 'ac:status_lamp_idle' }, light: 6 }),
  DECISION_PODIUM: def({ key: 'decision_podium', shape: 'facing', tex: { front: 'ac:decision_podium_front', back: 'ac:decision_podium_base', side: 'ac:decision_podium_column', top: 'ac:decision_podium_top', bottom: 'ac:decision_podium_base' }, opaque: true, solid: true }),
  MERGE_STATION: def({ key: 'merge_station', shape: 'facing', tex: { front: 'ac:merge_station_front', back: 'ac:merge_station_side', side: 'ac:merge_station_side', top: 'ac:merge_station_top', bottom: 'ac:merge_station_side' }, opaque: true, solid: true }),
  MEMORY_ARCHIVE: def({ key: 'memory_archive', shape: 'facing', tex: { front: 'ac:memory_archive_front', back: 'ac:memory_archive_side', side: 'ac:memory_archive_side', top: 'ac:memory_archive_top', bottom: 'ac:memory_archive_top' }, opaque: true, solid: true }),
  MEMORY_CATALOG: def({ key: 'memory_catalog', shape: 'facing', tex: { front: 'ac:memory_catalog_front', back: 'ac:memory_archive_side', side: 'ac:memory_archive_side', top: 'ac:memory_archive_top', bottom: 'ac:memory_archive_top' }, opaque: true, solid: true }),
  CONSOLE_TERMINAL: def({ key: 'console_terminal', shape: 'facing', tex: { front: 'ac:console_front', back: 'ac:console_side', side: 'ac:console_side', top: 'ac:console_top', bottom: 'ac:console_side' }, opaque: true, solid: true, light: 5 }),

  LIGHT: def({ key: 'light', shape: 'light', tex: {}, decor: true }),
} as const

export type BlockId = (typeof B)[keyof typeof B]

export const DEFS = defs

export function defOf(id: number): BlockDef {
  return defs[id]
}

export function idOf(key: string): number {
  return ids.get(key) ?? B.AIR
}

// ---------------------------------------------------------------- block states

export const M_DIR = 0x03
export const M_AXIS = 0x03
export const M_TOP = 0x04
export const M_ALT = 0x08 // hanging / open / lit / upper
export const M_AMT = 0x30 // amount-1
export const M_LAMP = 0x70 // lamp status
export const M_LEVEL = 0xf0 // light block level

export function bs(id: number, meta = 0): number {
  return (id << 8) | meta
}

export function bsId(s: number): number {
  return s >> 8
}

export function bsMeta(s: number): number {
  return s & 0xff
}

export function facing(id: number, dir: Dir): number {
  return bs(id, dir)
}

export function stairs(id: number, dir: Dir, top: boolean): number {
  return bs(id, dir | (top ? M_TOP : 0))
}

export function slab(id: number, top: boolean): number {
  return bs(id, top ? M_TOP : 0)
}

export function log(id: number, axis: Axis): number {
  return bs(id, axis)
}

export function lantern(id: number, hanging: boolean): number {
  return bs(id, hanging ? M_ALT : 0)
}

export function chain(id: number, axis: Axis): number {
  return bs(id, axis)
}

export function candle(id: number, n: number, lit: boolean): number {
  return bs(id, ((n - 1) << 4) | (lit ? M_TOP : 0))
}

export function bell(id: number, dir: Dir): number {
  return bs(id, dir)
}

export function trapdoor(id: number, dir: Dir, open: boolean, top: boolean): number {
  return bs(id, dir | (open ? M_ALT : 0) | (top ? M_TOP : 0))
}

export function flowerBed(id: number, dir: Dir, amount: number): number {
  return bs(id, dir | ((amount - 1) << 4))
}

export function light(level: number): number {
  return bs(B.LIGHT, (level & 15) << 4)
}

export function lamp(id: number, status: Lamp): number {
  return bs(id, status << 4)
}

export function lampStatus(s: number): Lamp {
  return ((bsMeta(s) & M_LAMP) >> 4) as Lamp
}

export function bulb(lit: boolean): number {
  return bs(B.COPPER_BULB, lit ? M_TOP : 0)
}

export function upper(id: number): number {
  return bs(id, M_ALT)
}

export function potted(id: number, kind: number): number {
  return bs(id, kind << 4)
}

export function isOpaque(s: number): boolean {
  return defOf(bsId(s)).opaque === true
}

export function isSolid(s: number): boolean {
  return defOf(bsId(s)).solid === true
}

export function isAir(s: number): boolean {
  return bsId(s) === B.AIR
}

export function occludes(s: number): boolean {
  const d = defOf(bsId(s))

  return d.opaque === true || d.occludes === true
}

/** Light attenuation through this cell (0 = blocks all). */
export function lightLoss(s: number): number {
  const d = defOf(bsId(s))

  if (d.opaque) {return 0}

  if (d.shape === 'cube' && d.cutout) {return 2} // leaves

  if (d.shape === 'water') {return 3}

  return 1
}

export function emittedLight(s: number): number {
  const d = defOf(bsId(s))

  if (d.shape === 'light') {return (bsMeta(s) & M_LEVEL) >> 4}

  if (d.shape === 'lamp') {return lampStatus(s) === Lamp.OFF ? 0 : (d.light ?? 0) + 4}

  if (d.shape === 'bulb') {return bsMeta(s) & M_TOP ? 15 : 0}

  return d.light ?? 0
}
