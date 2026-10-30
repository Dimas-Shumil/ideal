# ИДЕАЛ — товары магазина на главной, 30.10.2026

## Поведение

Главная `/` получает опубликованные (`active=true`) товары через существующий `shopService.catalog({})`, как магазин. В галерее — первая страница каталога: до 24 товаров в том же порядке по названию. Остальные доступны по ссылке «Перейти в магазин». Параметры URL главной не фильтруют её галерею.

Фото, наименование, категория, описание и минимальная цена активных вариантов берутся из каталога. Кнопка ведёт на страницу выбранного товара, где покупатель выбирает вариант. Товары без фотографии используют существующий shop-placeholder.svg; без активных вариантов показывается «Варианты ожидаются», как прежде в шаблоне реальной витрины. Публикация, редактирование, скрытие и удаление отражаются после следующей загрузки главной.

Если опубликованных товаров нет — секции спортпита целиком нет в HTML. Не остаются заголовок, пустая карусель, заглушка ассортимента или демонстрационные упаковки. Магазин `/shop.html` остаётся доступен. С одним товаром карточка по центру, переключатели отключены. С несколькими сохраняются Coverflow, кнопки, клавиатура и обработчики жестов.

В index.html оставлена точка серверной вставки. Самостоятельное открытие этого файла через Go Live не подключает PostgreSQL: для реальных товаров запускать существующий Express через npm run dev. Демонстрационный demo-products.js больше не подключается к главной. Старые файлы демонстрационных иллюстраций не удаляются и в патч не включены.

CSS/SCSS, общие компоненты, логотип, PWA-манифест, Service Worker, VAPID, .env, Prisma и package-lock не изменены. JS карусели подключается с новой версией URL, чтобы браузер получил обновлённую логику.

## Проверки

36 проверок прошли:
- 5 новых: HTTP-поведение пустого и скрытого каталога; реальные фото/цены/ссылки; изменения публикации между запросами; один товар/экранирование текста/отсутствие вариантов; переключение данных и ссылок кнопками и клавиатурой.
- 28: CMS, магазинные unit-проверки, PWA/установка/PUSH SW и static-site-and-photos.
- 3: выбранные проверки мобильного header, карусели абонементов и отсутствия статичных демотоваров главной.

HTTP-тесты используют реальный Express-роут и EJS с подставным источником данных, без PostgreSQL. Интеграционная проверка tests/shop.test.js обновлена под новое поведение, но полный прогон с отдельной тестовой PostgreSQL не выполнялся. Production-база не использовалась. Новый тест включён в существующий tools/run-tests.mjs.

Проверка путей логотипа также прошла. Скриншотная проверка в браузере не выполнялась; адаптивные стили галереи не менялись. Ранее существующие несвязанные сбои проверки фиксированного телефона не исправлялись.

## Локальная установка — Windows CMD

Открыть CMD в существующем проекте:

```bat
cd /d "C:\Users\Павел.DESKTOP-JFFFGLC\Work\box\Ideal"
git remote -v
git branch --show-current
git status --short --branch
```

Ожидаем свой репозиторий IDEAL, main и чистое дерево после предыдущего коммита логотипа. При наличии своих изменений сначала сохранить/разобрать их. Не применять reset или clean.

Сохранить ZIP в Downloads под точным именем IDEAL_HOME_NUTRITION_CATALOG_20261030.zip. Распаковать:

```bat
powershell -NoProfile -Command "Expand-Archive -LiteralPath (Join-Path $env:USERPROFILE 'Downloads\IDEAL_HOME_NUTRITION_CATALOG_20261030.zip') -DestinationPath (Get-Location).Path -Force"
node --check server/modules/shop/routes.js
node --check site/scripts/nutrition.js
node --test tests/home-nutrition.test.js
git diff --check
git diff --stat
npm run dev
```

Действующие node_modules и сгенерированный Prisma Client уже должны присутствовать в запущенном проекте. Для этого патча npm ci, prisma generate и миграции не требуются. Проверить главную при текущем состоянии каталога. Изменения товаров для проверки делать только в своей локальной базе; если локальный .env указывает на production, не изменять товары ради проверки. Остановить dev: Ctrl+C.

Коммит и push:

```bat
git add --pathspec-from-file=docs/HOME_NUTRITION_PATCH_FILES.txt
git diff --cached --stat
git diff --cached --check
git commit -m "fix: render homepage nutrition from live shop catalog"
git push origin main
git status --short --branch
```

## Выкладка на VPS

Из текущего root-подключения к cv8241727. Реальный проект: /var/www/ideal; origin: https://github.com/PabloAlligator/ideal.git; PM2-процесс: ideal. Сначала проверить:

```sh
cd /var/www/ideal
git remote -v
git status --short --branch
pm2 list
git fetch origin
git diff --stat HEAD origin/main
```

Если remote другой, есть локальные изменения или входящий diff содержит посторонние изменения — остановиться, не выполнять reset/restore. В ожидаемом diff только файлы HOME_NUTRITION_PATCH_FILES.txt.

После проверки и успешного push с компьютера:

```sh
(
set -eu
cd /var/www/ideal
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
git merge --ff-only origin/main
node --check server/modules/shop/routes.js
node --check site/scripts/nutrition.js
test -s server/views/shop/nutrition.ejs
pm2 restart ideal
curl -fsS --connect-timeout 2 --max-time 5 --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:3000/health/ready
printf '\n'
curl -fsS --connect-timeout 5 --max-time 15 --retry 3 --retry-delay 1 https://ideal-abakan.ru/health/ready
printf '\n'
curl -fsS --connect-timeout 5 --max-time 15 -o /dev/null -w 'HOME HTTP %{http_code}\n' https://ideal-abakan.ru/
git status --short --branch
)
```

Перезапуск обязателен: меняется серверный обработчик главной и считываемый при запуске index.html. Возможен короткий перерыв; curl дожидается готовности. pm2 save для обычного перезапуска существующего процесса не требуется. Не использовать tools/deploy-brand.mjs: он ограничен прежним патчем логотипа.

Финальная проверка новой версии JS на странице:

```sh
curl -fsS --max-time 15 https://ideal-abakan.ru/ | grep -F 'nutrition.js?v=catalog-20261030'
```

Открыть https://ideal-abakan.ru/ с Ctrl+F5. На телефоне обновить страницу. При пустом каталоге отсутствие блока — ожидаемый результат. БД и аккаунты не удаляются; миграций, seed, изменений .env, Nginx, SSH, PM2-конфигурации и PUSH-подписок нет.
