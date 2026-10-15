import type { ToolCardsCopy } from './types_tool_cards'

export const esToolCards: ToolCardsCopy = {
  activityLabel: 'Actividad de herramientas',
  families: {
    browser: 'Navegador',
    code: 'Código',
    files: 'Archivos',
    generic: 'Herramienta',
    mcp: 'Conector',
    search: 'Búsqueda',
    terminal: 'Terminal',
    web: 'Web'
  },
  names: {
    memory: 'Memoria',
    message: 'Mensajes',
    schedule: 'Programación',
    skills: 'Habilidades',
    vision: 'Visión'
  },
  usedTimes: (name, count) => `Usó ${name} ×${count}`,
  usedTools: count => `Usó ${count} herramientas`,
  working: 'Trabajando…',
  awaitingApproval: 'Esperando tu aprobación',
  reviewApproval: 'Revisar',
  failed: 'Error',
  stopped: 'Detenido',
  statuses: {
    browser_back: { done: 'Volvió atrás', pending: 'Volviendo atrás' },
    browser_console: { done: 'Leyó la consola de la página', pending: 'Leyendo la consola de la página' },
    browser_get_images: { done: 'Recopiló imágenes de la página', pending: 'Recopilando imágenes de la página' },
    browser_press: { done: 'Pulsó una tecla', pending: 'Pulsando una tecla' },
    browser_scroll: { done: 'Desplazó la página', pending: 'Desplazando la página' },
    browser_vision: { done: 'Miró la página', pending: 'Mirando la página' }
  },
  details: {
    request: 'Solicitud',
    output: 'Salida',
    duration: 'Duración',
    noOutput: 'Sin salida'
  },
  argLabels: {
    code: 'Código',
    command: 'Comando',
    input: 'Entrada',
    path: 'Archivo',
    query: 'Búsqueda',
    target: 'Destino',
    text: 'Texto',
    url: 'Dirección'
  },
  viewer: {
    action: 'Acción',
    title: name => `Pasos de ${name}`,
    step: (index, total) => `Paso ${index} de ${total}`,
    noScreenshot: 'No hay captura para este paso',
    thumbnail: 'Captura de pantalla',
    snapshot: 'Instantánea del DOM',
    url: 'URL',
    previous: 'Paso anterior',
    next: 'Paso siguiente'
  }
}
