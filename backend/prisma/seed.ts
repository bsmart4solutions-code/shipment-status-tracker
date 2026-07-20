/**
 * Seed data: roles + permissions, admin user, service catalog, demo
 * customers/vendors/rates/quotations/jobs, exchange rates, sequences,
 * and default settings (rating weights, alert thresholds).
 */
import { PrismaClient, RateType, QuotationStatus, JobStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_COMPANY_PROFILE } from '../src/modules/settings/company.default';

const prisma = new PrismaClient();

const PERMISSION_GROUPS = [
  'customers', 'vendors', 'services', 'rates', 'quotations', 'jobs',
  'ratings', 'reports', 'dashboard', 'settings', 'users', 'notifications',
  'invoices', 'recycle', 'approvals',
];

const ROLE_MATRIX: Record<string, string[]> = {
  Administrator: ['*'],
  Manager: [
    'customers.read', 'customers.write', 'vendors.read', 'vendors.write',
    'services.read', 'services.write', 'rates.read', 'rates.write',
    'quotations.read', 'quotations.write', 'jobs.read', 'jobs.write',
    'ratings.read', 'ratings.write', 'reports.read', 'dashboard.read',
    'notifications.read', 'invoices.read', 'invoices.write',
    'recycle.read', 'recycle.write', 'approvals.read', 'approvals.write',
  ],
  Sales: [
    'customers.read', 'customers.write', 'vendors.read', 'services.read',
    'rates.read', 'quotations.read', 'quotations.write', 'jobs.read',
    'ratings.read', 'dashboard.read', 'notifications.read', 'invoices.read',
  ],
  Operation: [
    'customers.read', 'vendors.read', 'services.read', 'rates.read',
    'quotations.read', 'jobs.read', 'jobs.write', 'ratings.read',
    'ratings.write', 'dashboard.read', 'notifications.read',
  ],
  Finance: [
    'customers.read', 'vendors.read', 'services.read', 'rates.read',
    'quotations.read', 'jobs.read', 'reports.read', 'dashboard.read',
    'notifications.read', 'invoices.read', 'invoices.write',
  ],
  Viewer: [
    'customers.read', 'vendors.read', 'services.read', 'rates.read',
    'quotations.read', 'jobs.read', 'dashboard.read', 'notifications.read',
    'invoices.read',
  ],
};

const SERVICES = [
  'Air Freight', 'Sea Freight', 'Land Transport', 'Custom Clearance',
  'Packing', 'Forklift', 'Crane', 'Storage', 'Courier', 'Documentation',
  'Insurance', 'Permit',
];

async function main() {
  // ── Permissions & roles ─────────────────────────────────────────
  const permRecords: { code: string; label: string }[] = [];
  for (const g of PERMISSION_GROUPS) {
    permRecords.push({ code: `${g}.read`, label: `Read ${g}` });
    permRecords.push({ code: `${g}.write`, label: `Write ${g}` });
  }
  for (const p of permRecords) {
    await prisma.permission.upsert({ where: { code: p.code }, update: {}, create: p });
  }
  const allPerms = await prisma.permission.findMany();

  for (const [roleName, permCodes] of Object.entries(ROLE_MATRIX)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, isSystem: true, description: `${roleName} role` },
    });
    const wanted = permCodes.includes('*') ? allPerms : allPerms.filter((p) => permCodes.includes(p.code));
    for (const p of wanted) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        update: {},
        create: { roleId: role.id, permissionId: p.id },
      });
    }
  }

  // ── Users ────────────────────────────────────────────────────────
  // This repo is public, so the demo password below is public knowledge —
  // never let it reach a real deployment. Production must supply its own
  // SEED_ADMIN_PASSWORD (Render: set via generateValue in render.yaml);
  // dev/test keep the documented demo login unless overridden.
  const seedPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) {
    throw new Error(
      'Refusing to seed production with the public demo password — set SEED_ADMIN_PASSWORD.'
    );
  }
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Administrator' } });
  const salesRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Sales' } });
  const hash = await bcrypt.hash(seedPassword, 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@erp.local' },
    update: {},
    create: { email: 'admin@erp.local', passwordHash: hash, fullName: 'System Administrator', roleId: adminRole.id },
  });
  const sales = await prisma.user.upsert({
    where: { email: 'sales@erp.local' },
    update: {},
    create: { email: 'sales@erp.local', passwordHash: hash, fullName: 'Sarah Sales', roleId: salesRole.id },
  });

  // ── Sequences (configurable auto-numbering) ─────────────────────
  const sequences = [
    { key: 'customer', prefix: 'CUST', padding: 4, includeYear: false },
    { key: 'vendor', prefix: 'VEN', padding: 4, includeYear: false },
    { key: 'service', prefix: 'SVC', padding: 4, includeYear: false },
    { key: 'quotation', prefix: 'QT', padding: 4, includeYear: true },
    { key: 'job', prefix: 'JOB', padding: 4, includeYear: true },
    { key: 'invoice', prefix: 'INV', padding: 4, includeYear: true },
    { key: 'creditNote', prefix: 'CN', padding: 4, includeYear: true },
    { key: 'debitNote', prefix: 'DN', padding: 4, includeYear: true },
  ];
  for (const s of sequences) {
    await prisma.sequence.upsert({ where: { key: s.key }, update: {}, create: s });
  }

  // ── Settings: rating weights & alert thresholds ─────────────────
  const settings: Record<string, unknown> = {
    'rating.vendor.weights': {
      price: 25, serviceQuality: 20, communication: 10,
      deliveryPerformance: 20, reliability: 15, responseSpeed: 10,
    },
    'rating.customer.weights': {
      paymentSpeed: 25, profitability: 25, repeatBusiness: 15,
      communication: 10, complaintHistory: 10, businessPotential: 15,
    },
    'alerts.lowMarginPct': 10,
    'alerts.highCostAmount': 50000,
    'alerts.quotationExpiryDays': 7,
    'alerts.rateExpiryDays': 14,
    'company.profile': DEFAULT_COMPANY_PROFILE,
    'quotation.defaults': { markupPct: 20, taxPct: 6, validityDays: 30 },
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.settingKV.upsert({ where: { key }, update: {}, create: { key, value: value as any } });
  }

  // ── Exchange rates (to MYR base examples) ───────────────────────
  const fx = [
    { baseCurrency: 'USD', quoteCurrency: 'MYR', rate: 4.45 },
    { baseCurrency: 'SGD', quoteCurrency: 'MYR', rate: 3.3 },
    { baseCurrency: 'EUR', quoteCurrency: 'MYR', rate: 4.85 },
    { baseCurrency: 'CNY', quoteCurrency: 'MYR', rate: 0.62 },
    { baseCurrency: 'MYR', quoteCurrency: 'USD', rate: 0.2247 },
  ];
  for (const f of fx) {
    const eff = new Date('2026-01-01');
    await prisma.exchangeRate.upsert({
      where: { baseCurrency_quoteCurrency_effectiveDate: { baseCurrency: f.baseCurrency, quoteCurrency: f.quoteCurrency, effectiveDate: eff } },
      update: { rate: f.rate },
      create: { ...f, effectiveDate: eff },
    });
  }

  // ── Service catalog ──────────────────────────────────────────────
  const serviceIds: Record<string, string> = {};
  let svcNo = 1;
  for (const name of SERVICES) {
    const svc = await prisma.service.upsert({
      where: { name },
      update: {},
      create: { name, code: `SVC-${String(svcNo).padStart(4, '0')}` },
    });
    serviceIds[name] = svc.id;
    svcNo++;
  }
  await prisma.sequence.update({ where: { key: 'service' }, data: { nextValue: svcNo } });

  // Stop here if demo data already present (idempotent seed)
  if (await prisma.customer.count() > 0) {
    console.log('Demo data already exists — skipped demo records.');
    return;
  }

  // ── Demo customers ───────────────────────────────────────────────
  const cust1 = await prisma.customer.create({
    data: {
      code: 'CUST-0001', companyName: 'Sunrise Electronics Sdn. Bhd.', pic: 'Mei Ling',
      phone: '+60 3-2168 0001', email: 'ops@sunrise-elec.com', address: 'Shah Alam, Selangor',
      industry: 'Electronics', paymentTerm: 'NET 30', creditLimit: 250000, priority: 1,
    },
  });
  const cust2 = await prisma.customer.create({
    data: {
      code: 'CUST-0002', companyName: 'Golden Harvest Trading Ltd.', pic: 'W. Chen',
      phone: '+852 2555 0123', email: 'chen@goldenharvest.hk', address: 'Kwai Chung, Hong Kong',
      industry: 'Commodities', paymentTerm: 'NET 45', creditLimit: 150000, priority: 2,
    },
  });
  await prisma.sequence.update({ where: { key: 'customer' }, data: { nextValue: 3 } });

  // ── Demo vendors ─────────────────────────────────────────────────
  const ven1 = await prisma.vendor.create({
    data: {
      code: 'VEN-0001', name: 'SwiftAir Cargo Sdn. Bhd.', contactPerson: 'Rahman',
      phone: '+60 3-8787 1100', email: 'rates@swiftair.my', paymentTerm: 'NET 30', isPreferred: true,
    },
  });
  const ven2 = await prisma.vendor.create({
    data: {
      code: 'VEN-0002', name: 'BlueOcean Shipping Lines', contactPerson: 'Tan CK',
      phone: '+60 3-3161 2200', email: 'quote@blueocean.com', paymentTerm: 'NET 60',
    },
  });
  const ven3 = await prisma.vendor.create({
    data: {
      code: 'VEN-0003', name: 'KL Express Haulage', contactPerson: 'Suresh',
      phone: '+60 12-556 7788', email: 'ops@klexpress.my', paymentTerm: 'CASH',
    },
  });
  await prisma.sequence.update({ where: { key: 'vendor' }, data: { nextValue: 4 } });

  // ── Demo vendor rates (Air Freight KUL→KCH comparison scenario) ──
  const air = serviceIds['Air Freight'];
  const sea = serviceIds['Sea Freight'];
  const land = serviceIds['Land Transport'];
  const ccl = serviceIds['Custom Clearance'];
  const mkRate = (data: any) => prisma.vendorServiceRate.create({ data });
  await mkRate({ vendorId: ven1.id, serviceId: air, origin: 'Kuala Lumpur', destination: 'Kuching', country: 'Malaysia', state: 'Sarawak', rateType: RateType.PER_KG, currency: 'MYR', cost: 2.8, minimumCharge: 180, effectiveDate: new Date('2026-01-01'), expiryDate: new Date('2026-12-31') });
  await mkRate({ vendorId: ven2.id, serviceId: air, origin: 'Kuala Lumpur', destination: 'Kuching', country: 'Malaysia', state: 'Sarawak', rateType: RateType.PER_KG, currency: 'MYR', cost: 2.45, minimumCharge: 250, effectiveDate: new Date('2026-01-01'), expiryDate: new Date('2026-09-30') });
  await mkRate({ vendorId: ven1.id, serviceId: air, origin: 'Kuala Lumpur', destination: 'Kuching', country: 'Malaysia', state: 'Sarawak', rateType: RateType.PER_KG, currency: 'MYR', cost: 3.1, minimumCharge: 180, effectiveDate: new Date('2025-01-01'), expiryDate: new Date('2025-12-31') }); // historical
  await mkRate({ vendorId: ven2.id, serviceId: sea, origin: 'Port Klang', destination: 'Kuching', country: 'Malaysia', rateType: RateType.PER_CONTAINER, currency: 'MYR', cost: 1650, effectiveDate: new Date('2026-01-01'), expiryDate: new Date('2026-12-31') });
  await mkRate({ vendorId: ven3.id, serviceId: land, origin: 'Kuala Lumpur', destination: 'Penang', country: 'Malaysia', rateType: RateType.PER_TRIP, currency: 'MYR', cost: 850, effectiveDate: new Date('2026-01-01') });
  await mkRate({ vendorId: ven3.id, serviceId: ccl, origin: 'Port Klang', destination: '', country: 'Malaysia', rateType: RateType.PER_SHIPMENT, currency: 'MYR', cost: 380, effectiveDate: new Date('2026-01-01') });

  // ── Demo ratings ─────────────────────────────────────────────────
  await prisma.vendorRating.create({
    data: {
      vendorId: ven1.id, ratedById: admin.id, price: 4, serviceQuality: 5, communication: 4,
      deliveryPerformance: 5, reliability: 5, responseSpeed: 4, overallScore: 4.55, comment: 'Consistently reliable',
    },
  });
  await prisma.vendorRating.create({
    data: {
      vendorId: ven2.id, ratedById: admin.id, price: 5, serviceQuality: 3, communication: 3,
      deliveryPerformance: 3, reliability: 4, responseSpeed: 3, overallScore: 3.6, comment: 'Cheap but slow response',
    },
  });
  await prisma.customerRating.create({
    data: {
      customerId: cust1.id, ratedById: admin.id, paymentSpeed: 5, profitability: 4, repeatBusiness: 5,
      communication: 4, complaintHistory: 5, businessPotential: 5, overallScore: 4.6,
    },
  });

  // ── Demo quotation (WON) + job ───────────────────────────────────
  const q1 = await prisma.quotation.create({
    data: {
      quoteNumber: 'QT-2026-0001', customerId: cust1.id, salesPersonId: sales.id,
      quoteDate: new Date('2026-05-10'), validityDate: new Date('2026-06-10'),
      currency: 'MYR', status: QuotationStatus.WON,
      totalCost: 1540, subtotalSell: 1980, sellingPrice: 2138.4, taxPct: 8, taxAmt: 158.4,
      grossProfit: 440, gpPercent: 22.22,
      items: {
        create: [
          { serviceId: air, vendorId: ven1.id, description: 'Air freight 500kg KUL-KCH', quantity: 500, unit: 'KG', costCurrency: 'MYR', fxRate: 1, unitCost: 2.8, markupPct: 25, unitSell: 3.5, totalCost: 1400, totalSell: 1750, grossProfit: 350, gpPercent: 20, sortOrder: 1 },
          { serviceId: ccl, vendorId: ven3.id, description: 'Export clearance', quantity: 1, unit: 'SHPT', costCurrency: 'MYR', fxRate: 1, unitCost: 140, markupPct: 64.29, unitSell: 230, totalCost: 140, totalSell: 230, grossProfit: 90, gpPercent: 39.13, sortOrder: 2 },
        ],
      },
    },
  });
  await prisma.quotation.create({
    data: {
      quoteNumber: 'QT-2026-0002', customerId: cust2.id, salesPersonId: sales.id,
      quoteDate: new Date('2026-06-02'), validityDate: new Date('2026-07-02'),
      currency: 'MYR', status: QuotationStatus.SENT,
      totalCost: 1650, subtotalSell: 2100, sellingPrice: 2268, taxPct: 8, taxAmt: 168,
      grossProfit: 450, gpPercent: 21.43,
      items: {
        create: [
          { serviceId: sea, vendorId: ven2.id, description: '20ft container PKL-KCH', quantity: 1, unit: 'CONT', costCurrency: 'MYR', fxRate: 1, unitCost: 1650, markupPct: 27.27, unitSell: 2100, totalCost: 1650, totalSell: 2100, grossProfit: 450, gpPercent: 21.43, sortOrder: 1 },
        ],
      },
    },
  });
  await prisma.sequence.update({ where: { key: 'quotation' }, data: { nextValue: 3, yearScope: 2026 } });

  await prisma.job.create({
    data: {
      jobNumber: 'JOB-2026-0001', customerId: cust1.id, quotationId: q1.id,
      shipmentDate: new Date('2026-05-20'), etd: new Date('2026-05-20'), eta: new Date('2026-05-21'),
      origin: 'Kuala Lumpur', destination: 'Kuching', vendorId: ven1.id,
      trackingNumber: 'SWA-889123', status: JobStatus.COMPLETED,
      // actualRevenue is net of SST (quote grand 2138.40 − tax 158.40)
      actualCost: 1585, actualRevenue: 1980, profit: 395, currency: 'MYR',
    },
  });
  await prisma.sequence.update({ where: { key: 'job' }, data: { nextValue: 2, yearScope: 2026 } });

  console.log('Seed complete. Login: admin@erp.local / Admin@123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
