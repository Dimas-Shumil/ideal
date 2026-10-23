import session from "express-session";
import connectPg from "connect-pg-simple";
import { randomUUID } from "node:crypto";
const PgStore = connectPg(session);
// Lifecycle/pruning/destroy from connect-pg-simple. Narrow SQL adaptation adds
// explicit FK, absolute deadline and UPDATE-only authenticated writes. Never
// upsert authenticated snapshots: a concurrent logout/revoke must stay revoked.
export class AuthStore extends PgStore {
  constructor(pool, config) {
    super({
      pool,
      tableName: "AuthSession",
      createTableIfMissing: false,
      pruneSessionInterval: 60,
      errorLog: () => console.error("SESSION_STORE_ERROR"),
    });
    this.db = pool;
    this.config = config;
  }
  get(sid, cb) {
    this.db
      .query(
        `SELECT s.sess FROM "AuthSession" s LEFT JOIN "User" u ON u.id=s."userId"
      WHERE s.sid=$1 AND s.expire > now() AND s."absoluteAt" > now()
      AND (s."userId" IS NULL OR (u.active AND u."authVersion"=s."authVersion"))`,
        [sid],
      )
      .then((r) => cb(null, r.rows[0]?.sess || null), cb);
  }
  set(sid, sess, cb = () => {}) {
    const userId = sess.userId || null;
    if (userId) {
      this.db
        .query(
          `UPDATE "AuthSession" s SET sess=$2::json,
        expire=LEAST(now()+$3::double precision * interval '1 millisecond',s."absoluteAt")
        FROM "User" u WHERE s.sid=$1 AND s."userId"=$4::uuid AND u.id=s."userId"
        AND u.active AND u."authVersion"=s."authVersion" AND s."authVersion"=$5
        AND s.expire>now() AND s."absoluteAt">now()`,
          [
            sid,
            JSON.stringify(sess),
            this.config.idleMs,
            userId,
            sess.authVersion,
          ],
        )
        .then((r) => cb(r.rowCount ? null : new Error("SESSION_REVOKED")), cb);
    } else {
      const absolute = new Date(sess.preAuthAt + 900000);
      if (!Number.isFinite(+absolute)) return cb(new Error("INVALID_SESSION"));
      this.db
        .query(
          `INSERT INTO "AuthSession" (sid,sess,expire,"absoluteAt") VALUES ($1,$2::json,$3,$3)
        ON CONFLICT(sid) DO UPDATE SET sess=EXCLUDED.sess WHERE "AuthSession"."userId" IS NULL AND "AuthSession".expire>now()`,
          [sid, JSON.stringify(sess), absolute],
        )
        .then(() => cb(), cb);
    }
  }
  touch(sid, sess, cb = () => {}) {
    this.db
      .query(
        `UPDATE "AuthSession" SET expire=LEAST(now()+$2::double precision * interval '1 millisecond',"absoluteAt")
      WHERE sid=$1 AND "userId" IS NOT NULL AND expire>now()`,
        [sid, this.config.idleMs],
      )
      .then(() => cb(), cb);
  }
  async establish(sid, sess, user, requestId) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(681908,8)");
      const r = await client.query(
        'SELECT id FROM "User" WHERE id=$1 AND active AND "authVersion"=$2',
        [user.id, user.authVersion],
      );
      if (!r.rowCount) throw new Error("ACCESS_CHANGED");
      await client.query(
        `INSERT INTO "AuthSession" (sid,sess,expire,"absoluteAt","userId","authVersion")
        VALUES ($1,$2::json,LEAST(now()+$3::double precision * interval '1 millisecond',now()+$4::double precision * interval '1 millisecond'),now()+$4::double precision * interval '1 millisecond',$5,$6)`,
        [
          sid,
          JSON.stringify(sess),
          this.config.idleMs,
          this.config.absoluteMs,
          user.id,
          user.authVersion,
        ],
      );
      await client.query(
        'INSERT INTO "AuditEvent" (id,"actorId",action,"requestId") VALUES ($1,$2,$3,$4)',
        [randomUUID(), user.id, "LOGIN_SUCCESS", requestId],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
