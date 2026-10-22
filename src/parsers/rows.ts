/**
 * Reconstrução de linhas de tabela.
 *
 * Muitos extratos centralizam verticalmente o conteúdo das células: quando a descrição
 * ocupa duas ou três linhas, a data e o valor ficam na linha do meio, e parte da descrição
 * fica acima e parte abaixo (Mercado Pago, Stone, PagBank). Outros desenham cada célula com
 * um pequeno deslocamento vertical (BB, Sicoob), e o pdf.js entrega a data, a descrição e o
 * valor em linhas separadas por poucos pontos. Este módulo junta esses pedaços numa só linha
 * antes do parser, preservando a ordem de leitura dentro de cada coluna.
 */
import type { TextLine, Word } from '../pdf/extract';
import { WEEKDAY_RE, normalizeForMatch, parseBRAmountDetailed, parseBRDate } from '../utils/br-format';

/** Distância máxima (em alturas de fonte) para considerar duas linhas parte do mesmo desenho. */
const TIGHT = 0.75;
/** Distância máxima para anexar um fragmento (só texto ou só valor) à linha vizinha. */
const LOOSE = 1.75;

/** Quantas palavras iniciais formam uma data (0 se a linha não começa com data). */
export function leadingDateWords(words: Word[]): number {
  if (!words.length) return 0;
  if (!/^\d/.test(words[0].text) && !WEEKDAY_RE.test(normalizeForMatch(words[0].text))) return 0;
  for (let k = Math.min(6, words.length); k >= 1; k--) {
    if (parseBRDate(words.slice(0, k).map((w) => w.text).join(' '), { year: 2000 })) return k;
  }
  return 0;
}

function hasAmount(words: Word[]): boolean {
  for (let i = 0; i < words.length; i++) {
    if (parseBRAmountDetailed(words[i].text)) return true;
    if (i + 1 < words.length && parseBRAmountDetailed(`${words[i].text} ${words[i + 1].text}`)) return true;
  }
  return false;
}

/** Palavra "de texto": pelo menos duas letras (descarta R$, D, C, números). */
const isTextWord = (w: Word) => /[A-Za-zÀ-ÿ]{2,}/.test(w.text) && !parseBRAmountDetailed(w.text);

type Kind = 'anchor' | 'fragment' | 'barrier';

interface Group {
  page: number;
  members: TextLine[];
  kind: Kind;
  firstY: number;
  lastY: number;
  h: number;
  /** Fim da data inicial (x1), quando a linha-âncora começa com data. */
  dateEnd?: number;
  /** Início do texto da âncora sem data (para alinhar continuações). */
  textX0?: number;
  textOnly: boolean;
  /** Âncora que é linha de saldo: não recebe continuação de texto. */
  isBalance?: boolean;
}

const BALANCE_LINE_RE = /^(d{1,5}s+)*(SALDO|SDO|S A L D O)/;

function classify(line: TextLine, isBarrier: (l: TextLine) => boolean): { kind: Kind; dateWords: number; textOnly: boolean } {
  if (isBarrier(line)) return { kind: 'barrier', dateWords: 0, textOnly: false };
  const dateWords = leadingDateWords(line.words);
  const amount = hasAmount(line.words);
  const text = line.words.slice(dateWords).some(isTextWord);
  if (dateWords > 0 || (amount && text)) return { kind: 'anchor', dateWords, textOnly: false };
  return { kind: 'fragment', dateWords: 0, textOnly: text && !amount };
}

function newGroup(line: TextLine, c: ReturnType<typeof classify>): Group {
  return {
    page: line.page,
    members: [line],
    kind: c.kind,
    firstY: line.y,
    lastY: line.y,
    h: line.h,
    dateEnd: c.dateWords ? line.words[c.dateWords - 1].x1 : undefined,
    textX0: c.kind === 'anchor' && !c.dateWords ? line.words[0].x0 : undefined,
    textOnly: c.textOnly,
    isBalance:
      c.kind === 'anchor' &&
      BALANCE_LINE_RE.test(normalizeForMatch(line.words.slice(c.dateWords).map((w) => w.text).join(' '))),
  };
}

function absorb(into: Group, g: Group): void {
  into.members.push(...g.members);
  into.firstY = Math.min(into.firstY, g.firstY);
  into.lastY = Math.max(into.lastY, g.lastY);
  into.h = Math.max(into.h, g.h);
  if (g.kind === 'anchor') {
    into.kind = 'anchor';
    into.dateEnd ??= g.dateEnd;
    into.textX0 ??= g.textX0;
    into.isBalance ||= g.isBalance;
  }
  into.textOnly = into.textOnly && g.textOnly;
}

/**
 * Ordena as palavras de várias linhas como uma única linha de tabela: blocos de palavras
 * próximas são agrupados por sobreposição horizontal (= mesma coluna); as colunas seguem da
 * esquerda para a direita e, dentro de cada coluna, os blocos seguem de cima para baixo.
 */
export function orderRowWords(members: TextLine[]): Word[] {
  if (members.length === 1) return members[0].words;
  interface Block {
    x0: number;
    x1: number;
    y: number;
    words: Word[];
    parent: number;
  }
  const blocks: Block[] = [];
  for (const line of members) {
    let cur: Block | null = null;
    for (const w of line.words) {
      if (cur && w.x0 - cur.x1 < 1.2 * line.h) {
        cur.words.push(w);
        cur.x1 = Math.max(cur.x1, w.x1);
      } else {
        cur = { x0: w.x0, x1: w.x1, y: line.y, words: [w], parent: blocks.length };
        blocks.push(cur);
      }
    }
  }
  const find = (i: number): number => (blocks[i].parent === i ? i : (blocks[i].parent = find(blocks[i].parent)));
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (a.y !== b.y && a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5) blocks[find(i)].parent = find(j);
    }
  }
  const cols = new Map<number, Block[]>();
  blocks.forEach((b, i) => {
    const r = find(i);
    if (!cols.has(r)) cols.set(r, []);
    cols.get(r)!.push(b);
  });
  return [...cols.values()]
    .map((bs) => bs.sort((a, b) => a.y - b.y || a.x0 - b.x0))
    .sort((a, b) => Math.min(...a.map((x) => x.x0)) - Math.min(...b.map((x) => x.x0)))
    .flatMap((bs) => bs.flatMap((b) => b.words));
}

function toLine(g: Group): TextLine {
  if (g.members.length === 1) return g.members[0];
  const words = orderRowWords([...g.members].sort((a, b) => a.y - b.y));
  const anchor = g.members.find((m) => leadingDateWords(m.words) > 0) ?? g.members[0];
  return { page: g.page, y: anchor.y, h: g.h, words, text: words.map((w) => w.text).join(' ') };
}

/** Pode o fragmento F ser anexado à âncora A (alinhamento horizontal)? */
function compatible(f: Group, a: Group): boolean {
  if (!f.textOnly) return true; // valores e indicadores soltos não têm restrição
  if (a.isBalance) return false; // continuação nunca pertence a uma linha de saldo
  const x0 = Math.min(...f.members.map((m) => m.words[0].x0));
  if (a.dateEnd !== undefined) return x0 >= a.dateEnd; // não pode invadir a coluna de data
  if (a.textX0 !== undefined) return x0 >= a.textX0 - f.h;
  return true;
}

export function groupRows(lines: TextLine[], isBarrier: (l: TextLine) => boolean): TextLine[] {
  // 1. Encadeamento apertado: deslocamentos de poucos pontos são a mesma linha.
  const groups: Group[] = [];
  for (const line of lines) {
    if (!line.words.length) continue;
    const c = classify(line, isBarrier);
    const g = groups[groups.length - 1];
    const tight =
      g &&
      g.page === line.page &&
      g.kind !== 'barrier' &&
      c.kind !== 'barrier' &&
      line.y - g.lastY <= TIGHT * Math.max(g.h, line.h) &&
      !(g.dateEnd !== undefined && c.dateWords > 0);
    if (tight) absorb(g, newGroup(line, c));
    else groups.push(newGroup(line, c));
  }

  // 2. Fragmentos soltos vão para a âncora vizinha mais próxima (empate: a de cima).
  for (let iter = 0; iter < 50; iter++) {
    let changed = false;
    for (let i = 0; i < groups.length; i++) {
      const f = groups[i];
      if (f.kind !== 'fragment') continue;
      const thr = LOOSE * f.h;
      const p = groups[i - 1];
      const n = groups[i + 1];
      const dp = p && p.page === f.page && p.kind !== 'barrier' ? f.firstY - p.lastY : Infinity;
      const dn = n && n.page === f.page && n.kind !== 'barrier' ? n.firstY - f.lastY : Infinity;
      // Empate (diferença menor que 1/4 de linha) favorece a linha de cima: continuação.
      const order: Array<[Group | undefined, number]> = dp <= dn + 0.25 * f.h ? [[p, dp], [n, dn]] : [[n, dn], [p, dp]];
      for (const [target, d] of order) {
        if (!target || d > thr) continue;
        if (target.kind === 'fragment') break; // espera o vizinho se definir
        if (!compatible(f, target)) continue;
        absorb(target, f);
        groups.splice(i, 1);
        i--;
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }

  return groups.map(toLine);
}
