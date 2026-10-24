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

После изменений схемы и получения новой миграции:

```bat
npm run db:deploy
npm run db:generate
npm run db:status
npm test
npm run dev
```

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
Каждую страницу/API защищать независимо. UI не является границей доступа.
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
