// Only imported by suites whose test-only database guard runs before hooks.
export async function clearCrm(p) {
  await p.crmOperation.deleteMany();
  await p.crmEvent.deleteMany();
  await p.membershipRefund.deleteMany();
  await p.membershipFreeze.deleteMany();
  await p.membership.deleteMany();
  await p.membershipPurchase.deleteMany();
  await p.membershipPlan.deleteMany();
  await p.trainerAssignment.deleteMany();
  await p.trainerProfile.deleteMany();
  await p.client.deleteMany();
}
