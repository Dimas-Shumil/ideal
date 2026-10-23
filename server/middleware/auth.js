export function loadUser(prisma) {
  return async (req, res, next) => {
    if (req.session?.userId) {
      const user = await prisma.user.findUnique({
        where: { id: req.session.userId },
        select: {
          id: true,
          login: true,
          displayName: true,
          role: true,
          active: true,
          authVersion: true,
        },
      });
      if (user?.active && user.authVersion === req.session.authVersion)
        req.user = user;
      else
        await new Promise((resolve, reject) =>
          req.session.destroy((e) => (e ? reject(e) : resolve())),
        );
    }
    next();
  };
}
export function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.originalUrl.startsWith("/api/"))
    return res.status(401).json({ error: "UNAUTHORIZED", requestId: req.id });
  res.redirect(303, "/login");
}
export const requireRole =
  (...roles) =>
  (req, res, next) =>
    req.user && roles.includes(req.user.role)
      ? next()
      : next(Object.assign(new Error("FORBIDDEN"), { status: 403 }));
