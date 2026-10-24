// Explicit local operator action. Never called at startup, in tests, or from HTTP.
import webpush from "web-push";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const target = process.argv[2];
const root = fileURLToPath(new URL("../", import.meta.url));
const relative = target ? path.relative(root, path.resolve(target)) : "";
if (!target || !/\.env$/.test(target) || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) {
  console.error('Укажите путь нового приватного .env-файла вне репозитория. Существующие файлы не перезаписываются.');
  process.exit(1);
}
const keys = webpush.generateVAPIDKeys();
try {
  await writeFile(target, `PUSH_PUBLIC_KEY=${keys.publicKey}\nPUSH_PRIVATE_KEY=${keys.privateKey}\nPUSH_SUBJECT=\n`, { flag: "wx", mode: 0o600 });
  console.log("Ключи сохранены в указанном файле. Перенесите их в серверное окружение, заполните PUSH_SUBJECT и храните файл приватно.");
} catch { console.error("Не удалось сохранить ключи. Проверьте путь; существующие файлы не перезаписываются."); process.exitCode = 1; }
