# Разработка и проверки

## Среда

Windows / VS Code, компьютер папы. Папка проекта:
`C:\Users\ШУМ\LITLE WORKS\IDEAL`.
Node 24.19.0, npm 11.8.0; PostgreSQL 18.6 — сведения пользователя.
Версии зависимостей закреплены в `package-lock.json`, Prisma — 7.10.1.
Не обновлять зависимости до latest без отдельной задачи.

## Запуск и миграции

На уже настроенном проекте:

```bat
npm run dev
```

Этап 13 добавляет `20261024170000_web_push` и зависимость web-push.
Сначала `npm ci`, затем `npm test` (миграции только на `ideal_auth_test`).
Только после успешных тестов `npm run db:deploy`, `npm run db:generate`,
`npm run db:status` для `ideal_dev` и `npm run dev`. Подробно: [PUSH.md](PUSH.md).
Существующий `.env` не заменяется; VAPID настраивается вручную по инструкции.

`npm ci` требуется при установке зависимостей с нуля или изменении lock-файла.
Dev БД — `ideal_dev` / `ideal_app`. Test — `ideal_auth_test` / `ideal_test`.
Тесты требуют отдельную `TEST_DATABASE_URL`, очищают тестовые данные и не должны
запускаться на dev. `.env` не перезаписывать и не коммитить. Для новой установки
использовать список переменных из `.env.example`, без копирования чужих секретов.
Не использовать `db push`, `migrate reset` и не менять применённые миграции.
Существующего владельца не создавать повторно и не сбрасывать его пароль.

## Доступ и безопасность

Роли OWNER / ADMIN / TRAINER взаимоисключающие. OWNER: `/admin`;
ADMIN: `/staff` → `/crm/clients`; TRAINER: `/trainer`.
Argon2id, серверные PostgreSQL-сессии, CSRF + строгий Origin, CSP, no-store,
rate limits, проверка authVersion и отзыв сессий должны сохраняться.
Каждую страницу/API защищать независимо. UI не является границей доступа. Расписание: OWNER/ADMIN — `/crm/schedule` и `/crm/visits`, TRAINER — `/trainer/lessons`; CRM- и trainer-POST-маршруты разделены по ролям.
Корень репозитория, `docs/`, исходники и секреты нельзя раздавать express.static.

## Интерфейс

HTML / EJS / SCSS / vanilla JS, BEM, без React. Основные формы и ссылки работают
без JavaScript. Уникальные стили — в SCSS соответствующей страницы, в патч
включать скомпилированный CSS. Без `!important`, `:root` и CSS custom properties.
Без маленьких тонких стрелок и стрелок в кружках. На тёмных кнопках светлый текст;
focus-visible, active scale(.98), reduced motion и мобильный адаптив обязательны.
Header/footer синхронизируются через `tools/sync_components.py`; Python для
просмотра через Go Live не нужен. Семь публичных страниц и их механики сохранять.
Демо-корзина/localStorage не являются источником CRM или реального магазина.

## Проверки этапа 12

Для этапа 12 добавлены `tests/schedule-dates.test.js` и `tests/schedule.test.js`; общий runner
применяет миграции только к отдельной `TEST_DATABASE_URL`, затем запускает старые и новые
наборы. Результаты текущего контейнера фиксируются в `docs/archive/SCHEDULE_ATTENDANCE_NOTES.txt`.
На Windows после распаковки обязательно заново выполнить `npm run db:deploy`, `npm run db:generate`,
`npm run db:status`, `npm test` и браузерную проверку desktop/mobile и режима без JavaScript.

## Подтверждённые проверки этапа 11

Пользователь: миграции dev/test успешны, схема актуальна, `npm test` 55/55 PASS
на Windows, сервер запущен, коммит `41b3e32` отправлен, рабочая папка чистая.
В контейнере этапа 11: 55/55 тестов; 94 Chromium-проверки, 0 page errors,
320/390/768/1440 px, JS включён/выключен; отдельная проверка сохранности
User/AuthSession/AuditEvent при миграции. Это результаты этапа 11, не новый прогон.
Реальные телефоны/Safari, TLS/Nginx и полная проверка публичных анимаций отдельно.

При переносе документации проверены состав патча, точность архивных копий и ссылки;
код, зависимости и БД не менялись. Полный npm test для переноса не запускался.

## Git

На компьютере папы: origin — `Dimas-Shumil/ideal`, upstream — `PabloAlligator/ideal`.
Перед коммитом:

```bat
git remote -v
git branch --show-current
git status --short --branch
git diff --check
```

Добавлять только файлы задачи. Проверить `git diff --cached --check` и
`git diff --cached --stat`, затем коммит на русском и `git push origin main`.
Не использовать reset/clean/force push для обычного завершения этапа.

## Проверки этапа 13

Наборы `tests/push.test.js` и `tests/push-sw.test.js` входят в `npm test`.
Worker тестируется через внедряемый transport без реальных сетевых рассылок.
Результаты текущего прогона и недоступные проверки — `archive/WEB_PUSH_STAGE13.md`.

## Общая навигация кабинетов

Меню OWNER/ADMIN/TRAINER формируется в `server/views/partials/panel-nav.ejs`.
Порядок един для всех страниц одной роли; текущий путь передаёт приложение в
`res.locals.currentPath`. Не копировать меню в отдельные шаблоны. Формы удаления
ошибочных записей описаны в `SCHEDULE.md`, доступны только OWNER и работают без JS.

## Этап 14 — магазин

Правила, ограничения и команды test → snapshot → dev-миграция: [SHOP.md](SHOP.md).
Нужен npm ci для busboy 1.6.0 и sharp 0.35.5 с optional-зависимостями текущей платформы.
Новых обязательных env-переменных нет. Фото входят в backup PostgreSQL.
Новая миграция 20261025000000_shop; старые четыре не изменены.
Прежние 100 тестов сохранены. Проверка списка таблиц и очистка тестовой БД расширены
магазином. Публичные страницы магазина создают гостевую сессию для HTML-форм с CSRF;
остальные публичные страницы не создают cookie. Новые наборы shop-unit.test.js и shop.test.js
включены в общий runner. Фактические результаты — archive/SHOP_STAGE14.md.

Итог контейнера этапа 14: npm test 121/121 PASS; Chromium 51 проверка с JS/без JS,
0 page errors; данные 19 прежних таблиц сохранены при миграции. Это Linux/PostgreSQL 16.15,
локальная приёмка Windows/PostgreSQL 18.6 и реальный Push остаются обязательными.
