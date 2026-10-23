import { accessLock } from "../../db/client.js";
import { audit } from "../audit/service.js";
import { accountBody, password } from "../auth/schema.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
export function userService(prisma) {
  async function operator(tx, actorId, operatorHash, expectedVersion) {
    if (!actorId) return; // Only local operator CLI is allowed to omit actor.
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (
      !actor?.active ||
      actor.role !== "OWNER" ||
      actor.passwordHash !== operatorHash ||
      (expectedVersion !== undefined && actor.authVersion !== expectedVersion)
    )
      throw fail(403, "FORBIDDEN");
  }
  return {
    async create(
      input,
      {
        actorId = null,
        operatorHash = null,
        expectedVersion,
        bootstrap = false,
        requestId = null,
      } = {},
    ) {
      const data = accountBody.parse(input);
      const passwordHash = await hashPassword(data.password);
      return prisma.$transaction(async (tx) => {
        await accessLock(tx);
        await operator(tx, actorId, operatorHash, expectedVersion);
        if (bootstrap && (await tx.user.count()))
          throw fail(409, "BOOTSTRAP_CLOSED");
        if (bootstrap && data.role !== "OWNER")
          throw fail(400, "OWNER_REQUIRED");
        if (await tx.user.findUnique({ where: { login: data.login } }))
          throw fail(409, "DUPLICATE_LOGIN");
        const user = await tx.user.create({
          data: {
            login: data.login,
            displayName: data.displayName,
            role: data.role,
            passwordHash,
          },
        });
        await audit(tx, bootstrap ? "OWNER_BOOTSTRAP" : "USER_CREATED", {
          actorId,
          targetId: user.id,
          requestId,
        });
        return { id: user.id, login: user.login, role: user.role };
      });
    },
    async change(
      id,
      changes,
      {
        actorId = null,
        operatorHash = null,
        expectedVersion,
        requestId = null,
        self = false,
      } = {},
    ) {
      const allowed = Object.keys(changes);
      if (
        !allowed.length ||
        allowed.some(
          (k) => !["password", "role", "active", "displayName"].includes(k),
        )
      )
        throw fail(400, "INVALID_FIELDS");
      if ("active" in changes && typeof changes.active !== "boolean")
        throw fail(400, "INVALID_ACTIVE");
      if (
        "role" in changes &&
        !["OWNER", "ADMIN", "TRAINER"].includes(changes.role)
      )
        throw fail(400, "INVALID_ROLE");
      if (
        "displayName" in changes &&
        (typeof changes.displayName !== "string" ||
          !changes.displayName.trim() ||
          changes.displayName.trim().length > 100)
      )
        throw fail(400, "INVALID_NAME");
      const data = { ...changes };
      if ("displayName" in data) data.displayName = data.displayName.trim();
      if ("password" in data) {
        data.passwordHash = await hashPassword(password.parse(data.password));
        delete data.password;
      }
      return prisma.$transaction(async (tx) => {
        await accessLock(tx);
        if (!self) await operator(tx, actorId, operatorHash, expectedVersion);
        const user = await tx.user.findUnique({ where: { id } });
        if (!user) throw fail(404, "NOT_FOUND");
        if (
          self &&
          (actorId !== id ||
            !user.active ||
            (expectedVersion !== undefined && user.authVersion !== expectedVersion) ||
            user.passwordHash !== operatorHash ||
            allowed.length !== 1 ||
            allowed[0] !== "password")
        )
          throw fail(403, "FORBIDDEN");
        if (
          user.active &&
          user.role === "OWNER" &&
          (data.active === false || (data.role && data.role !== "OWNER")) &&
          (await tx.user.count({ where: { active: true, role: "OWNER" } })) <= 1
        )
          throw fail(409, "LAST_OWNER");
        const revoke = allowed.some((key) => key !== "displayName");
        await tx.user.update({
          where: { id },
          data: {
            ...data,
            ...(revoke ? { authVersion: { increment: 1 } } : {}),
          },
        });
        if (revoke) await tx.authSession.deleteMany({ where: { userId: id } });
        for (const key of allowed)
          await audit(tx, `USER_${key.toUpperCase()}_CHANGED`, {
            actorId,
            targetId: id,
            requestId,
          });
      });
    },
    async confirmOwner(login, plain) {
      const user = await prisma.user.findUnique({ where: { login } });
      if (
        !user?.active ||
        user.role !== "OWNER" ||
        !(await verifyPassword(user.passwordHash, plain))
      )
        throw fail(403, "FORBIDDEN");
      return { actorId: user.id, operatorHash: user.passwordHash };
    },
  };
}
