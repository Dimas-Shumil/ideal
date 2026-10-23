import argon2 from "argon2";
// Bounded work protects the process from unbounded concurrent Argon allocations.
let busy = 0;
async function limited(work) {
  if (busy >= 2) {
    const e = new Error("AUTH_BUSY");
    e.status = 503;
    throw e;
  }
  busy++;
  try {
    return await work();
  } finally {
    busy--;
  }
}
const options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};
export const hashPassword = (value) =>
  limited(() => argon2.hash(value, options));
export const verifyPassword = (hash, value) =>
  limited(() => argon2.verify(hash, value));
