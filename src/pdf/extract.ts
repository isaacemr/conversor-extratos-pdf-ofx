/**
 * Extração de texto com posições a partir do pdf.js e reconstrução de linhas/palavras.
 *
 * Não importa o pdf.js diretamente: recebe um PDFDocumentProxy já aberto, para funcionar
 * tanto no navegador (build padrão + worker) quanto no Node (build "legacy", nos testes).
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';

/** Trecho de texto posicionado (coordenadas em pontos, origem no canto superior esquerdo). */
export interface PdfTextItem {
  str: string;
  /** Esquerda. */
  x: number;
  /** Linha de base (cresce para baixo). */
  y: number;
  /** Largura. */
  w: number;
  /** Altura da fonte. */
  h: number;
}

export interface PdfPageText {
  page: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}

export interface Word {
  text: string;
  x0: number;
  x1: number;
}

export interface TextLine {
  page: number;
  /** Linha de base média. */
  y: number;
  /** Altura de fonte típica da linha. */
  h: number;
  words: Word[];
  text: string;
}

/** Lê os itens de texto de todas as páginas. */
export async function extractPdfPages(
  doc: PDFDocumentProxy,
  onProgress?: (page: number, total: number) => void,
): Promise<PdfPageText[]> {
  const pages: PdfPageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str || !it.str.trim()) continue;
      const [a, b, c, d, e, f] = it.transform as number[];
      const [vx, vy] = viewport.convertToViewportPoint(e, f);
      const h = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 10;
      items.push({ str: it.str, x: vx, y: vy, w: it.width, h });
    }
    pages.push({ page: p, width: viewport.width, height: viewport.height, items });
    page.cleanup();
    onProgress?.(p, doc.numPages);
  }
  return pages;
}

/** Número de caracteres visíveis — usado para detectar PDFs sem camada de texto (escaneados). */
export function countTextChars(pages: PdfPageText[]): number {
  return pages.reduce((n, p) => n + p.items.reduce((m, it) => m + it.str.replace(/\s/g, '').length, 0), 0);
}

/** Heurística: PDF provavelmente escaneado se tiver pouquíssimo texto por página. */
export function looksScanned(pages: PdfPageText[]): boolean {
  if (pages.length === 0) return true;
  return countTextChars(pages) / pages.length < 40;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Quebra um item em palavras, estimando a posição x de cada uma proporcionalmente. */
function itemWords(it: PdfTextItem): Word[] {
  const str = it.str.replace(/ /g, ' ');
  const charW = str.length > 0 ? it.w / str.length : 0;
  const out: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) {
    const x0 = it.x + m.index * charW;
    out.push({ text: m[0], x0, x1: x0 + m[0].length * charW });
  }
  return out;
}

/**
 * Agrupa itens de uma página em linhas pela posição vertical e ordena as palavras
 * da esquerda para a direita. Palavras quebradas em vários itens (comum em PDFs com
 * kerning) são unidas quando a distância entre elas é muito pequena.
 */
export function pageToLines(page: PdfPageText): TextLine[] {
  const items = [...page.items].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: { y: number; h: number; items: PdfTextItem[] }[] = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    const tol = g ? Math.max(1.2, 0.45 * Math.min(g.h, it.h)) : 0;
    if (g && Math.abs(it.y - g.y) <= tol) {
      g.items.push(it);
      g.y = (g.y * (g.items.length - 1) + it.y) / g.items.length;
      g.h = Math.max(g.h, it.h);
    } else {
      groups.push({ y: it.y, h: it.h, items: [it] });
    }
  }

  return groups.map((g) => {
    const h = median(g.items.map((i) => i.h));
    const raw = g.items.sort((a, b) => a.x - b.x).flatMap((it) => {
      const ws = itemWords(it);
      // Marca se o item começa colado ao anterior (sem espaço no texto original).
      return ws.map((w, idx) => ({ ...w, glued: idx === 0 && !/^\s/.test(it.str) }));
    });
    const words: Word[] = [];
    for (const w of raw) {
      const prev = words[words.length - 1];
      if (prev && w.glued && w.x0 - prev.x1 < 0.12 * h) {
        prev.text += w.text;
        prev.x1 = Math.max(prev.x1, w.x1);
      } else {
        words.push({ text: w.text, x0: w.x0, x1: w.x1 });
      }
    }
    return { page: page.page, y: g.y, h, words, text: words.map((w) => w.text).join(' ') };
  });
}

export function pagesToLines(pages: PdfPageText[]): TextLine[] {
  return pages.flatMap(pageToLines);
}
