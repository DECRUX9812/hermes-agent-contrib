import type { ToolCardsCopy } from './types_tool_cards'

export const deToolCards: ToolCardsCopy = {
  activityLabel: 'Werkzeugaktivität',
  families: {
    browser: 'Browser',
    code: 'Code',
    files: 'Dateien',
    generic: 'Werkzeug',
    mcp: 'Connector',
    search: 'Suche',
    terminal: 'Terminal',
    web: 'Web'
  },
  names: {
    memory: 'Gedächtnis',
    message: 'Nachrichten',
    schedule: 'Zeitplan',
    skills: 'Skills',
    vision: 'Bildanalyse'
  },
  usedTimes: (name, count) => `${name} ×${count} genutzt`,
  usedTools: count => `${count} Tools verwendet`,
  working: 'Läuft…',
  awaitingApproval: 'Wartet auf Ihre Freigabe',
  reviewApproval: 'Prüfen',
  failed: 'Fehlgeschlagen',
  stopped: 'Abgebrochen',
  statuses: {
    browser_back: { done: 'Zurückgegangen', pending: 'Geht zurück' },
    browser_console: { done: 'Seitenkonsole gelesen', pending: 'Liest die Seitenkonsole' },
    browser_get_images: { done: 'Seitenbilder gesammelt', pending: 'Sammelt Seitenbilder' },
    browser_press: { done: 'Taste gedrückt', pending: 'Drückt eine Taste' },
    browser_scroll: { done: 'Seite gescrollt', pending: 'Scrollt die Seite' },
    browser_vision: { done: 'Seite betrachtet', pending: 'Betrachtet die Seite' }
  },
  details: {
    request: 'Anfrage',
    output: 'Ausgabe',
    duration: 'Dauer',
    noOutput: 'Keine Ausgabe'
  },
  argLabels: {
    code: 'Code',
    command: 'Befehl',
    input: 'Eingabe',
    path: 'Datei',
    query: 'Suche',
    target: 'Ziel',
    text: 'Text',
    url: 'Adresse'
  },
  viewer: {
    action: 'Aktion',
    title: name => `Schritte: ${name}`,
    step: (index, total) => `Schritt ${index} von ${total}`,
    noScreenshot: 'Für diesen Schritt gibt es keinen Screenshot',
    thumbnail: 'Screenshot',
    snapshot: 'DOM-Snapshot',
    url: 'URL',
    previous: 'Vorheriger Schritt',
    next: 'Nächster Schritt'
  }
}
