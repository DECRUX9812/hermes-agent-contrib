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
  working: 'Läuft…',
  awaitingApproval: 'Wartet auf Ihre Freigabe',
  reviewApproval: 'Prüfen',
  failed: 'Fehlgeschlagen',
  stopped: 'Abgebrochen',
  showDetails: 'Details anzeigen',
  hideDetails: 'Details ausblenden',
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
    title: name => `Schritte: ${name}`,
    step: (index, total) => `Schritt ${index} von ${total}`,
    noScreenshot: 'Für diesen Schritt gibt es keinen Screenshot',
    previous: 'Vorheriger Schritt',
    next: 'Nächster Schritt'
  }
}
