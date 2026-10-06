import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// The desktop webapp must boot in a plain browser without Electron.
// Regression test for: "Desktop IPC bridge is unavailable" crash.
test('webapp boots without IPC bridge crash', async ({ app, browser }) => {
  await app.open('/');
  // The crash shows "Something broke in the interface" — assert it's absent
  await expect(browser.locator('text=Something broke in the interface')).toBeHidden({ timeout: 10000 });
  await expect(browser.locator('text=IPC bridge is unavailable')).toBeHidden({ timeout: 10000 });
  // App shell should be visible
  await expect(browser.locator('body')).toBeVisible();
});

// Bot Mode side pane (MissionRail) should render with its tabs.
test('bot mode pane renders', async ({ app, browser }) => {
  await app.open('/');
  // The activity/bot UI should be present
  const rail = browser.locator('[data-testid="mission-rail"], [data-testid="activity-pane"], aside').first();
  await expect(rail).toBeVisible({ timeout: 15000 });
});

// Agent-driven: basic chat flow. Requires model key in env (AI_GATEWAY_API_KEY).
// Uncomment when ready:
// test('agent sends a chat message', async ({ app, agent }) => {
//   await app.open('/');
//   await agent.act('type "hello" in the chat input and send it');
//   await agent.assert('a user message with "hello" appears in the chat');
// });
