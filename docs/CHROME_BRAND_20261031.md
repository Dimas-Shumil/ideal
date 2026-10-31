# ИДЕАЛ — серебристый хромовый логотип

Распаковать ZIP в корень проекта с заменой файлов.

Заменены логотипы на публичных страницах, в хедере/футере, входе, рабочих кабинетах, плашке установки, favicon, PWA/Apple/maskable, PUSH-иконке и SEO/OG. Новые ссылки используют v2. Старые изображения тоже обновлены для совместимости.

PNG/WebP интерфейса имеют прозрачный фон. Иконки приложения — графитовый фон. Favicon использует знак без мелкой надписи. Мастер: site/img/brand/ideal-logo-master-v2.png.

## Локально — Windows CMD

```bat
node tools/check-brand.mjs
node --test tests/home-nutrition.test.js tests/content-unit.test.js tests/pwa-install.test.js tests/pwa.test.js tests/push-sw.test.js tests/seo.test.js tests/static-site-and-photos.test.js
npm run dev
```

Проверить главную, магазин, вход, кабинеты и иконку вкладки; Ctrl+F5. Зависимости, схема БД и CSS не менялись. npm ci, Prisma и миграции не нужны.

Перед коммитом завершить npm run dev (Ctrl+C):

```bat
git remote -v
git status --short --branch
git diff --check
git add --pathspec-from-file=docs/CHROME_BRAND_PATCH_FILES.txt
git diff --cached --stat
git diff --cached --check
git commit -m "feat: apply silver chrome IDEAL brand across site and PWA"
git push origin main
```

На компьютере папы origin может быть Dimas-Shumil, а на сервере origin — PabloAlligator. Чтобы сервер получил коммит, отправить его также в соответствующий remote после проверки адресов (если PabloAlligator здесь upstream — git push upstream main). При non-fast-forward не применять force; сначала сверить историю.

## Сервер

Сначала проверить remote, main и чистую рабочую папку:

```sh
cd /var/www/ideal
git remote -v
git status --short --branch
```

После успешной отправки коммита в репозиторий сервера:

```sh
(
set -eu
cd /var/www/ideal
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
git pull --ff-only origin main
node tools/check-brand.mjs
pm2 restart ideal
curl -fsS --connect-timeout 2 --max-time 5 --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:3000/health/ready
printf '\n'
curl -fsS --max-time 15 --retry 3 --retry-delay 1 https://ideal-abakan.ru/health/ready
printf '\n'
)
```

Иконка уже установленной PWA может обновиться с задержкой на стороне браузера/ОС. Не нужно удалять приложение, worker или PUSH-подписки. Закрыть все вкладки/окна приложения и открыть снова для штатного обновления worker. Идентификатор, start_url, scope и регистрация приложения сохранены.

## Проверки

35 целевых тестов прошли: каталог главной, CMS, установка PWA, worker, PUSH и SEO. Проверены прозрачность, светлый/тёмный фон, размеры PNG, ссылки, ICO, безопасная зона maskable и компиляция EJS.

В расширенном наборе 39/42 прошли. Три проверки фиксированного телефона/кнопки звонка также падают на исходном архиве до патча. Связанные файлы и эти тесты не менялись. Полный прогон с PostgreSQL не запускался.
