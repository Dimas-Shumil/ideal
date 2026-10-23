import { input, password, select, confirm } from "@inquirer/prompts";
import { readConfig } from "../server/config/env.js";
import { createDatabase } from "../server/db/client.js";
import { userService } from "../server/modules/users/service.js";
import {
  loginName,
  password as passwordSchema,
} from "../server/modules/auth/schema.js";
export async function runCli(operation) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      "Нужен интерактивный терминал. Пароли через аргументы/pipe не принимаются.",
    );
    process.exitCode = 1;
    return;
  }
  if (process.argv.length !== 2) {
    console.error(
      "Аргументы не принимаются. Используйте интерактивные вопросы.",
    );
    process.exitCode = 1;
    return;
  }
  let db;
  try {
    const config = readConfig();
    db = createDatabase(config.DATABASE_URL);
    const users = userService(db.prisma);
    if (operation === "bootstrap") {
      if (await db.prisma.user.count()) throw new Error("BOOTSTRAP_CLOSED");
      const login = loginName.parse(
        await input({ message: "Логин первого владельца:" }),
      );
      const displayName = await input({ message: "Имя владельца:" });
      const secret = await newPassword();
      await users.create(
        { login, displayName, role: "OWNER", password: secret },
        { bootstrap: true },
      );
      console.log("Первый владелец создан.");
    } else if (operation === "reset") {
      console.log(
        "Локальное восстановление оператором ShumDev. Все сессии аккаунта будут отозваны.",
      );
      const login = loginName.parse(
        await input({ message: "Логин восстанавливаемого аккаунта:" }),
      );
      const user = await db.prisma.user.findUnique({ where: { login } });
      if (!user) throw new Error("NOT_FOUND");
      if (
        !(await confirm({
          message: "Подтверждаете сброс доступа?",
          default: false,
        }))
      )
        return;
      await users.change(user.id, { password: await newPassword() });
      console.log(
        "Пароль изменён, сессии отозваны. Активность и роль не изменялись.",
      );
    } else {
      const owner = loginName.parse(
        await input({ message: "Ваш логин владельца:" }),
      );
      const credentials = await users.confirmOwner(
        owner,
        await password({ message: "Ваш пароль:", mask: false }),
      );
      const action = await select({
        message: "Действие:",
        choices: [
          { name: "Создать сотрудника", value: "create" },
          { name: "Изменить роль", value: "role" },
          { name: "Активировать / отключить", value: "active" },
        ],
      });
      const login = loginName.parse(
        await input({ message: "Логин сотрудника:" }),
      );
      if (action === "create") {
        const displayName = await input({ message: "Имя сотрудника:" });
        const role = await pickRole();
        if (
          role === "OWNER" &&
          !(await confirm({
            message: "Предоставить полные права владельца?",
            default: false,
          }))
        )
          return;
        await users.create(
          { login, displayName, role, password: await newPassword() },
          credentials,
        );
      } else {
        const user = await db.prisma.user.findUnique({ where: { login } });
        if (!user) throw new Error("NOT_FOUND");
        const changes =
          action === "role"
            ? { role: await pickRole() }
            : {
                active: await confirm({
                  message: "Аккаунт должен быть активен?",
                  default: user.active,
                }),
              };
        if (
          !(await confirm({
            message: "Применить изменение и отозвать все сессии сотрудника?",
            default: false,
          }))
        )
          return;
        await users.change(user.id, changes, credentials);
      }
      console.log("Изменение выполнено.");
    }
  } catch (e) {
    const known = {
      LAST_OWNER:
        "Нельзя отключить или понизить последнего активного владельца.",
      BOOTSTRAP_CLOSED:
        "Первичная настройка уже завершена. Используйте user:manage.",
      NOT_FOUND: "Аккаунт не найден.",
      FORBIDDEN: "Не удалось подтвердить права владельца.",
    };
    console.error(
      known[e.message] ||
        (e.code === "P2002"
          ? "Этот логин уже занят."
          : "Операция отменена или не выполнена. Проверьте ввод, конфигурацию и БД."),
    );
    process.exitCode = 1;
  } finally {
    if (db) await db.close();
  }
}
async function newPassword() {
  const value = await password({
    message: "Новый пароль (12–128 символов, максимум 256 байт):",
    mask: false,
  });
  passwordSchema.parse(value);
  if (value !== (await password({ message: "Повторите пароль:", mask: false })))
    throw new Error("MISMATCH");
  return value;
}
const pickRole = () =>
  select({
    message: "Роль:",
    choices: [
      { name: "Тренер", value: "TRAINER" },
      { name: "Администратор", value: "ADMIN" },
      { name: "Владелец", value: "OWNER" },
    ],
  });
