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
  working: 'Trabajando…',
  awaitingApproval: 'Esperando tu aprobación',
  reviewApproval: 'Revisar',
  failed: 'Error',
  stopped: 'Detenido',
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
    title: name => `Pasos de ${name}`,
    step: (index, total) => `Paso ${index} de ${total}`,
    noScreenshot: 'No hay captura para este paso',
    previous: 'Paso anterior',
    next: 'Paso siguiente'
  }
}
