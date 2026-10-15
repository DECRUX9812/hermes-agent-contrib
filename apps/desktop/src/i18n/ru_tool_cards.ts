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
  usedTools: count => `Использовано инструментов: ${count}`,
  working: 'Выполняется…',
  awaitingApproval: 'Ждёт вашего подтверждения',
  reviewApproval: 'Проверить',
  failed: 'Ошибка',
  stopped: 'Остановлено',
  statuses: {
    browser_back: { done: 'Вернулся назад', pending: 'Возвращается назад' },
    browser_console: { done: 'Прочитал консоль страницы', pending: 'Читает консоль страницы' },
    browser_get_images: { done: 'Собрал изображения страницы', pending: 'Собирает изображения страницы' },
    browser_press: { done: 'Нажал клавишу', pending: 'Нажимает клавишу' },
    browser_scroll: { done: 'Прокрутил страницу', pending: 'Прокручивает страницу' },
    browser_vision: { done: 'Посмотрел на страницу', pending: 'Смотрит на страницу' }
  },
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
    action: 'Действие',
    title: name => `Шаги: ${name}`,
    step: (index, total) => `Шаг ${index} из ${total}`,
    noScreenshot: 'Для этого шага нет снимка',
    thumbnail: 'Снимок экрана',
    snapshot: 'Снимок DOM',
    url: 'URL',
    previous: 'Предыдущий шаг',
    next: 'Следующий шаг'
  }
}
