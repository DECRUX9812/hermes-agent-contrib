// Real HTTP client for the Hermes gateway mobile surface.
// Contract (owned by Muse, implemented on the gateway):
//   POST {base}/mobile/chat     { session_id, message } -> streamed reply text
//   GET  {base}/mobile/sessions -> { sessions: [{ id, title, updated_at }] }
//   GET  {base}/mobile/feed     -> { cards: FeedCard[] }
//   GET  {base}/mobile/models   -> { models: [{ id, label }] }
//   POST {base}/mobile/pair      { code } -> { token }
//
// No mocks anywhere: every failure surfaces as an honest offline/error state.

export interface ChatSession {
  id: string;
  title: string;
  updated_at: string;
}

export interface FeedCard {
  id: string;
  kind: string;
  title: string;
  summary: string;
  source_url: string;
  source_label: string;
  prompt: string;
}

export interface ModelInfo {
  id: string;
  label: string;
}

export class GatewayError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request(base: string, token: string, path: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    // Network unreachable, tailnet down, gateway asleep: say so, never fake it.
    throw new GatewayError(0, `Gateway unreachable at ${base}. Check Tailscale and that the desktop instance is running.`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GatewayError(res.status, `Gateway ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  return res;
}

export async function listSessions(base: string, token: string): Promise<ChatSession[]> {
  const res = await request(base, token, '/mobile/sessions');
  const data = (await res.json()) as { sessions?: ChatSession[] };
  return Array.isArray(data.sessions) ? data.sessions : [];
}

export async function listModels(base: string, token: string): Promise<ModelInfo[]> {
  const res = await request(base, token, '/mobile/models');
  const data = (await res.json()) as { models?: ModelInfo[] };
  return Array.isArray(data.models) ? data.models : [];
}

export async function fetchFeed(base: string, token: string): Promise<FeedCard[]> {
  const res = await request(base, token, '/mobile/feed');
  const data = (await res.json()) as { cards?: FeedCard[] };
  return Array.isArray(data.cards) ? data.cards : [];
}

export async function pairWithCode(base: string, code: string): Promise<string> {
  const res = await request(base, '', '/mobile/pair', {
    method: 'POST',
    body: JSON.stringify({ code: code.trim() }),
  });
  const data = (await res.json()) as { token?: string };
  if (typeof data.token !== 'string' || data.token.length === 0) {
    throw new GatewayError(res.status, 'Pairing succeeded but returned no token.');
  }
  return data.token;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

// Streams the assistant reply. Uses a streaming reader where the runtime
// supports it (Expo web / modern Hermes); falls back to a single awaited
// body on runtimes without streaming fetch. Either way the text shown is
// the gateway's real reply, never synthesized locally.
export async function streamChat(
  base: string,
  token: string,
  sessionId: string,
  message: string,
  onToken: (soFar: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${base}/mobile/chat`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ session_id: sessionId, message }),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new GatewayError(0, `Gateway unreachable at ${base}. Message not sent; nothing was answered.`);
  }
  if (!res.ok || !res.body) {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GatewayError(res.status, `Gateway ${res.status}: ${text.slice(0, 200) || res.statusText}`);
    }
    const full = await res.text();
    onToken(full);
    return full;
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader?.();
  if (!reader) {
    const full = await res.text();
    onToken(full);
    return full;
  }
  const decoder = new TextDecoder();
  let soFar = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // Accept plain-text chunks or SSE `data:` frames; pass through verbatim.
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        soFar += payload;
      } else if (trimmed.length > 0 && !trimmed.startsWith(':')) {
        soFar += line;
      }
    }
    onToken(soFar);
  }
  soFar += decoder.decode();
  onToken(soFar);
  return soFar;
}
