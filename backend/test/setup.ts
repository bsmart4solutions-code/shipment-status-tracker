/**
 * Integration-test harness (Sprint 04, T-6).
 *
 * These tests boot the REAL Nest application and drive it over REAL HTTP
 * against a REAL Postgres. That is the entire point: Sprint 03 shipped two
 * defects — a `::uuid` cast that broke every row-locked operation, and a void
 * path returning 400 where the contract required 409 — which unit tests could
 * not catch because they stub `$queryRaw`. Anything that mocks Prisma here
 * defeats the purpose.
 *
 * Every request traverses the full pipeline: JwtAuthGuard -> PermissionsGuard
 * -> global ValidationPipe -> controller -> service -> Prisma -> database, with
 * the global exception filter mapping failures.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';

export const prisma = new PrismaClient();

/**
 * Boots the application exactly as `main.ts` does — same global pipe options,
 * same filter, same route prefix — so a test can never pass because the test
 * harness was more permissive than production.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  return app;
}

/** Log in through the real auth route and return a bearer token. */
export async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const request = (await import('supertest')).default;
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(201);
  return res.body.accessToken;
}

/**
 * Everything created by a test is tagged with this run id so cleanup is exact.
 *
 * Note on isolation: the plan's preferred mechanism is a transaction rolled
 * back per test, but the flows under test (invoice issue, note issue, vendor
 * bill approve/pay/reverse/void) open their OWN transactions with `FOR UPDATE`
 * row locks — they cannot be nested inside an outer test transaction without
 * changing the very behaviour being verified. So those suites use tagged
 * fixtures plus targeted cleanup instead. This is a deliberate, recorded
 * exception, not an oversight.
 */
export const RUN_TAG = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

export function tag(label: string): string {
  return `${RUN_TAG}:${label}`;
}

/** Remove every row this run created, in FK-safe order. */
export async function cleanupRun(): Promise<void> {
  const bills = await prisma.vendorBill.findMany({ where: { notes: { startsWith: RUN_TAG } }, select: { id: true } });
  const billIds = bills.map((b) => b.id);
  if (billIds.length) {
    await prisma.vendorPayment.deleteMany({ where: { billId: { in: billIds } } });
    await prisma.vendorBillItem.deleteMany({ where: { billId: { in: billIds } } });
    await prisma.vendorBill.deleteMany({ where: { id: { in: billIds } } });
  }

  const invoices = await prisma.invoice.findMany({ where: { notes: { startsWith: RUN_TAG } }, select: { id: true } });
  const invoiceIds = invoices.map((i) => i.id);
  if (invoiceIds.length) {
    const notes = await prisma.creditDebitNote.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } });
    const noteIds = notes.map((n) => n.id);
    if (noteIds.length) {
      await prisma.creditDebitNoteItem.deleteMany({ where: { noteId: { in: noteIds } } });
      await prisma.creditDebitNote.deleteMany({ where: { id: { in: noteIds } } });
    }
    await prisma.invoicePayment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }

  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...invoiceIds, ...billIds] } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-' } } });
  await prisma.customer.deleteMany({ where: { notes: { startsWith: RUN_TAG } } });
  await prisma.vendor.deleteMany({ where: { notes: { startsWith: RUN_TAG } } });
}

/** A customer created for this run, with optional credit configuration. */
export async function makeCustomer(opts: {
  label: string;
  creditLimit?: number | null;
  outstandingLimit?: number | null;
  creditHold?: boolean;
} ) {
  const code = `E2E-C-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  return prisma.customer.create({
    data: {
      code,
      companyName: `${opts.label} ${code}`,
      notes: tag(opts.label),
      creditLimit: opts.creditLimit ?? null,
      outstandingLimit: opts.outstandingLimit ?? null,
      creditHold: opts.creditHold ?? false,
    },
  });
}

/**
 * A user in a given role, for permission-boundary tests. Finance matters most:
 * it holds `invoices.write` but NOT `credit.override`, which is exactly the
 * separation D-7 requires — a user who can issue invoices still must not be
 * able to override a credit block.
 */
export async function makeUser(roleName: string, password = 'Admin@123') {
  const bcrypt = (await import('bcryptjs')).default;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const email = `e2e-${roleName.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@erp.local`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 10),
      fullName: `E2E ${roleName}`,
      roleId: role.id,
    },
  });
  return { ...user, password };
}

export async function makeVendor(label: string) {
  const code = `E2E-V-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  return prisma.vendor.create({
    data: { code, name: `${label} ${code}`, notes: tag(label), currency: 'MYR' },
  });
}
