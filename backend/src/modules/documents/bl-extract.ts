/**
 * Template-based extraction of shipping-document fields from a PDF's text
 * layer. Deterministic, no OCR — it anchors on field labels and reads the
 * value that follows, handling both layouts seen in real carrier documents:
 *
 *   "Port of Loading : NANSHA"        (inline, colon-separated, several per line)
 *   "PORT OF LOADING\nQingdao"        (label on its own line, value on the next)
 *
 * A document with no usable text layer (a scan) yields textLayerPresent=false
 * so the caller can route it to manual entry / OCR instead.
 */

export interface ExtractedFields {
  blNumber?: string;
  vessel?: string;
  voyage?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  placeOfDelivery?: string;
  eta?: string;
  issueDate?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  shipper?: string;
  consignee?: string;
}

export type DocumentType = 'ARRIVAL_NOTICE' | 'TAX_INVOICE' | 'BILL_OF_LADING' | 'UNKNOWN';

export interface ExtractionResult {
  textLayerPresent: boolean;
  needsOcr: boolean;
  documentType: DocumentType;
  fields: ExtractedFields;
  /** 0..1 — fraction of the core fields that were found. */
  confidence: number;
}

// Every label the extractor knows about. Used both to locate a value and to
// know where an inline value ends (the next label on the same line).
const ALL_LABELS = [
  /b\/l\s*number/i,
  /bill\s*of\s*lading\s*number\(?s?\)?/i,
  /b\/l\s*vessel\s*\/\s*voyage/i,
  /vessel\s*\/\s*voyage\s*arriving\s*at\s*pod/i,
  /ocean\s*vessel\s*\/?\s*voy\.?/i,
  /issued?\s*date/i,
  /invoice\s*no\.?/i,
  /debtor\s*code/i,
  /\beta\b(?:\s*at\s*pod)?/i,
  /place\s*of\s*receipt/i,
  /port\s*of\s*loading/i,
  /port\s*of\s*discharge/i,
  /place\s*of\s*delivery/i,
  /port\s*of\s*delivery/i,
  /\bvolume\b/i,
  /\bdate\b/i,
  /\bshipper\b/i,
  /\bconsignee\b/i,
  /\bnotify\s*party\b/i,
];

/** Value from a label: inline after the colon (cut at the next label) or the next non-empty line. */
function grab(lines: string[], labelRe: RegExp): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(new RegExp(`(${labelRe.source})\\s*:?`, 'i'));
    if (!m || m.index === undefined) continue;
    const after = line.slice(m.index + m[0].length);
    const inline = cutAtNextLabel(after).trim();
    if (inline) return inline;
    // Label sits alone on its line → take the next non-empty, non-label line.
    for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
      const nxt = lines[j].trim();
      if (nxt && !isLabelLine(nxt)) return cutAtNextLabel(nxt).trim();
    }
    return undefined;
  }
  return undefined;
}

/** Trim an inline value at the point where the next known label begins. */
function cutAtNextLabel(s: string): string {
  let cut = s.length;
  for (const lab of ALL_LABELS) {
    const m = s.match(new RegExp(`\\s+(${lab.source})\\s*:`, 'i'));
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }
  return s.slice(0, cut);
}

function isLabelLine(line: string): boolean {
  const t = line.trim();
  return ALL_LABELS.some((l) => new RegExp(`^(${l.source})\\s*:?\\s*$`, 'i').test(t));
}

/** Split a "VESSEL NAME VOYAGE" string — voyage is the trailing alphanumeric token. */
function splitVesselVoyage(s?: string): { vessel?: string; voyage?: string } {
  if (!s) return {};
  const parts = s.trim().split(/\s+/);
  if (parts.length >= 2 && /\d/.test(parts[parts.length - 1])) {
    return { voyage: parts[parts.length - 1], vessel: parts.slice(0, -1).join(' ') };
  }
  return { vessel: s.trim() };
}

function detectType(text: string): DocumentType {
  const t = text.toUpperCase();
  if (t.includes('ARRIVAL NOTICE')) return 'ARRIVAL_NOTICE';
  if (t.includes('TAX INVOICE') || t.includes('DEBIT NOTE')) return 'TAX_INVOICE';
  if (t.includes('BILL OF LADING') || /\bB\/L\b/.test(t)) return 'BILL_OF_LADING';
  return 'UNKNOWN';
}

export function extractFromText(rawText: string): ExtractionResult {
  const text = rawText ?? '';
  const textLayerPresent = text.trim().length >= 40;
  if (!textLayerPresent) {
    return { textLayerPresent: false, needsOcr: true, documentType: 'UNKNOWN', fields: {}, confidence: 0 };
  }

  const lines = text.split(/\r?\n/);
  const type = detectType(text);

  const fields: ExtractedFields = {};
  fields.blNumber = grab(lines, /bill\s*of\s*lading\s*number\(?s?\)?/i) || grab(lines, /b\/l\s*number/i);
  fields.portOfLoading = grab(lines, /port\s*of\s*loading/i);
  fields.portOfDischarge = grab(lines, /port\s*of\s*discharge/i);
  fields.placeOfDelivery = grab(lines, /place\s*of\s*delivery/i) || grab(lines, /port\s*of\s*delivery/i);
  // ETA: arrival notices write "ETA AT POD: <port>" then the date on the next
  // "ON: ..." line; invoices write "ETA : <date>" inline. Handle both.
  const etaAtPodIdx = lines.findIndex((l) => /eta\s*at\s*pod/i.test(l));
  if (etaAtPodIdx !== -1) {
    const onLine = lines[etaAtPodIdx + 1] || '';
    const m = onLine.match(/^\s*ON\s*:\s*(.+)$/i);
    if (m) fields.eta = m[1].trim();
  } else {
    const eta = grab(lines, /\beta\b/i);
    if (eta && /\d/.test(eta)) fields.eta = eta; // must look like a date
  }
  fields.invoiceNumber = grab(lines, /invoice\s*no\.?/i);
  fields.invoiceDate = type === 'TAX_INVOICE' ? grab(lines, /\bdate\b/i) : undefined;
  fields.issueDate = grab(lines, /issued?\s*date/i);

  const vv = splitVesselVoyage(
    grab(lines, /ocean\s*vessel\s*\/?\s*voy\.?/i) || grab(lines, /b\/l\s*vessel\s*\/\s*voyage/i),
  );
  fields.vessel = vv.vessel;
  fields.voyage = vv.voyage;

  // Clean obviously-empty captures.
  for (const k of Object.keys(fields) as (keyof ExtractedFields)[]) {
    if (!fields[k] || fields[k]!.length === 0) delete fields[k];
  }

  const core: (keyof ExtractedFields)[] = ['blNumber', 'vessel', 'portOfLoading', 'portOfDischarge', 'eta'];
  const found = core.filter((k) => fields[k]).length;
  const confidence = Math.round((found / core.length) * 100) / 100;

  return { textLayerPresent: true, needsOcr: false, documentType: type, fields, confidence };
}
