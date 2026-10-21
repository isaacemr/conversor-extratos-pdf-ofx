/**
 * Pipeline PDF → transações no navegador: abre o PDF, extrai o texto (ou faz OCR) e
 * executa o parser adequado.
 */
import { parseStatement } from '../parsers/registry';
import type { ParseResult } from '../parsers/types';
import { extractPdfPages, looksScanned, pagesToLines } from './extract';
import { ocrPdf, type OcrProgress } from './ocr';
import { openPdf } from './pdfjs';

export type PdfProcessResult =
  | { kind: 'parsed'; result: ParseResult; pageCount: number; ocr: boolean }
  | { kind: 'scanned'; pageCount: number };

export async function processPdf(
  data: ArrayBuffer,
  opts: { fileName: string; password?: string; ocr?: boolean; onProgress?: OcrProgress },
): Promise<PdfProcessResult> {
  const { doc, close } = await openPdf(data, opts.password);
  try {
    const pageCount = doc.numPages;
    let pages;
    if (opts.ocr) {
      pages = await ocrPdf(doc, opts.onProgress);
    } else {
      pages = await extractPdfPages(doc, (p, t) => opts.onProgress?.(`Lendo página ${p} de ${t}`, p / t));
      if (looksScanned(pages)) return { kind: 'scanned', pageCount };
    }
    const result = parseStatement({ lines: pagesToLines(pages), fileName: opts.fileName, ocr: opts.ocr });
    return { kind: 'parsed', result, pageCount, ocr: !!opts.ocr };
  } finally {
    await close();
  }
}
