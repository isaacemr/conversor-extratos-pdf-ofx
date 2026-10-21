/**
 * Geração de OFX 1.02 (SGML, padrão — mais compatível com sistemas brasileiros) e 2.2 (XML).
 */
import type { Statement, Transaction } from '../types';
import { centsToDecimal, isoToOfxDate, normalizeForMatch, stripAccents, todayISO } from '../utils/br-format';
import { encodeWindows1252 } from '../utils/encoding';
import { hashHex } from '../utils/hash';

export type OfxVersion = '102' | '220';

export interface WriteOfxOptions {
  /** "102" = OFX 1.02 SGML (padrão); "220" = OFX 2.2 XML. */
  version?: OfxVersion;
  /** Data/hora de geração (DTSERVER). Útil para testes determinísticos. */
  now?: Date;
  /** Remove acentos de MEMO (alguns sistemas antigos não aceitam). */
  stripAccents?: boolean;
}

const MEMO_MAX = 255;
const CRLF = '\r\n';

/** Limpa texto para não quebrar o SGML/XML: sem controles, quebras, "<", ">" e (em SGML) "&". */
export function sanitizeText(s: string, opts: { xml: boolean; stripAccents?: boolean }): string {
  let t = s
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (opts.stripAccents) t = stripAccents(t);
  if (!opts.xml) t = t.replace(/\s*&\s*/g, ' E ');
  t = t.slice(0, MEMO_MAX).trim();
  if (opts.xml) t = t.replace(/&/g, '&amp;');
  return t;
}

/** "AAAAMMDDHHMMSS[-3:BRT]" no horário local. */
export function ofxTimestamp(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, '0');
  const offMin = -d.getTimezoneOffset();
  const offH = offMin / 60;
  const tz = offH === -3 ? 'BRT' : 'GMT';
  const offStr = Number.isInteger(offH) ? `${offH}` : offH.toFixed(2);
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}[${offStr}:${tz}]`
  );
}

/**
 * FITIDs determinísticos: hash de conta + data + valor + descrição + índice de ocorrência
 * entre lançamentos idênticos. Editar/excluir outro lançamento não altera o FITID deste,
 * e reimportar o mesmo extrato não duplica lançamentos. FITIDs já existentes (vindos de
 * um OFX) são preservados.
 */
export function computeFitIds(st: Statement): string[] {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return st.transactions.map((t) => {
    if (t.fitId && !used.has(t.fitId)) {
      used.add(t.fitId);
      return t.fitId;
    }
    const key = [st.account.bankId ?? '', st.account.accountId ?? '', t.date, t.amount, normalizeForMatch(t.description)].join('|');
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    let fit = `${isoToOfxDate(t.date)}${hashHex(`${key}|${n}`)}`;
    while (used.has(fit)) fit = `${isoToOfxDate(t.date)}${hashHex(`${fit}|dup`)}`;
    used.add(fit);
    return fit;
  });
}

const VALID_TRNTYPES = new Set([
  'CREDIT', 'DEBIT', 'INT', 'DIV', 'FEE', 'SRVCHG', 'DEP', 'ATM', 'POS', 'XFER', 'CHECK', 'PAYMENT',
  'CASH', 'DIRECTDEP', 'DIRECTDEBIT', 'REPEATPMT', 'OTHER',
]);

function trnTypeOf(t: Transaction): string {
  if (t.trnType && VALID_TRNTYPES.has(t.trnType)) {
    // Se o sinal foi invertido na revisão, CREDIT/DEBIT originais deixam de fazer sentido.
    if (t.trnType === 'CREDIT' && t.amount < 0) return 'DEBIT';
    if (t.trnType === 'DEBIT' && t.amount > 0) return 'CREDIT';
    return t.trnType;
  }
  return t.amount < 0 ? 'DEBIT' : 'CREDIT';
}

function digits(s: string | undefined): string {
  return (s ?? '').replace(/[^0-9A-Za-z-]/g, '');
}

/** Saldo final usado em LEDGERBAL: informado, ou saldo inicial + movimentações. */
export function resolveClosingBalance(st: Statement): number {
  if (st.closingBalance !== undefined) return st.closingBalance;
  const sum = st.transactions.reduce((a, t) => a + t.amount, 0);
  return (st.openingBalance ?? 0) + sum;
}

export function writeOfx(st: Statement, opts: WriteOfxOptions = {}): string {
  const version = opts.version ?? '102';
  const xml = version === '220';
  const now = opts.now ?? new Date();
  const lines: string[] = [];
  let depth = 0;
  const ind = () => '  '.repeat(depth);
  const open = (tag: string) => {
    lines.push(`${ind()}<${tag}>`);
    depth++;
  };
  const close = (tag: string) => {
    depth--;
    lines.push(`${ind()}</${tag}>`);
  };
  const leaf = (tag: string, value: string) => {
    lines.push(xml ? `${ind()}<${tag}>${value}</${tag}>` : `${ind()}<${tag}>${value}`);
  };

  const sorted = st.transactions.map((t) => t.date).sort();
  const dtStart = st.startDate ?? sorted[0] ?? todayISO(now);
  const dtEnd = st.endDate ?? sorted[sorted.length - 1] ?? todayISO(now);
  const isCard = st.account.accountType === 'CREDITCARD';
  const fitIds = computeFitIds(st);

  if (xml) {
    lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
    lines.push('<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>');
  } else {
    lines.push(
      'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII',
      'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
    );
  }

  open('OFX');
  open('SIGNONMSGSRSV1');
  open('SONRS');
  open('STATUS');
  leaf('CODE', '0');
  leaf('SEVERITY', 'INFO');
  close('STATUS');
  leaf('DTSERVER', ofxTimestamp(now));
  leaf('LANGUAGE', 'POR');
  close('SONRS');
  close('SIGNONMSGSRSV1');

  open(isCard ? 'CREDITCARDMSGSRSV1' : 'BANKMSGSRSV1');
  open(isCard ? 'CCSTMTTRNRS' : 'STMTTRNRS');
  leaf('TRNUID', '1');
  open('STATUS');
  leaf('CODE', '0');
  leaf('SEVERITY', 'INFO');
  close('STATUS');
  open(isCard ? 'CCSTMTRS' : 'STMTRS');
  leaf('CURDEF', st.currency || 'BRL');
  if (isCard) {
    open('CCACCTFROM');
    leaf('ACCTID', digits(st.account.accountId) || '0');
    close('CCACCTFROM');
  } else {
    open('BANKACCTFROM');
    leaf('BANKID', (st.account.bankId ?? '').replace(/\D/g, '').padStart(3, '0').slice(-3));
    if (st.account.branchId) leaf('BRANCHID', digits(st.account.branchId));
    leaf('ACCTID', digits(st.account.accountId) || '0');
    leaf('ACCTTYPE', st.account.accountType ?? 'CHECKING');
    close('BANKACCTFROM');
  }

  open('BANKTRANLIST');
  leaf('DTSTART', isoToOfxDate(dtStart));
  leaf('DTEND', isoToOfxDate(dtEnd));
  st.transactions.forEach((t, i) => {
    open('STMTTRN');
    leaf('TRNTYPE', trnTypeOf(t));
    leaf('DTPOSTED', isoToOfxDate(t.date));
    leaf('TRNAMT', centsToDecimal(t.amount));
    leaf('FITID', sanitizeText(fitIds[i], { xml }).slice(0, 255));
    const check = (t.checkNum ?? '').replace(/[^0-9A-Za-z./-]/g, '').slice(0, 12);
    if (check) leaf('CHECKNUM', check);
    leaf('MEMO', sanitizeText(t.description, { xml, stripAccents: opts.stripAccents }) || 'LANCAMENTO');
    close('STMTTRN');
  });
  close('BANKTRANLIST');

  open('LEDGERBAL');
  leaf('BALAMT', centsToDecimal(resolveClosingBalance(st)));
  leaf('DTASOF', isoToOfxDate(st.closingBalanceDate ?? dtEnd));
  close('LEDGERBAL');
  if (st.availableBalance !== undefined) {
    open('AVAILBAL');
    leaf('BALAMT', centsToDecimal(st.availableBalance));
    leaf('DTASOF', isoToOfxDate(st.availableBalanceDate ?? st.closingBalanceDate ?? dtEnd));
    close('AVAILBAL');
  }
  close(isCard ? 'CCSTMTRS' : 'STMTRS');
  close(isCard ? 'CCSTMTTRNRS' : 'STMTTRNRS');
  close(isCard ? 'CREDITCARDMSGSRSV1' : 'BANKMSGSRSV1');
  close('OFX');

  return lines.join(CRLF) + CRLF;
}

/** Bytes prontos para download: Windows-1252 para 1.02 (CHARSET:1252) e UTF-8 para 2.2. */
export function encodeOfx(text: string, version: OfxVersion = '102'): Uint8Array {
  return version === '220' ? new TextEncoder().encode(text) : encodeWindows1252(text);
}
