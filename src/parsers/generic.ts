/**
 * Parser genérico de extratos bancários brasileiros.
 *
 * Estratégia:
 * 1. Procura a linha de cabeçalho da tabela (Data / Histórico / Documento / Valor / Débito /
 *    Crédito / Saldo) e usa a posição x de cada título para saber a que coluna pertence
 *    cada palavra das linhas seguintes. Isso resolve débito/crédito em colunas separadas.
 *    Sem cabeçalho, usa a posição relativa: o último valor da linha é o saldo, o penúltimo
 *    o lançamento.
 * 2. Linha que começa com data = novo lançamento. Linha sem data mas com valor = novo
 *    lançamento no mesmo dia (bancos que só imprimem a data uma vez). Linha sem data e sem
 *    valor, logo abaixo e alinhada à descrição = continuação da descrição.
 * 3. Linhas de saldo (SALDO ANTERIOR, SALDO DO DIA, SALDO FINAL...) e totais não viram
 *    lançamento, mas os saldos são guardados para conferência.
 * 4. Sinal: indicação explícita (-, D, C, parênteses) > coluna (débito/crédito) > coluna D/C >
 *    seção ("Total de saídas") > palavras-chave (marcado como incerto).
 * 5. Pós-processamento: a cadeia de saldos (saldo anterior + lançamentos = saldo informado)
 *    confirma ou corrige sinais incertos.
 */
import type { TextLine, Word } from '../pdf/extract';
import type { Statement, Transaction } from '../types';
import { newId } from '../types';
import { WEEKDAY_RE, normalizeForMatch, parseBRAmountDetailed, parseBRDate, stripAccents, type DateContext } from '../utils/br-format';
import { detectMetadata } from './metadata';
import { groupRows } from './rows';
import type { BankParser, ParseInput, ParseResult, ParseStats } from './types';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export interface GenericConfig {
  id: string;
  name: string;
  bankCode?: string;
  /** Linhas a ignorar (testadas contra a descrição normalizada: sem acento, maiúsculas). */
  ignore?: RegExp[];
  /** Títulos de seções que não devem ser importadas (até o próximo cabeçalho de tabela). */
  stop?: RegExp[];
  /** Padrões extras de linha de saldo anterior / saldo final. */
  openingBalance?: RegExp[];
  closingBalance?: RegExp[];
  /** Marcadores de seção que definem o sinal dos lançamentos seguintes. */
  sections?: Array<{ pattern: RegExp; sign: 1 | -1 }>;
  /** Palavras-chave extras para deduzir débito/crédito. */
  debitKeywords?: RegExp;
  creditKeywords?: RegExp;
  /** Ajuste final da descrição de cada lançamento (ex.: remover códigos internos do banco). */
  cleanDescription?: (description: string) => string;
}

const OPENING_RE = /^(SALDO|SDO)\.?\s*(ANTERIOR|INICIAL|EM CONTA ANTERIOR|DO MES ANTERIOR|DO PERIODO ANTERIOR)/;
const CLOSING_STRONG_RE = /^(SALDO|SDO)\.?\s*(FINAL|ATUAL|EM CONTA$|DO PERIODO$)/;
const BALANCE_RE = /^(SALDO|SDO|S A L D O)\b/;
/** Saldos que NÃO representam o saldo contábil (incluem limite, aplicações etc.). */
const BALANCE_NOT_LEDGER_RE = /DISPONIVEL|LIMITE|BLOQUEAD|APLIC|INVEST|POUPANCA|CHEQUE ESPECIAL|PROVISORIO/;
const IGNORE_RE = [
  /^(TOTAL|TOTAIS|SUBTOTAL|SUB-TOTAL|SOMA)\b/,
  /^(RESUMO|POSICAO CONSOLIDADA)\b/,
  /^(JUROS|IOF|ENCARGOS)\s+(ACUMULADOS?\s+)?A\s+DEBITAR\b/,
  /^VALOR(ES)?\s+(BLOQUEADO|DISPONIVEL|A COMPENSAR)/,
  /^LIMITE\b/,
];
/** Seções que não devem ser importadas (até o próximo cabeçalho de tabela). */
export const STOP_RE =
  /^(LANCAMENTOS FUTUROS|LANCAMENTOS AGENDADOS|AGENDAMENTOS|PROXIMOS LANCAMENTOS|DEMONSTRATIVO DE (INVESTIMENTOS|APLICACOES)|COMPRAS PARCELADAS - PROXIMAS|RESUMO$|RESUMO DO PERIODO|ENCARGOS (VENCIDOS|A VENCER)|OUTRAS INFORMACOES|INFORMACOES DO COMPROVANTE|NOTAS EXPLICATIVAS)/;
const DEFAULT_SECTIONS: Array<{ pattern: RegExp; sign: 1 | -1 }> = [
  { pattern: /^TOTAL DE (ENTRADAS|CREDITOS|RECEBIMENTOS)\b/, sign: 1 },
  { pattern: /^TOTAL DE (SAIDAS|DEBITOS|PAGAMENTOS)\b/, sign: -1 },
  { pattern: /^(ENTRADAS|CREDITOS|RECEBIMENTOS|DINHEIRO QUE ENTROU)$/, sign: 1 },
  { pattern: /^(SAIDAS|DEBITOS|DINHEIRO QUE SAIU)$/, sign: -1 },
];

const REFUND_RE = /\b(ESTORNO|ESTORNADO|DEVOLUCAO|DEVOLVIDO|REEMBOLSO|CANCELAMENTO)\b/;
const CREDIT_RE =
  /\b(RECEBID[OA]|RECEBIMENTO|DEPOSITO|DEP|SALARIO|PROVENTOS?|RENDIMENTOS?|REND|RESGATE|LIQUIDACAO|CREDITO EM CONTA|TED RECEBIDA|DOC RECEBIDO|TRANSF(ERENCIA)? RECEBIDA|PIX RECEBIDO|ENTRADA)\b/;
const DEBIT_RE =
  /\b(PAGTO|PAGAMENTO|PGTO|PAG|COMPRA|COMPRAS|SAQUE|TARIFA|TAR|ENVIAD[OA]|ENVIO|IOF|JUROS|ENCARGOS?|ANUIDADE|APLICACAO|APLIC|BOLETO|CHEQUE|CH|IMPOSTO|DARF|GPS|FGTS|SEGURO|PRESTACAO|PARCELA|MENSALIDADE|DEBITO AUTOMATICO|DEB AUT|SAIDA)\b/;

// ---------------------------------------------------------------------------
// Cabeçalho e colunas
// ---------------------------------------------------------------------------

export type ColumnRole = 'date' | 'description' | 'doc' | 'amount' | 'debit' | 'credit' | 'balance' | 'dc' | 'other';
export interface Column {
  role: ColumnRole;
  x0: number;
  x1: number;
}

const HEADER_WORDS: Record<string, ColumnRole> = {
  DATA: 'date', DT: 'date', DIA: 'date',
  HISTORICO: 'description', DESCRICAO: 'description', LANCAMENTO: 'description', LANCAMENTOS: 'description',
  ESPECIFICACAO: 'description', MOVIMENTACAO: 'description', MOVIMENTACOES: 'description', DETALHAMENTO: 'description',
  TRANSACAO: 'description', TRANSACOES: 'description', OPERACAO: 'description', DETALHES: 'description', HIST: 'description',
  DOCUMENTO: 'doc', DOC: 'doc', DOCTO: 'doc', NDOC: 'doc', NRDOC: 'doc', NUMDOC: 'doc', REFERENCIA: 'doc', REF: 'doc', AUTENTICACAO: 'doc', ID: 'doc',
  VALOR: 'amount', VALORES: 'amount', MONTANTE: 'amount', QUANTIA: 'amount',
  DEBITO: 'debit', DEBITOS: 'debit', SAIDA: 'debit', SAIDAS: 'debit', RETIRADAS: 'debit',
  CREDITO: 'credit', CREDITOS: 'credit', ENTRADA: 'credit', ENTRADAS: 'credit',
  SALDO: 'balance', SALDOS: 'balance',
  DC: 'dc', CD: 'dc', TIPO: 'dc', NATUREZA: 'dc',
  LOTE: 'other', SITUACAO: 'other', CATEGORIA: 'other', ORIGEM: 'other', AG: 'other', STATUS: 'other',
};
/** Segunda palavra de títulos de data compostos ("Data Valor", "Data Mov."). */
const DATE_SUFFIX = /^(VALOR|MOV|MOVTO|MOVIMENTO|LANC|LANCAMENTO|BALANCETE|CONTABIL|OPERACAO)$/;
const AMOUNT_ROLES: ColumnRole[] = ['amount', 'debit', 'credit', 'balance'];

const lettersOnly = (s: string) => stripAccents(s).toUpperCase().replace(/[^A-Z]/g, '');

/** Reconhece a linha de títulos da tabela e devolve as colunas, ou null. */
export function detectHeader(line: TextLine): Column[] | null {
  // Títulos não têm números (isso descarta linhas como "05/01 SALDO DO DIA 1.000,00").
  if (line.words.some((w) => /\d/.test(w.text))) return null;
  const words = line.words.filter((w) => lettersOnly(w.text) || /^[\/]$/.test(w.text));
  if (words.length < 3 || words.length > 16) return null;
  const cols: Column[] = [];
  let matched = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const key = lettersOnly(w.text);
    const role = HEADER_WORDS[key];
    const prev = cols[cols.length - 1];
    const gap = prev ? w.x0 - prev.x1 : Infinity;
    if (prev && prev.role === 'date' && DATE_SUFFIX.test(key) && gap < 1.5 * line.h) {
      prev.x1 = w.x1;
      matched++;
      continue;
    }
    if (role && prev && gap < 1.2 * line.h && role === 'description' && (prev.role === 'doc' || prev.role === 'description')) {
      // "ID da operação", "Descrição da transação": um único título
      prev.x1 = w.x1;
    } else if (role) {
      cols.push({ role, x0: w.x0, x1: w.x1 });
      matched++;
    } else if (prev && gap < 1.2 * line.h) {
      // complemento do título anterior: "Valor (R$)", "Nº Doc."
      prev.x1 = w.x1;
    } else if (/^(N|NO|NR|NUM)$/.test(key) && words[i + 1] && HEADER_WORDS[lettersOnly(words[i + 1].text)] === 'doc') {
      cols.push({ role: 'doc', x0: w.x0, x1: words[i + 1].x1 });
      matched++;
      i++;
    }
  }
  const roles = new Set(cols.map((c) => c.role));
  const hasAmount = AMOUNT_ROLES.some((r) => roles.has(r));
  if (!roles.has('date') || !hasAmount || matched < 3 || matched / words.length < 0.5) return null;
  cols.sort((a, b) => a.x0 - b.x0);
  const firstDate = cols.find((c) => c.role === 'date')!;
  const firstAmount = cols.find((c) => AMOUNT_ROLES.includes(c.role))!;
  return firstDate.x0 < firstAmount.x0 ? cols : null;
}

/** Coluna (por zona) de uma palavra que não é valor: a última coluna que começa antes dela. */
function zoneOf(w: Word, cols: Column[], h: number): ColumnRole {
  let role: ColumnRole = cols[0]?.role ?? 'description';
  for (const c of cols) if (c.x0 - h <= w.x0) role = c.role;
  return role;
}

/** Coluna de valor mais próxima de um valor numérico (números costumam ser alinhados à direita). */
function nearestAmountColumn(x0: number, x1: number, cols: Column[]): ColumnRole | undefined {
  let best: ColumnRole | undefined;
  let bestD = Infinity;
  for (const c of cols) {
    if (!AMOUNT_ROLES.includes(c.role)) continue;
    const d = Math.min(Math.abs(x1 - c.x1), Math.abs((x0 + x1) / 2 - (c.x0 + c.x1) / 2), Math.abs(x0 - c.x0));
    if (d < bestD) [best, bestD] = [c.role, d];
  }
  return best;
}

// ---------------------------------------------------------------------------
// Datas e valores na linha
// ---------------------------------------------------------------------------

function leadingDate(words: Word[], h: number, ctx: DateContext): { date: string; consumed: number } | null {
  if (!words.length) return null;
  if (!/^\d/.test(words[0].text) && !WEEKDAY_RE.test(normalizeForMatch(words[0].text))) return null;
  for (let k = Math.min(6, words.length); k >= 1; k--) {
    let ok = true;
    for (let i = 1; i < k; i++) if (words[i].x0 - words[i - 1].x1 > 1.5 * h) ok = false;
    if (!ok) continue;
    const date = parseBRDate(
      words
        .slice(0, k)
        .map((w) => w.text)
        .join(' '),
      ctx,
    );
    if (date) return { date, consumed: k };
  }
  return null;
}

interface AmountToken {
  i0: number;
  i1: number;
  x0: number;
  x1: number;
  cents: number;
  sign: -1 | 0 | 1;
}

function findAmounts(words: Word[], h: number): AmountToken[] {
  const out: AmountToken[] = [];
  let i = 0;
  while (i < words.length) {
    let found: AmountToken | null = null;
    for (const len of [3, 2, 1]) {
      if (i + len > words.length) continue;
      let ok = true;
      for (let k = i + 1; k < i + len; k++) if (words[k].x0 - words[k - 1].x1 > 1.5 * h) ok = false;
      if (!ok) continue;
      const p = parseBRAmountDetailed(
        words
          .slice(i, i + len)
          .map((w) => w.text)
          .join(' '),
      );
      if (p) {
        found = { i0: i, i1: i + len - 1, x0: words[i].x0, x1: words[i + len - 1].x1, ...p };
        break;
      }
    }
    if (found) {
      out.push(found);
      i = found.i1 + 1;
    } else {
      i++;
    }
  }
  return out;
}

function signFromIndicator(text: string): -1 | 1 | 0 {
  const raw = text.trim();
  if (raw === '(-)' || raw === '-') return -1;
  if (raw === '(+)' || raw === '+') return 1;
  const t = lettersOnly(raw);
  if (/^(D|DB|DEB|DEBITO|SAIDA|DESPESA)$/.test(t)) return -1;
  if (/^(C|CR|CRED|CREDITO|ENTRADA|RECEITA)$/.test(t)) return 1;
  return 0;
}

/**
 * Posições rotuladas em linhas separadas (Stone): "Instituição  Agência  Conta" e, na linha
 * de baixo, "Stone ...  0001  12345". Usado quando o texto corrido não revela a conta.
 */
export function labeledAccount(lines: TextLine[]): { branchId?: string; accountId?: string } {
  for (let i = 0; i < Math.min(lines.length - 1, 60); i++) {
    const l = lines[i];
    if (l.words.some((w) => /\d/.test(w.text))) continue;
    const ag = l.words.find((w) => lettersOnly(w.text) === 'AGENCIA');
    const cc = l.words.find((w) => lettersOnly(w.text) === 'CONTA');
    if (!ag || !cc) continue;
    const next = lines[i + 1];
    if (next.page !== l.page || next.y - l.y > 3 * l.h) continue;
    const under = (label: Word) =>
      next.words.find((w) => /^\d[\d.-]*[\dX]$/i.test(w.text) && w.x0 >= label.x0 - l.h && w.x0 <= label.x0 + 3 * l.h)?.text;
    return { branchId: under(ag), accountId: under(cc)?.replace(/\./g, '') };
  }
  return {};
}

const signed = (t: AmountToken) => (t.sign === -1 ? -t.cents : t.cents);

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type BalanceKind = 'opening' | 'closingStrong' | 'checkpoint' | 'info';
type Event = { kind: 'tx'; tx: Transaction } | { kind: BalanceKind; value: number };

export function guessSignByKeywords(desc: string, cfg?: GenericConfig): -1 | 1 | 0 {
  const n = normalizeForMatch(desc);
  if (cfg?.creditKeywords?.test(n)) return 1;
  if (cfg?.debitKeywords?.test(n)) return -1;
  if (REFUND_RE.test(n)) return 1;
  if (CREDIT_RE.test(n)) return 1;
  if (DEBIT_RE.test(n)) return -1;
  if (/\bCRED(ITO)?\b|\bCR\b/.test(n)) return 1;
  if (/\bDEB(ITO)?\b|\bDB\b/.test(n)) return -1;
  return 0;
}

/**
 * Ajusta sinais incertos de um grupo de lançamentos para que a soma bata com a variação
 * de saldo informada. Retorna quantos lançamentos foram confirmados/corrigidos.
 */
export function resolveSigns(group: Transaction[], delta: number): number {
  const sum = group.reduce((a, t) => a + t.amount, 0);
  if (sum === delta) {
    const n = group.filter((t) => t.uncertain).length;
    group.forEach((t) => (t.uncertain = false));
    return n;
  }
  const unc = group.filter((t) => t.uncertain);
  if (unc.length === 0 || unc.length > 14) return 0;
  const certainSum = group.filter((t) => !t.uncertain).reduce((a, t) => a + t.amount, 0);
  const target = delta - certainSum;
  let solution = -1;
  let count = 0;
  for (let mask = 0; mask < 1 << unc.length; mask++) {
    let s = 0;
    for (let i = 0; i < unc.length; i++) s += (mask >> i) & 1 ? -Math.abs(unc[i].amount) : Math.abs(unc[i].amount);
    if (s === target) {
      count++;
      solution = mask;
      if (count > 1) break;
    }
  }
  if (count !== 1) return 0;
  unc.forEach((t, i) => {
    t.amount = (solution >> i) & 1 ? -Math.abs(t.amount) : Math.abs(t.amount);
    t.uncertain = false;
  });
  return unc.length;
}

export function parseGeneric(input: ParseInput, cfg: GenericConfig): ParseResult {
  const isBarrier = (l: TextLine) => {
    const n = normalizeForMatch(l.text);
    return detectHeader(l) !== null || STOP_RE.test(n) || (cfg.stop ?? []).some((r) => r.test(n));
  };
  const lines = groupRows(input.lines, isBarrier);
  const meta = detectMetadata(input.lines.map((l) => l.text));
  if (!meta.account.accountId) {
    const lv = labeledAccount(input.lines);
    meta.account.branchId ??= lv.branchId;
    meta.account.accountId ??= lv.accountId;
  }
  const ctx: DateContext = { start: meta.startDate, end: meta.endDate, year: meta.dominantYear };
  const ignore = [...IGNORE_RE, ...(cfg.ignore ?? [])];
  const sections = [...(cfg.sections ?? []), ...DEFAULT_SECTIONS];
  const isOpening = (n: string) => OPENING_RE.test(n) || (cfg.openingBalance ?? []).some((r) => r.test(n));
  const isClosingStrong = (n: string) => CLOSING_STRONG_RE.test(n) || (cfg.closingBalance ?? []).some((r) => r.test(n));

  const stats: ParseStats = {
    lines: input.lines.length,
    balanceLines: 0,
    // linhas absorvidas pela reconstrução de linhas de tabela (+ continuações abaixo)
    continuationLines: input.lines.length - lines.length,
    signsResolvedByBalance: 0,
    headerFound: false,
  };
  const warnings: string[] = [];

  // Índice da primeira linha de cabeçalho em cada página.
  const headerAt = new Map<number, number>();
  const headerCols = new Map<number, Column[]>();
  lines.forEach((l, i) => {
    const cols = detectHeader(l);
    if (cols) {
      headerCols.set(i, cols);
      if (!headerAt.has(l.page)) headerAt.set(l.page, i);
    }
  });
  stats.headerFound = headerCols.size > 0;

  let columns: Column[] | null = null;
  let currentDate: string | undefined;
  let sectionSign: -1 | 1 | 0 = 0;
  let skipping = false;
  let last: { tx: Transaction; page: number; y: number; h: number; descX0: number; conts: number } | null = null;
  const events: Event[] = [];
  /** Lançamentos cujo sinal veio só de palavra-chave. */
  const keywordSigned = new Set<Transaction>();
  /** Estilo de sinal do documento: "-1.234,56" / "-R$" versus "1.234,56 D/C". */
  let minusStyle = 0;
  let dcStyle = 0;

  lines.forEach((line, idx) => {
    if (headerCols.has(idx)) {
      columns = headerCols.get(idx)!;
      skipping = false;
      last = null;
      return;
    }
    const h = line.h || 8;
    const aboveHeader = headerAt.has(line.page) && idx < headerAt.get(line.page)!;
    const cols: Column[] | null = columns;

    // 1. Data no início. Com colunas conhecidas, descarta o que fica à esquerda da tabela
    //    (ex.: legenda "D = débito a compensar" na mesma altura das linhas, no Itaú).
    let words = cols ? line.words.filter((w) => w.x1 > cols[0].x0 - h) : line.words;
    if (!words.length) return;
    let date: string | undefined;
    const dateCol = cols?.find((c) => c.role === 'date');
    const ld = leadingDate(words, h, ctx);
    if (ld && (!dateCol || words[0].x0 <= dateCol.x1 + 2 * h)) {
      date = ld.date;
      words = words.slice(ld.consumed);
      const second = leadingDate(words, h, ctx); // "data valor" / "data balancete"
      if (second) words = words.slice(second.consumed);
    }

    // 2. Valores
    let amounts = findAmounts(words, h);
    const amountWordIdx = new Set<number>();
    let valueTok: AmountToken | undefined;
    let valueRole: ColumnRole | undefined;
    let balanceTok: AmountToken | undefined;
    let dcSign: -1 | 1 | 0 = 0;
    let balanceDc: -1 | 1 | 0 = 0;
    const descWords: Word[] = [];
    const docWords: Word[] = [];

    if (cols) {
      const amountCols = cols.filter((c) => AMOUNT_ROLES.includes(c.role));
      const zoneStart = Math.min(...amountCols.map((c) => c.x0)) - 0.5 * h;
      amounts = amounts.filter((t) => t.x1 >= zoneStart);
      for (const t of amounts) {
        for (let k = t.i0; k <= t.i1; k++) amountWordIdx.add(k);
        const role = nearestAmountColumn(t.x0, t.x1, cols);
        if (role === 'balance') balanceTok = t;
        else if (!valueTok) {
          valueTok = t;
          valueRole = role;
        }
      }
      words.forEach((w, k) => {
        if (amountWordIdx.has(k)) return;
        const zone = zoneOf(w, cols, h);
        const ind = signFromIndicator(w.text);
        if (zone === 'doc') docWords.push(w);
        else if (zone === 'dc') dcSign = ind || dcSign;
        else if (zone === 'balance' && ind) balanceDc = ind;
        else if ((zone === 'amount' || zone === 'debit' || zone === 'credit') && ind && w.text.length <= 7) dcSign = ind;
        else if (zone === 'other') return;
        else if (zone === 'date' && /^\d{1,2}:\d{2}/.test(w.text)) return;
        else descWords.push(w);
      });
    } else {
      // Sem cabeçalho: só valores no fim da linha contam; indicadores D/C soltos são anexados.
      let end = words.length - 1;
      const trailing: AmountToken[] = [];
      let pendingSign: -1 | 1 | 0 = 0;
      while (end >= 0) {
        const tok = amounts.find((t) => t.i1 === end);
        if (tok) {
          if (pendingSign && tok.sign === 0) tok.sign = pendingSign;
          pendingSign = 0;
          trailing.unshift(tok);
          end = tok.i0 - 1;
        } else if (/^[*+\-]$|^[DC]$/i.test(words[end].text) && end > 0) {
          pendingSign = signFromIndicator(words[end].text);
          end--;
        } else break;
      }
      if (trailing.length >= 2) {
        valueTok = trailing[trailing.length - 2];
        balanceTok = trailing[trailing.length - 1];
      } else {
        valueTok = trailing[0];
      }
      const firstAmountIdx = trailing.length ? trailing[0].i0 : words.length;
      const rest = words.slice(0, firstAmountIdx);
      // Coluna de tipo sem cabeçalho: "... PIX RECEBIDO      CREDITO  R$ 1.232,81" (palavra isolada
      // por um espaço largo logo antes do valor).
      const typeW = rest[rest.length - 1];
      const beforeType = rest[rest.length - 2];
      if (valueTok && valueTok.sign === 0 && typeW && beforeType && typeW.x0 - beforeType.x1 > 2 * h) {
        const ind = signFromIndicator(typeW.text);
        if (ind && typeW.text.length > 1) {
          dcSign = ind;
          rest.pop();
        }
      }
      // Documento: número isolado logo antes dos valores, separado por um espaço largo.
      const lastW = rest[rest.length - 1];
      const prevW = rest[rest.length - 2];
      if (lastW && prevW && /^\d{3,}$/.test(lastW.text) && lastW.x0 - prevW.x1 > 1.5 * h && trailing.length) {
        docWords.push(lastW);
        rest.pop();
      }
      descWords.push(...rest);
    }

    const description = descWords
      .map((w) => w.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/^[-–:|\s]+|[-–:|\s]+$/g, '')
      .trim();
    // Para classificar, ignora códigos numéricos no início ("000 Saldo Anterior", "999 S A L D O",
    // "00/00/0000 Saldo do dia").
    const norm = normalizeForMatch(description).replace(/^([\d./-]+\s+)+/, '');

    // 3. Seções a pular
    if (!valueTok && !balanceTok && (STOP_RE.test(norm) || (cfg.stop ?? []).some((r) => r.test(norm)))) {
      skipping = true;
      last = null;
      return;
    }
    if (skipping) return;

    // 4. Marcadores de seção (Nubank: "Total de entradas"/"Total de saídas"). Quadros de
    //    resumo acima da tabela ("Saídas: R$ ...") não definem seção.
    for (const s of aboveHeader ? [] : sections) {
      if (s.pattern.test(norm)) {
        sectionSign = s.sign;
        break;
      }
    }

    // 5. Linhas de saldo
    if (BALANCE_RE.test(norm)) {
      stats.balanceLines++;
      last = null;
      const tok = balanceTok ?? valueTok;
      if (tok) {
        let value = signed(tok);
        if (tok === balanceTok && balanceDc && tok.sign === 0) value = balanceDc * tok.cents;
        let kind: BalanceKind;
        if ((cfg.ignore ?? []).some((r) => r.test(norm))) kind = 'info';
        else if (isOpening(norm)) kind = 'opening';
        else if (BALANCE_NOT_LEDGER_RE.test(norm)) kind = 'info';
        else if (isClosingStrong(norm)) kind = 'closingStrong';
        else kind = 'checkpoint';
        events.push({ kind, value });
      }
      if (date && !isOpening(norm) && !aboveHeader) currentDate = date;
      return;
    }
    if (aboveHeader) return;

    // 6. Linhas ignoradas (totais etc.)
    if (ignore.some((r) => r.test(norm)) || sections.some((s) => s.pattern.test(norm))) {
      stats.balanceLines++;
      if (date) currentDate = date;
      last = null;
      return;
    }

    if (date) currentDate = date;

    // 7. Sem valor: continuação da descrição anterior?
    if (!valueTok) {
      const prev = last as typeof last;
      if (
        !date &&
        prev &&
        description &&
        prev.page === line.page &&
        line.y > prev.y &&
        line.y - prev.y <= 2.6 * Math.max(h, prev.h) &&
        line.words[0].x0 >= prev.descX0 - h &&
        prev.conts < 4
      ) {
        prev.tx.description = `${prev.tx.description} ${description}`.trim();
        prev.y = line.y;
        prev.conts++;
        stats.continuationLines++;
      } else if (date) {
        last = null;
      }
      return;
    }
    if (!currentDate) return;
    if (!date && !description) return;
    if (!date && valueTok.cents === 0) return; // linhas informativas "0,00" (quadros de resumo)

    // 8. Sinal
    let amount = valueTok.cents;
    let uncertain = false;
    if (valueTok.sign !== 0) {
      amount *= valueTok.sign;
      const raw = words.slice(valueTok.i0, valueTok.i1 + 1).map((w) => w.text).join(' ');
      if (/(D|C|DB|CR|\([+-]\))\s*$/i.test(raw)) dcStyle++;
      else if (valueTok.sign === -1) minusStyle++;
    } else if (valueRole === 'debit') amount = -amount;
    else if (valueRole === 'credit') amount = +amount;
    else if (dcSign) amount *= dcSign;
    else if (sectionSign) amount *= sectionSign;
    else {
      const k = guessSignByKeywords(description, cfg);
      amount *= k === 0 ? 1 : k;
      uncertain = true;
    }

    const tx: Transaction = {
      id: newId(),
      date: currentDate,
      description,
      amount,
      uncertain,
      source: input.fileName,
    };
    const checkNum = docWords
      .map((w) => w.text)
      .join('')
      .replace(/[^0-9A-Za-z./-]/g, '');
    if (checkNum) tx.checkNum = checkNum;
    if (balanceTok) {
      tx.balance = balanceDc && balanceTok.sign === 0 ? balanceDc * balanceTok.cents : signed(balanceTok);
    }
    if (uncertain) keywordSigned.add(tx);
    events.push({ kind: 'tx', tx });
    last = { tx, page: line.page, y: line.y, h, descX0: descWords[0]?.x0 ?? line.words[0].x0, conts: 0 };
  });

  // Documento que marca débitos com "-" (e não usa D/C): valor sem sinal é crédito.
  if (minusStyle > 0 && dcStyle === 0) {
    for (const tx of keywordSigned) {
      tx.amount = Math.abs(tx.amount);
      tx.uncertain = false;
    }
  }

  // Extratos do mais recente para o mais antigo (ex.: Stone): passa para a ordem cronológica.
  const txEvents = events.flatMap((e) => (e.kind === 'tx' ? [e.tx] : []));
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < txEvents.length; i++) {
    if (txEvents[i].date > txEvents[i - 1].date) asc++;
    else if (txEvents[i].date < txEvents[i - 1].date) desc++;
  }
  if (desc > asc) {
    events.reverse();
    // Saldo inicial/final de resumo continuam no início/fim da cadeia.
    const openings = events.filter((e) => e.kind === 'opening');
    const closings = events.filter((e) => e.kind === 'closingStrong');
    const middle = events.filter((e) => e.kind !== 'opening' && e.kind !== 'closingStrong');
    events.splice(0, events.length, ...openings, ...middle, ...closings);
  }

  // Quando cada lançamento traz o próprio saldo, ele é a referência mais precisa; linhas de
  // "saldo do dia" podem vir antes dos lançamentos do dia (Inter) e confundiriam a cadeia.
  const perRowBalance = txEvents.length > 0 && txEvents.filter((t) => t.balance !== undefined).length / txEvents.length >= 0.6;

  // Pós-processamento: cadeia de saldos
  let prev: number | undefined;
  let group: Transaction[] = [];
  let opening: number | undefined;
  let derivedOpening: number | undefined;
  let closingStrong: number | undefined;
  let seenTx = false;
  const checkpoint = (b: number) => {
    if (group.length) {
      if (prev !== undefined) stats.signsResolvedByBalance += resolveSigns(group, b - prev);
      else if (opening === undefined && derivedOpening === undefined && group.every((t) => !t.uncertain)) {
        derivedOpening = b - group.reduce((a, t) => a + t.amount, 0);
      }
    } else if (prev === undefined && opening === undefined && derivedOpening === undefined && !seenTx) {
      derivedOpening = b;
    }
    prev = b;
    group = [];
  };
  for (const ev of events) {
    if (ev.kind === 'tx') {
      seenTx = true;
      group.push(ev.tx);
      if (ev.tx.balance !== undefined) checkpoint(ev.tx.balance);
    } else if (ev.kind === 'opening') {
      if (!seenTx && opening === undefined) {
        opening = ev.value;
        prev = ev.value;
      } else checkpoint(ev.value);
    } else if (ev.kind === 'closingStrong') {
      closingStrong = ev.value;
      checkpoint(ev.value);
    } else if (ev.kind === 'checkpoint' && !perRowBalance) {
      checkpoint(ev.value);
    }
  }
  const transactions = events.flatMap((e) => (e.kind === 'tx' ? [e.tx] : []));

  // Descrição: "DOC.: 123" vira número do documento; ajustes específicos do banco.
  for (const tx of transactions) {
    tx.description = tx.description
      .replace(/\s*\bDOC\.?\s*:\s*(\S+)/gi, (_, v: string) => {
        if (/^\d[\d./-]*$/.test(v) && !tx.checkNum) tx.checkNum = v;
        return '';
      })
      .replace(/\s+/g, ' ')
      .trim();
    if (cfg.cleanDescription) tx.description = cfg.cleanDescription(tx.description);
  }
  const closing = closingStrong ?? (group.length === 0 ? prev : undefined);

  const dates = transactions.map((t) => t.date).sort();
  const statement: Statement = {
    account: { accountType: 'CHECKING', ...meta.account },
    currency: 'BRL',
    startDate: meta.startDate ?? dates[0],
    endDate: meta.endDate ?? dates[dates.length - 1],
    transactions,
    openingBalance: opening ?? derivedOpening,
    closingBalance: closing,
  };
  if (cfg.bankCode && !statement.account.bankId) statement.account.bankId = cfg.bankCode;

  const unc = transactions.filter((t) => t.uncertain).length;
  if (unc > 0) {
    warnings.push(
      `${unc} lançamento(s) sem indicação clara de crédito/débito — o tipo foi deduzido pela descrição. Confira os destacados.`,
    );
  }
  const balanced =
    statement.openingBalance !== undefined &&
    statement.closingBalance !== undefined &&
    statement.openingBalance + transactions.reduce((a, t) => a + t.amount, 0) === statement.closingBalance;
  if (!stats.headerFound && transactions.length > 0 && !(balanced && unc === 0)) {
    warnings.push('Não encontramos o cabeçalho da tabela (Data/Histórico/Valor). As colunas foram deduzidas pela posição.');
  }
  if (input.ocr) warnings.push('Texto obtido por OCR: revise datas, valores e descrições com atenção.');

  return { parserId: cfg.id, parserName: cfg.name, statement, warnings, stats };
}

export function createGenericParser(cfg: GenericConfig, detect?: BankParser['detect']): BankParser {
  return {
    id: cfg.id,
    name: cfg.name,
    bankCode: cfg.bankCode,
    detect: detect ?? ((_input, code) => (cfg.bankCode && code === cfg.bankCode ? 0.8 : 0)),
    parse: (input) => parseGeneric(input, cfg),
  };
}

export const genericParser: BankParser = createGenericParser({ id: 'generic', name: 'Genérico' }, () => 0.1);
