import type { ToolCardsCopy } from './types_tool_cards'

export const ruToolCards: ToolCardsCopy = {
  activityLabel: 'Активность инструментов',
  families: {
    browser: 'Браузер',
    code: 'Код',
    files: 'Файлы',
    generic: 'Инструмент',
    mcp: 'Коннектор',
    search: 'Поиск',
    terminal: 'Терминал',
    web: 'Веб'
  },
  names: {
    memory: 'Память',
    message: 'Сообщения',
    schedule: 'Расписание',
    skills: 'Навыки',
    vision: 'Зрение'
  },
  usedTimes: (name, count) => `Использовано: ${name} ×${count}`,
  working: 'Выполняется…',
  awaitingApproval: 'Ждёт вашего подтверждения',
  reviewApproval: 'Проверить',
  failed: 'Ошибка',
  stopped: 'Остановлено',
  details: {
    request: 'Запрос',
    output: 'Вывод',
    duration: 'Длительность',
    noOutput: 'Нет вывода'
  },
  argLabels: {
    code: 'Код',
    command: 'Команда',
    input: 'Ввод',
    path: 'Файл',
    query: 'Поиск',
    target: 'Цель',
    text: 'Текст',
    url: 'Адрес'
  },
  viewer: {
    title: name => `Шаги: ${name}`,
    step: (index, total) => `Шаг ${index} из ${total}`,
    noScreenshot: 'Для этого шага нет снимка',
    previous: 'Предыдущий шаг',
    next: 'Следующий шаг'
  }
}
