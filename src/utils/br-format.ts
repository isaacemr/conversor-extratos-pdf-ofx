/**
 * Utilitários de formato brasileiro: valores (1.234,56) e datas (dd/mm/aaaa, "05 JAN"...).
 * Valores são tratados como inteiros em centavos.
 */

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** Remove acentos/diacríticos ("Débito" → "Debito"). */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Normaliza para comparação: sem acentos, maiúsculas, espaços colapsados. */
export function normalizeForMatch(s: string): string {
  return stripAccents(s).toUpperCase().replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------------

export interface ParsedAmount {
  /** Valor absoluto em centavos. */
  cents: number;
  /** -1 débito explícito, +1 crédito explícito, 0 sem indicação de sinal. */
  sign: -1 | 0 | 1;
}

const MINUS_CHARS = /[−–—]/g; // − – —

// Número BR: 1.234.567,89 ou 1234567,89 (exatamente 2 casas decimais).
const BR_NUMBER = String.raw`(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})`;
const AMOUNT_RE = new RegExp(
  String.raw`^([+-])?\s*(?:R\$\s*)?([+-])?\s*` + BR_NUMBER + String.raw`\s*([+-]|DB|CR|D|C)?$`,
  'i',
);

/**
 * Interpreta um valor monetário no padrão brasileiro, preservando a indicação de sinal.
 * Aceita: "1.234,56", "-1.234,56", "1.234,56-", "1.234,56 D", "1.234,56 C",
 * "(1.234,56)", "R$ 1.234,56", "- R$ 1.234,56", "R$ -1.234,56", "+ 10,00".
 * Retorna null se o texto não for um valor válido.
 */
export function parseBRAmountDetailed(input: string): ParsedAmount | null {
  let s = input.trim().replace(MINUS_CHARS, '-').replace(/ /g, ' ');
  if (!s) return null;
  let paren = false;
  const parenMatch = /^\((.*)\)$/.exec(s);
  if (parenMatch) {
    paren = true;
    s = parenMatch[1].trim();
  }
  const m = AMOUNT_RE.exec(s);
  if (!m) return null;
  const [, lead1, lead2, intPart, dec, trail] = m;
  const cents = parseInt(intPart.replace(/\./g, ''), 10) * 100 + parseInt(dec, 10);
  const signs: Array<-1 | 1> = [];
  if (paren) signs.push(-1);
  for (const t of [lead1, lead2]) if (t) signs.push(t === '-' ? -1 : 1);
  if (trail) {
    const t = trail.toUpperCase();
    signs.push(t === '-' || t === 'D' || t === 'DB' ? -1 : 1);
  }
  if (signs.length === 0) return { cents, sign: 0 };
  // Qualquer indicação de débito prevalece ("(-1,00)" continua débito).
  return { cents, sign: signs.includes(-1) ? -1 : 1 };
}

/** Valor em centavos com sinal (sem indicação = positivo), ou null. */
export function parseBRAmount(input: string): number | null {
  const p = parseBRAmountDetailed(input);
  if (!p) return null;
  return p.sign === -1 ? -p.cents : p.cents;
}

/**
 * Leitura tolerante de valores digitados pelo usuário:
 * "1234", "1234,5", "1.234,56", "-50", "R$ 10", "1234.56" (ponto decimal com 1-2 casas).
 */
export function parseUserAmount(input: string): number | null {
  const strict = parseBRAmount(input);
  if (strict !== null) return strict;
  let s = input.trim().replace(MINUS_CHARS, '-').replace(/R\$\s*/i, '').replace(/\s+/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  let intPart: string;
  let decPart = '';
  if (/^\d+(\.\d{3})*(,\d{1,2})?$/.test(s)) {
    const [i, d = ''] = s.split(',');
    intPart = i.replace(/\./g, '');
    decPart = d;
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [intPart, decPart] = s.split('.');
  } else {
    return null;
  }
  const cents = parseInt(intPart, 10) * 100 + parseInt(decPart.padEnd(2, '0') || '0', 10);
  return neg ? -cents : cents;
}

/** Formata centavos como "1.234,56" (com "-" se negativo). Use `symbol` para prefixar "R$ ". */
export function formatBRL(cents: number, opts: { symbol?: boolean; plus?: boolean } = {}): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const int = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = (abs % 100).toString().padStart(2, '0');
  const body = `${opts.symbol ? 'R$ ' : ''}${int},${dec}`;
  if (neg) return `-${body}`;
  if (opts.plus && cents > 0) return `+${body}`;
  return body;
}

/** Centavos → string decimal com ponto, como exige o OFX ("-1234.56"). */
export function centsToDecimal(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const s = `${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/**
 * Lê valores decimais de OFX. Aceita ponto ou vírgula como separador decimal
 * (alguns bancos brasileiros geram TRNAMT com vírgula).
 */
export function decimalToCents(input: string): number | null {
  let s = input.trim().replace(/\s+/g, '').replace(MINUS_CHARS, '-');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > -1 && lastComma > -1) {
    s = s.replace(/,/g, '');
  }
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const neg = s.startsWith('-');
  s = s.replace(/^[+-]/, '');
  const [i, d = ''] = s.split('.');
  // Arredonda pela 3ª casa decimal, se existir.
  const d3 = (d + '000').slice(0, 3);
  let cents = parseInt(i || '0', 10) * 100 + parseInt(d3.slice(0, 2), 10);
  if (parseInt(d3[2], 10) >= 5) cents += 1;
  return neg ? -cents : cents;
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  JAN: 1, JANEIRO: 1,
  FEV: 2, FEVEREIRO: 2, FEB: 2,
  MAR: 3, MARCO: 3,
  ABR: 4, ABRIL: 4, APR: 4,
  MAI: 5, MAIO: 5, MAY: 5,
  JUN: 6, JUNHO: 6,
  JUL: 7, JULHO: 7,
  AGO: 8, AGOSTO: 8, AUG: 8,
  SET: 9, SETEMBRO: 9, SEP: 9,
  OUT: 10, OUTUBRO: 10, OCT: 10,
  NOV: 11, NOVEMBRO: 11,
  DEZ: 12, DEZEMBRO: 12, DEC: 12,
};

/** Converte nome/abreviação de mês em português (ou inglês) para 1-12. */
export function monthFromName(name: string): number | null {
  const key = stripAccents(name).toUpperCase().replace(/\.$/, '');
  return MONTHS[key] ?? null;
}

export function isValidYMD(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

export function toISO(y: number, m: number, d: number): string {
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

export interface DateContext {
  /** Ano padrão para datas sem ano. */
  year?: number;
  /** Período conhecido do extrato (ISO), usado para inferir o ano de "dd/mm". */
  start?: string;
  end?: string;
}

/** Escolhe o ano de uma data sem ano usando o período do extrato, se conhecido. */
export function inferYear(month: number, day: number, ctx: DateContext = {}): number {
  if (ctx.start && ctx.end) {
    const ys = parseInt(ctx.start.slice(0, 4), 10);
    const ye = parseInt(ctx.end.slice(0, 4), 10);
    let best = ye;
    let bestDist = Infinity;
    for (let y = ys; y <= ye; y++) {
      if (!isValidYMD(y, month, day)) continue;
      const iso = toISO(y, month, day);
      const dist = iso < ctx.start ? daysBetween(iso, ctx.start) : iso > ctx.end ? daysBetween(ctx.end, iso) : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = y;
      }
    }
    return best;
  }
  if (ctx.year) return ctx.year;
  if (ctx.end) return parseInt(ctx.end.slice(0, 4), 10);
  if (ctx.start) return parseInt(ctx.start.slice(0, 4), 10);
  return new Date().getFullYear();
}

function expandYear(y: string): number {
  const n = parseInt(y, 10);
  return y.length === 2 ? 2000 + n : n;
}

/**
 * Interpreta uma data em formatos brasileiros comuns. Retorna ISO "AAAA-MM-DD" ou null.
 * Formatos: dd/mm/aaaa, dd/mm/aa, dd-mm-aaaa, dd.mm.aaaa, dd/mm, "05 JAN", "05/JAN/2024",
 * "05 JAN 2024", "05 de janeiro de 2024", e ISO aaaa-mm-dd.
 */
export function parseBRDate(input: string, ctx: DateContext = {}): string | null {
  const s = stripAccents(input.trim()).toUpperCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let m: RegExpExecArray | null;
  let y: number, mo: number, d: number;

  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
  } else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s))) {
    [d, mo, y] = [+m[1], +m[2], expandYear(m[3])];
  } else if ((m = /^(\d{1,2})[/.-](\d{1,2})$/.exec(s))) {
    [d, mo] = [+m[1], +m[2]];
    y = inferYear(mo, d, ctx);
  } else if ((m = /^(\d{1,2})(?:\s*[/.-]\s*|\s+DE\s+|\s+)([A-Z]{3,9})\.?(?:(?:\s*[/.-]\s*|\s+DE\s+|\s+)(\d{4}|\d{2}))?$/.exec(s))) {
    const month = monthFromName(m[2]);
    if (!month) return null;
    d = +m[1];
    mo = month;
    y = m[3] ? expandYear(m[3]) : inferYear(mo, d, ctx);
  } else {
    return null;
  }
  return isValidYMD(y, mo, d) ? toISO(y, mo, d) : null;
}

/** ISO → "dd/mm/aaaa". */
export function formatBRDate(iso: string | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** ISO → "AAAAMMDD" (OFX). */
export function isoToOfxDate(iso: string): string {
  return iso.replace(/-/g, '').slice(0, 8);
}

/**
 * Data OFX → ISO. Aceita "20240105", "20240105120000", "20240105120000[-3:BRT]",
 * "20240105120000.000[-03:EST]". Considera apenas a parte de data.
 */
export function ofxDateToISO(s: string): string | null {
  const m = /^\s*(\d{4})(\d{2})(\d{2})/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  return isValidYMD(y, mo, d) ? toISO(y, mo, d) : null;
}

export function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / 86400000);
}

export function todayISO(now: Date = new Date()): string {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** "dd/mm/aaaa hh:mm" no horário local. */
export function formatBRDateTime(now: Date = new Date()): string {
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}`;
}
