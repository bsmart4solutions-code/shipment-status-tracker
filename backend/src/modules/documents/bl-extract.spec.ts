import { extractFromText } from './bl-extract';

// Real text-layer output from a COSCO arrival notice (BL7269938150.PDF).
const ARRIVAL_NOTICE = `ARRIVAL NOTICE Type of B/L: Original
B/L Number: COAU7269938150
B/L Vessel/Voyage:
TIAN CHANG HE 118N
Issued Date: 03 Jul 2026
SHIPPER
WEIFANG MASTER WOOD INDUSTRY
CO.LTD
CONSIGNEE
EURIHO MARKETING SDN BHD
NOTIFY PARTY
EURIHO MARKETING SDN BHD
ETA AT POD: Port kelang
ON: Thursday, 09 Jul, 2026 11:00 PM
PLACE OF RECEIPT
Qingdao, Qingdao, Shandong, China
PORT OF LOADING
Qingdao
PORT OF DISCHARGE
Port kelang
PLACE OF DELIVERY
Port Klang (West Port), Selangor, Malaysia`;

// Real text-layer output from a Ben Line / SJJ tax invoice (INV_HAN HUI...pdf).
const TAX_INVOICE = `TAX INVOICE
Date : 29.JUN.2026 Invoice No. : JJSI303798 Debtor Code : LK005675
Ocean Vessel / Voy. : HAN HUI 2625W ETA : 01.JUL.2026
Bill of Lading Number(s) : JJCNSKWY601166
Port of Loading : NANSHA
Port of Discharge : WESTPORT/PORT KLANG
Port of Delivery : WESTPORT/PORT KLANG
Volume : 1X40'HC`;

describe('BL extraction — arrival notice (label-on-own-line layout)', () => {
  const r = extractFromText(ARRIVAL_NOTICE);

  it('detects the document type', () => {
    expect(r.documentType).toBe('ARRIVAL_NOTICE');
    expect(r.textLayerPresent).toBe(true);
    expect(r.needsOcr).toBe(false);
  });

  it('reads the B/L number (inline after colon)', () => {
    expect(r.fields.blNumber).toBe('COAU7269938150');
  });

  it('reads POL / POD / place of delivery from the next line', () => {
    expect(r.fields.portOfLoading).toBe('Qingdao');
    expect(r.fields.portOfDischarge).toBe('Port kelang');
    expect(r.fields.placeOfDelivery).toBe('Port Klang (West Port), Selangor, Malaysia');
  });

  it('splits vessel and voyage', () => {
    expect(r.fields.vessel).toBe('TIAN CHANG HE');
    expect(r.fields.voyage).toBe('118N');
  });

  it('reads ETA from the "ON:" line, not the "ETA AT POD" port name', () => {
    expect(r.fields.eta).toBe('Thursday, 09 Jul, 2026 11:00 PM');
  });

  it('has high confidence', () => {
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

describe('BL extraction — tax invoice (inline multi-label layout)', () => {
  const r = extractFromText(TAX_INVOICE);

  it('detects the document type', () => {
    expect(r.documentType).toBe('TAX_INVOICE');
  });

  it('reads invoice number without swallowing the next label', () => {
    expect(r.fields.invoiceNumber).toBe('JJSI303798');
  });

  it('reads the B/L number', () => {
    expect(r.fields.blNumber).toBe('JJCNSKWY601166');
  });

  it('reads POL and POD', () => {
    expect(r.fields.portOfLoading).toBe('NANSHA');
    expect(r.fields.portOfDischarge).toBe('WESTPORT/PORT KLANG');
  });

  it('reads vessel/voyage from one inline field, stopping before ETA', () => {
    expect(r.fields.vessel).toBe('HAN HUI');
    expect(r.fields.voyage).toBe('2625W');
  });

  it('reads the ETA without swallowing following text', () => {
    expect(r.fields.eta).toBe('01.JUL.2026');
  });
});

describe('BL extraction — scanned document (no text layer)', () => {
  it('flags needsOcr when there is no usable text', () => {
    const r = extractFromText('   \n  \n');
    expect(r.textLayerPresent).toBe(false);
    expect(r.needsOcr).toBe(true);
    expect(r.confidence).toBe(0);
  });
});

// Real tesseract output from an OCR'd two-column BL scan (HBL-v3). OCR
// mangles the layout: labels of adjacent columns land on one line, values on
// the next, and the right column's boilerplate bleeds into label lines.
const OCR_TWO_COLUMN = `BILL OF LADING FOR COMBINED TRANSPORT.OR PORT TO PORT SHIPMENT OR THROUGH CARRIAGE
a Vou. No. Fort of Loading arc condions of iB of Lacing asf each had personaly signed this Bill
OGCL SAVANNAH 4735 = SHANGHAI Cry
Port of Discharge Place of Delivery * “Applicable Only When Document Used as a Combined Transport Bil of Lading.
PORT KLANG PORT KLANG +
Container Seal No. | Number and Kind | Description of Goods | Gross Weight | Measurement`;

describe('BL extraction — OCR text from a two-column scan', () => {
  const r = extractFromText(OCR_TWO_COLUMN);

  it('splits the shared value line between the two column labels', () => {
    expect(r.fields.portOfDischarge).toBe('PORT KLANG');
    expect(r.fields.placeOfDelivery).toBe('PORT KLANG');
  });

  it('rejects neighbouring-column boilerplate instead of capturing junk', () => {
    // "Fort of Loading" is followed by right-column contract text and a
    // garbled vessel line — both must be rejected, not returned as a port.
    expect(r.fields.portOfLoading).toBeUndefined();
  });

  it('reports honest low confidence for a partial OCR extraction', () => {
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.confidence).toBeGreaterThan(0);
  });
});
