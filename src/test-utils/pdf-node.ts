/** Abre PDFs no Node com o build "legacy" do pdf.js (apenas testes e scripts). */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { extractPdfPages, pagesToLines, type PdfPageText, type TextLine } from '../pdf/extract';

export async function pdfPagesNode(data: Uint8Array): Promise<PdfPageText[]> {
  // pdf.js transfere (e invalida) o buffer recebido; passamos uma cópia.
  const task = getDocument({ data: data.slice(), disableFontFace: true, verbosity: 0 });
  try {
    const doc = (await task.promise) as unknown as PDFDocumentProxy;
    return await extractPdfPages(doc);
  } finally {
    await task.destroy();
  }
}

export async function pdfLinesNode(data: Uint8Array): Promise<TextLine[]> {
  return pagesToLines(await pdfPagesNode(data));
}
