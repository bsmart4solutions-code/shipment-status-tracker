import { INestApplication } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import request from 'supertest';
import { cleanupRun, createTestApp, login, makeCustomer, makeVendor, prisma, tag } from './setup';

/**
 * Polymorphic attachments (AP_ARCHITECTURE_DECISION §7), over real HTTP.
 *
 * The case that justifies this file existing is the cross-type one. §7.3
 * accepted losing the foreign key, which means `entityId` is just a string and
 * nothing at the database level stops a customer route from serving a vendor's
 * row. The only thing standing there is a service-level check, and a check with
 * no test is a check waiting to be refactored away.
 */
describe('Attachments over real HTTP (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
    token = await login(app, 'admin@erp.local', process.env.SEED_ADMIN_PASSWORD || 'Admin@123');
  });

  afterAll(async () => {
    // Delete through the storage layer, not just the rows: deleteMany would
    // leave every uploaded object behind, and a test suite that quietly grows
    // the upload directory on each run is the orphan problem §7.3 warns about,
    // manufactured by us.
    const rows = await prisma.attachment.findMany({ where: { originalName: { contains: 'e2e-attach' } } });
    const uploadDir = process.env.UPLOAD_DIR || path.resolve(__dirname, '..', 'uploads');
    for (const r of rows) {
      await fs.unlink(path.join(uploadDir, r.storedPath)).catch(() => undefined);
    }
    await prisma.attachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await cleanupRun();
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const PDF = Buffer.from('%PDF-1.4\nfake but well-typed\n%%EOF');

  const uploadTo = (owner: 'customers' | 'vendors', ownerId: string, name = 'e2e-attach.pdf', category = 'SSM') =>
    http().post(`/api/${owner}/${ownerId}/attachments`).set(auth())
      .field('category', category)
      .attach('file', PDF, { filename: name, contentType: 'application/pdf' });

  describe('the gap this closes', () => {
    it('stores a real file against a customer and lists it back', async () => {
      const c = await makeCustomer({ label: 'attach-basic' });

      const up = await uploadTo('customers', c.id).expect(201);
      expect(up.body.originalName).toBe('e2e-attach.pdf');
      expect(up.body.category).toBe('SSM');
      expect(up.body.sizeBytes).toBe(PDF.length);
      // Storage key is server-generated — the user's filename never becomes a path.
      expect(up.body.storedPath).not.toContain('e2e-attach.pdf');

      const list = await http().get(`/api/customers/${c.id}/attachments`).set(auth()).expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].uploadedBy?.fullName).toBeTruthy();
    });

    it('downloads the exact bytes that were uploaded', async () => {
      const c = await makeCustomer({ label: 'attach-download' });
      const up = await uploadTo('customers', c.id).expect(201);

      const dl = await http().get(`/api/customers/attachments/${up.body.id}/download`).set(auth()).expect(200);
      expect(Buffer.from(dl.body).equals(PDF)).toBe(true);
      expect(dl.headers['content-type']).toMatch(/application\/pdf/);
      expect(dl.headers['content-disposition']).toMatch(/e2e-attach\.pdf/);
    });

    it('works the same for vendors', async () => {
      const v = await makeVendor('attach-vendor');
      const up = await uploadTo('vendors', v.id, 'e2e-attach-vendor.pdf', 'Insurance').expect(201);

      const list = await http().get(`/api/vendors/${v.id}/attachments`).set(auth()).expect(200);
      expect(list.body.map((a: { id: string }) => a.id)).toContain(up.body.id);
    });

    it('removes the row and the stored object together', async () => {
      const c = await makeCustomer({ label: 'attach-delete' });
      const up = await uploadTo('customers', c.id).expect(201);

      await http().delete(`/api/customers/attachments/${up.body.id}`).set(auth()).expect(200);

      expect(await prisma.attachment.findUnique({ where: { id: up.body.id } })).toBeNull();
      await http().get(`/api/customers/attachments/${up.body.id}/download`).set(auth()).expect(404);
    });
  });

  describe('cross-type isolation — the trade-off §7.3 accepted', () => {
    it('a customer route cannot download a VENDOR attachment', async () => {
      const v = await makeVendor('attach-isolation');
      const up = await uploadTo('vendors', v.id, 'e2e-attach-secret.pdf').expect(201);

      // Same id, wrong owner route. Without the service-level check this would
      // hand a vendor's document to anyone holding customers.read.
      await http().get(`/api/customers/attachments/${up.body.id}/download`).set(auth()).expect(404);
      // Still reachable through its own route, so the 404 is isolation, not breakage.
      await http().get(`/api/vendors/attachments/${up.body.id}/download`).set(auth()).expect(200);
    });

    it('a customer route cannot DELETE a vendor attachment', async () => {
      const v = await makeVendor('attach-isolation-del');
      const up = await uploadTo('vendors', v.id).expect(201);

      await http().delete(`/api/customers/attachments/${up.body.id}`).set(auth()).expect(404);
      expect(await prisma.attachment.findUnique({ where: { id: up.body.id } })).not.toBeNull();
    });

    it('a vendor listing never leaks customer attachments', async () => {
      const c = await makeCustomer({ label: 'attach-leak-c' });
      const v = await makeVendor('attach-leak-v');
      await uploadTo('customers', c.id).expect(201);

      const list = await http().get(`/api/vendors/${v.id}/attachments`).set(auth()).expect(200);
      expect(list.body).toHaveLength(0);
    });
  });

  describe('guards', () => {
    it('rejects an unsupported file type', async () => {
      const c = await makeCustomer({ label: 'attach-mime' });
      const res = await http().post(`/api/customers/${c.id}/attachments`).set(auth())
        .attach('file', Buffer.from('#!/bin/sh\nrm -rf /'), { filename: 'x.sh', contentType: 'application/x-sh' })
        .expect(400);
      expect(res.body.message).toMatch(/Unsupported file type/);
    });

    it('rejects an upload with no file', async () => {
      const c = await makeCustomer({ label: 'attach-nofile' });
      await http().post(`/api/customers/${c.id}/attachments`).set(auth())
        .field('category', 'SSM')
        .expect(400);
    });

    it('404s for an unknown owner', async () => {
      await http().get('/api/customers/00000000-0000-0000-0000-000000000000/attachments')
        .set(auth()).expect(404);
    });

    it('404s when uploading against a soft-deleted customer', async () => {
      const c = await makeCustomer({ label: 'attach-deleted' });
      await prisma.customer.update({ where: { id: c.id }, data: { deletedAt: new Date() } });

      // A record in the recycle bin should not quietly accept new evidence.
      await uploadTo('customers', c.id).expect(404);
    });
  });
});
