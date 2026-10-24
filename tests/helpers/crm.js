// Only imported by suites whose test-only database guard runs before hooks.
export async function clearCrm(p) {
  await p.shopOrderEvent.deleteMany();
  await p.shopOrder.deleteMany();
  await p.shopImage.deleteMany();
  await p.shopVariant.deleteMany();
  await p.shopProduct.deleteMany();
  await p.scheduleEvent.deleteMany();
  await p.visit.deleteMany();
  await p.lessonBooking.deleteMany();
  await p.lesson.deleteMany();
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
