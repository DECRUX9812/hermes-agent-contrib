# Hermes mobile (Expo + TypeScript)

iOS-first companion app for the Hermes desktop instance. Original Hermes
design (OLED-black dark UI); it does not copy any other app's assets.

## Status (2026-10-05)

Working scaffold. All three tabs are live and every one talks to the real
gateway — there are no mocked responses and no placeholder screens. Gateway
down means an honest offline/error state, never fabricated content.

## Run

  cd apps/mobile
  npm install
  npx expo start

Point the app at the desktop instance (Settings tab): gateway URL over
Tailscale + the pairing code the desktop shows. Token is stored in the
device Keychain (expo-secure-store), never in plaintext.

## Gateway contract (implemented on the gateway, owned by Muse)

  POST /mobile/chat     { session_id, message } -> streamed reply (text or SSE)
  GET  /mobile/sessions -> { sessions: [{ id, title, updated_at }] }
  GET  /mobile/feed     -> { cards: [{ id, kind, title, summary, source_url, source_label, prompt }] }
  GET  /mobile/models   -> { models: [{ id, label }] }
  POST /mobile/pair      { code } -> { token }

If the endpoints are not live yet the app shows exactly that and retries —
it does not invent replies, sessions, or feed cards.

## Layout

  App.tsx                  tab shell (Chat / Feed / Settings)
  src/api/client.ts        gateway HTTP client, streaming chat, GatewayError
  src/pairing.ts           Keychain token + gateway URL storage
  src/screens/ChatScreen.tsx   streamed chat, session chips, stop button
  src/screens/FeedScreen.tsx   briefing cards, source links, chat deep-link
  src/screens/SettingsScreen.tsx pairing, appearance, model picker, feed prompt
  src/theme.ts             palette

## Still ahead (before TestFlight)

- Gateway /mobile/* endpoints live (Muse, in parallel)
- APNs push wired to the AgentMail realtime path
- EAS project + Apple Developer enrollment (Ritesh's call)
- Device testing on iPhone, 60fps pass
