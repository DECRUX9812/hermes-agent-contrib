/**
 * Shared wire types for the Bot Room overlay. Kept engine-local: the overlay
 * window is a puppet — `src/store/botroom.ts` defines the same shape on the
 * main-renderer side; the two travel only as IPC payloads.
 */

export interface Bot {
  id: string
  name: string
  displayName?: string
  status: 'idle' | 'working' | 'sleeping' | 'offline'
  statusLine?: string
  color?: string
}

export interface Room {
  id: string
  name: string
  memberBotIds: string[]
  anchor?: { x: number; y: number }
}

export interface RoomMsg {
  roomId: string
  author: string
  text: string
  ephemeral?: boolean
  at: number
}

/** A page/screen element captured as task context (element targeting lands
 *  with screen-level actions; kept on the wire for panel chips). */
export interface ElementInfo {
  selector: string
  label: string
}

export type SwToContent =
  | { type: 'init'; enabled: boolean; bots: Bot[]; rooms: Room[] }
  | { type: 'bots'; bots: Bot[] }
  | { type: 'bot.status'; bot: Bot }
  | { type: 'rooms'; rooms: Room[] }
  | { type: 'room.msg'; msg: RoomMsg }
  | { type: 'bot.action'; botId: string; action: string }

export type ContentToSw =
  | { type: 'ready' }
  | { type: 'task'; botId?: string; roomId?: string; text: string }
  | { type: 'room.create'; name: string; botIds?: string[] }
  | { type: 'room.move'; roomId: string; botId?: string }
  | { type: 'room.remove'; roomId: string }
  | { type: 'mascot.move'; botId: string; x: number; y: number }
  | { type: 'mascot.action'; botId: string; action: string }
  | { type: 'open-app' }
  | { type: 'close' }
