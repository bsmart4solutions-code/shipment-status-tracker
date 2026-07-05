import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { join, resolve } from 'path';

/**
 * OCR for scanned PDFs, fully local: the page is rendered to an image with
 * pdfjs (via pdf-parse's getScreenshot + @napi-rs/canvas) and recognised with
 * tesseract.js (WASM — no system tesseract install needed).
 *
 * Only the first page is processed: B/L headers, ports and parties live on
 * page 1, and OCR is by far the slowest step in the pipeline (~8-10s a page).
 *
 * The tesseract worker is a lazy singleton; recognitions are serialised
 * through a promise chain because one worker handles one image at a time.
 * Language data (eng) is downloaded once and cached under UPLOAD_DIR/.tessdata
 * so it persists on the uploads volume.
 */
@Injectable()
export class OcrService implements OnModuleDestroy {
  private logger = new Logger(OcrService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private worker: any | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private readonly OCR_TIMEOUT_MS = 25_000; // stay under the 30s request timeout

  /** Render page 1 of a PDF to a PNG buffer at 2x scale (better OCR accuracy). */
  async renderFirstPage(absPdfPath: string): Promise<Buffer | null> {
    const { readFile } = await import('fs/promises');
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(await readFile(absPdfPath)) });
    try {
      const res = await parser.getScreenshot({ scale: 2, last: 1 });
      const page = res.pages?.[0];
      if (page?.data) return Buffer.from(page.data);
      if (page?.dataUrl) return Buffer.from(page.dataUrl.split(',')[1], 'base64');
      return null;
    } finally {
      await parser.destroy();
    }
  }

  /** OCR an image buffer; null when recognition fails or times out. */
  async recognize(image: Buffer): Promise<{ text: string; confidence: number } | null> {
    const run = this.queue.then(async () => {
      const worker = await this.getWorker();
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), this.OCR_TIMEOUT_MS));
      const job = worker.recognize(image).then((res: { data: { text: string; confidence: number } }) => ({
        text: res.data.text ?? '',
        confidence: res.data.confidence ?? 0,
      }));
      return Promise.race([job, timeout]);
    }).catch((e) => {
      this.logger.error(`OCR failed: ${(e as Error).message}`);
      return null;
    });
    // Keep the chain alive regardless of this run's outcome.
    this.queue = run.then(() => undefined, () => undefined);
    return run as Promise<{ text: string; confidence: number } | null>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getWorker(): Promise<any> {
    if (this.worker) return this.worker;
    const { createWorker } = await import('tesseract.js');
    const { mkdir } = await import('fs/promises');
    // The cache dir MUST exist before createWorker — tesseract.js silently
    // falls back to the process cwd otherwise, dropping eng.traineddata into
    // the project root (which also churns dev-server file watchers).
    const cachePath = join(resolve(process.env.UPLOAD_DIR || './uploads'), '.tessdata');
    await mkdir(cachePath, { recursive: true });
    this.worker = await createWorker('eng', undefined, { cachePath });
    this.logger.log('Tesseract worker initialised (eng)');
    return this.worker;
  }

  async onModuleDestroy() {
    if (this.worker) await this.worker.terminate().catch(() => undefined);
  }
}
