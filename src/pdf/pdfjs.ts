/**
 * Carregamento do pdf.js no navegador (sob demanda, com worker empacotado pelo Vite).
 * O arquivo é lido localmente; nada é enviado a servidor.
 */
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

export class PdfPasswordError extends Error {
  constructor(public incorrect: boolean) {
    super(incorrect ? 'Senha incorreta.' : 'Este PDF é protegido por senha.');
  }
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  close: () => Promise<void>;
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
      ([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
      },
    );
  }
  return pdfjsPromise;
}

export async function openPdf(data: ArrayBuffer, password?: string): Promise<OpenedPdf> {
  const pdfjs = await loadPdfjs();
  const task: PDFDocumentLoadingTask = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), password });
  try {
    const doc = await task.promise;
    return { doc, close: () => task.destroy() };
  } catch (e) {
    await task.destroy().catch(() => undefined);
    const err = e as { name?: string; code?: number };
    if (err?.name === 'PasswordException') {
      throw new PdfPasswordError(err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    }
    if (err?.name === 'InvalidPDFException') {
      throw new Error('O arquivo não é um PDF válido ou está corrompido.');
    }
    throw e;
  }
}
