/**
 * Simula a saída do pdf.js a partir de texto em largura fixa: cada caractere ocupa 5
 * unidades, cada linha 12 e a fonte tem altura 10. Páginas separadas por "\f".
 */
import type { TextLine } from '../pdf/extract';

export const CHAR_W = 5;

export function linesFromText(text: string): TextLine[] {
  const out: TextLine[] = [];
  text.split('\f').forEach((pageText, p) => {
    pageText.split('\n').forEach((raw, i) => {
      const words = [...raw.matchAll(/\S+/g)].map((m) => ({
        text: m[0],
        x0: m.index! * CHAR_W,
        x1: (m.index! + m[0].length) * CHAR_W,
      }));
      if (words.length === 0) return;
      out.push({ page: p + 1, y: 20 + i * 12, h: 10, words, text: words.map((w) => w.text).join(' ') });
    });
  });
  return out;
}

/** Monta uma linha de tabela com colunas de largura fixa (valores alinhados à direita). */
export function row(cells: string[], widths: number[], align: Array<'l' | 'r'>): string {
  return cells.map((s, i) => (align[i] === 'r' ? s.padStart(widths[i]) : s.padEnd(widths[i]))).join('');
}
