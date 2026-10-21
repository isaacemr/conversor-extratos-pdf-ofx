/**
 * OCR opcional para PDFs escaneados (sem camada de texto), com tesseract.js em português.
 *
 * As páginas são renderizadas em canvas pelo pdf.js e reconhecidas localmente. Na primeira
 * execução o tesseract.js baixa o motor e o modelo do idioma "por" (~15 MB) de um CDN público;
 * os arquivos do usuário continuam sem sair do navegador.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfPageText, PdfTextItem } from './extract';

export type OcrProgress = (message: string, ratio: number) => void;

const SCALE = 2.5; // ~180 dpi: bom equilíbrio entre precisão e tempo

export async function ocrPdf(doc: PDFDocumentProxy, onProgress?: OcrProgress): Promise<PdfPageText[]> {
  const { createWorker } = await import('tesseract.js');
  const total = doc.numPages;
  let page = 0;
  onProgress?.('Carregando o motor de OCR (português)…', 0);
  const worker = await createWorker('por', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress?.(`Reconhecendo texto — página ${page} de ${total}`, (page - 1 + m.progress) / total);
      } else if (page === 0) {
        onProgress?.(`Preparando OCR: ${m.status}`, 0);
      }
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const pages: PdfPageText[] = [];
    for (page = 1; page <= total; page++) {
      const p = await doc.getPage(page);
      const viewport = p.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await p.render({ canvas, viewport }).promise;
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
      const items: PdfTextItem[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const w of line.words) {
              if (!w.text.trim() || w.confidence < 15) continue;
              const { x0, x1, y0, y1 } = w.bbox;
              items.push({
                str: w.text,
                x: x0 / SCALE,
                // usa a base da linha para manter palavras da mesma linha alinhadas
                y: line.bbox.y1 / SCALE,
                w: (x1 - x0) / SCALE,
                h: Math.max(4, (y1 - y0) / SCALE),
              });
            }
          }
        }
      }
      pages.push({ page, width: viewport.width / SCALE, height: viewport.height / SCALE, items });
      p.cleanup();
      canvas.width = canvas.height = 0;
    }
    onProgress?.('OCR concluído', 1);
    return pages;
  } finally {
    await worker.terminate();
  }
}
