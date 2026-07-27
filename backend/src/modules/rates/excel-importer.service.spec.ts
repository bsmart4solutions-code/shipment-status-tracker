import { Test } from '@nestjs/testing';
import { ExcelImporterService } from './excel-importer.service';
import { PrismaService } from '../../common/prisma.service';
import * as XLSX from 'xlsx';

describe('ExcelImporterService', () => {
  let service: ExcelImporterService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ExcelImporterService,
        {
          provide: PrismaService,
          useValue: {
            service: { findFirst: jest.fn() },
            vendorServiceRate: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<ExcelImporterService>(ExcelImporterService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('importRates', () => {
    it('detects and parses Solid Xpress OCEAN FREIGHT format', async () => {
      // Mock Sea Freight service
      (prisma.service.findFirst as jest.Mock).mockResolvedValue({ id: 'service-uuid', name: 'Sea Freight' });
      (prisma.vendorServiceRate.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.vendorServiceRate.create as jest.Mock).mockResolvedValue({});

      // Create a minimal Solid Xpress format Excel file
      const workbook = XLSX.utils.book_new();
      const data = [
        { destination: 'HO CHI MINH', rate: -17, min: 120, via: 'DIRECT', transit: '10-12', collect: 'Y' },
        { destination: 'SINGAPORE', rate: 45.5, min: 150, via: 'SIN', transit: '7-8', collect: 'N' },
      ];
      const sheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, sheet, 'OCEAN FREIGHT');

      const buffer = Buffer.from(XLSX.write(workbook, { type: 'array' }));
      const result = await service.importRates(buffer, 'vendor-uuid');

      expect(result.created).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(prisma.vendorServiceRate.create).toHaveBeenCalledTimes(2);
    });

    it('detects and parses ECU WW EXPORT TARIFF format', async () => {
      (prisma.service.findFirst as jest.Mock).mockResolvedValue({ id: 'service-uuid', name: 'Sea Freight' });
      (prisma.vendorServiceRate.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.vendorServiceRate.create as jest.Mock).mockResolvedValue({});

      const workbook = XLSX.utils.book_new();
      const data = [
        { port: 'BANGKOK', province: 'NORTH ASIA', rate: 55.0, min: 100, via: 'DIRECT', transit: '5', collect: 'Y' },
        { port: 'SINGAPORE', province: 'SOUTH ASIA', rate: 60.75, min: 150, via: 'SIN', transit: '8-10', collect: 'N' },
      ];
      const sheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, sheet, 'EXPORT TARIFF');

      const buffer = Buffer.from(XLSX.write(workbook, { type: 'array' }));
      const result = await service.importRates(buffer, 'vendor-uuid');

      expect(result.created).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(prisma.vendorServiceRate.create).toHaveBeenCalledTimes(2);
    });

    it('handles F.O.C (free of charge) as zero cost', async () => {
      (prisma.service.findFirst as jest.Mock).mockResolvedValue({ id: 'service-uuid', name: 'Sea Freight' });
      (prisma.vendorServiceRate.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.vendorServiceRate.create as jest.Mock).mockResolvedValue({});

      const workbook = XLSX.utils.book_new();
      const data = [
        { destination: 'TEST PORT', rate: 'F.O.C', min: 100, via: 'DIRECT', transit: '5', collect: 'N' },
      ];
      const sheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, sheet, 'OCEAN FREIGHT');

      const buffer = Buffer.from(XLSX.write(workbook, { type: 'array' }));
      const result = await service.importRates(buffer, 'vendor-uuid');

      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Check that cost was set to 0
      const call = (prisma.vendorServiceRate.create as jest.Mock).mock.calls[0][0];
      expect(call.data.cost.toNumber()).toBe(0);
    });

    it('handles ON REQUEST availability status', async () => {
      (prisma.service.findFirst as jest.Mock).mockResolvedValue({ id: 'service-uuid', name: 'Sea Freight' });
      (prisma.vendorServiceRate.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.vendorServiceRate.create as jest.Mock).mockResolvedValue({});

      const workbook = XLSX.utils.book_new();
      const data = [
        { destination: 'TEST PORT', rate: 'ON REQUEST', min: 100, via: 'DIRECT', transit: '5', collect: 'N' },
      ];
      const sheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, sheet, 'OCEAN FREIGHT');

      const buffer = Buffer.from(XLSX.write(workbook, { type: 'array' }));
      const result = await service.importRates(buffer, 'vendor-uuid');

      expect(result.created).toBe(1);
      const call = (prisma.vendorServiceRate.create as jest.Mock).mock.calls[0][0];
      expect(call.data.availability).toBe('ON_REQUEST');
    });

    it('skips empty rows gracefully', async () => {
      (prisma.service.findFirst as jest.Mock).mockResolvedValue({ id: 'service-uuid', name: 'Sea Freight' });

      const workbook = XLSX.utils.book_new();
      const data = [
        { destination: 'HO CHI MINH', rate: -17, min: 120, via: 'DIRECT', transit: '10-12', collect: 'Y' },
        { destination: '', rate: '', min: '', via: '', transit: '', collect: '' }, // empty row
        { destination: 'SINGAPORE', rate: 45.5, min: 150, via: 'SIN', transit: '7-8', collect: 'N' },
      ];
      const sheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, sheet, 'OCEAN FREIGHT');

      (prisma.vendorServiceRate.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.vendorServiceRate.create as jest.Mock).mockResolvedValue({});

      const buffer = Buffer.from(XLSX.write(workbook, { type: 'array' }));
      const result = await service.importRates(buffer, 'vendor-uuid');

      expect(result.created).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('returns error for invalid rate values', async () => {
      (prisma.service.findFirst as jest.Mock).mockResolvedValue({ id: 'service-uuid', name: 'Sea Freight' });

      const workbook = XLSX.utils.book_new();
      const data = [
        { destination: 'BAD PORT', rate: 'not_a_number', min: 100, via: 'DIRECT', transit: '5', collect: 'N' },
      ];
      const sheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, sheet, 'OCEAN FREIGHT');

      const buffer = Buffer.from(XLSX.write(workbook, { type: 'array' }));
      const result = await service.importRates(buffer, 'vendor-uuid');

      expect(result.created).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/Invalid rate value/);
    });

    it('updates existing rates instead of creating duplicates', async () => {
      (prisma.service.findFirst as jest.Mock).mockResolvedValue({ id: 'service-uuid', name: 'Sea Freight' });

      // Mock that the rate already exists
      (prisma.vendorServiceRate.findFirst as jest.Mock).mockResolvedValue({ id: 'existing-rate-id' });
      (prisma.vendorServiceRate.update as jest.Mock).mockResolvedValue({});

      const workbook = XLSX.utils.book_new();
      const data = [
        { destination: 'HO CHI MINH', rate: -17, min: 120, via: 'DIRECT', transit: '10-12', collect: 'Y' },
      ];
      const sheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, sheet, 'OCEAN FREIGHT');

      const buffer = Buffer.from(XLSX.write(workbook, { type: 'array' }));
      const result = await service.importRates(buffer, 'vendor-uuid');

      expect(result.created).toBe(1); // counted as "created" in current impl
      expect(prisma.vendorServiceRate.update).toHaveBeenCalled();
    });
  });
});
