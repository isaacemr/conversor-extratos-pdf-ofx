/**
 * Leitor de OFX 1.x (SGML, tags de valor sem fechamento) e 2.x (XML).
 *
 * Um único tokenizador atende os dois formatos: uma tag seguida de texto é uma "folha"
 * (o fechamento é opcional e, se existir, é consumido); uma tag seguida de outra tag é
 * um agregado, fechado por </TAG> (fechamentos ausentes são tolerados).
 */
import type { AccountInfo, AccountType, Statement, Transaction } from '../types';
import { newId } from '../types';
import { decimalToCents, ofxDateToISO } from '../utils/br-format';
import { decodeText } from '../utils/encoding';
import { bankName } from '../utils/banks';

export interface OfxNode {
  name: string;
  /** Presente apenas em folhas. */
  value?: string;
  children: OfxNode[];
}

export interface OfxDocument {
  version: 1 | 2;
  header: Record<string, string>;
  encoding: 'utf-8' | 'windows-1252' | 'text';
  org?: string;
  fid?: string;
  statements: Statement[];
  warnings: string[];
  root: OfxNode;
}

export class OfxParseError extends Error {}

/** Elementos que são sempre valores (mesmo vazios), para não confundir com agregados em SGML. */
const KNOWN_LEAVES = new Set([
  'TRNTYPE', 'DTPOSTED', 'DTUSER', 'DTAVAIL', 'TRNAMT', 'FITID', 'CORRECTFITID', 'CORRECTACTION',
  'SRVRTID', 'CHECKNUM', 'REFNUM', 'SIC', 'PAYEEID', 'NAME', 'MEMO', 'BANKID', 'BRANCHID', 'ACCTID',
  'ACCTTYPE', 'ACCTKEY', 'DTSTART', 'DTEND', 'BALAMT', 'DTASOF', 'CURDEF', 'CODE', 'SEVERITY',
  'MESSAGE', 'DTSERVER', 'LANGUAGE', 'DTPROFUP', 'DTACCTUP', 'ORG', 'FID', 'TRNUID', 'CLTCOOKIE',
  'CURRATE', 'CURSYM', 'MKTGINFO', 'INTU.BID', 'INTU.USERID',
]);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const cp = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
    }
    return ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

type Token = { kind: 'open' | 'close' | 'empty'; name: string } | { kind: 'text'; text: string };

function tokenize(body: string): Token[] {
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t: string) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  );
  const tokens: Token[] = [];
  const re = /<\s*(\/?)\s*([A-Za-z0-9_.:-]+)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    if (m[4] !== undefined) {
      tokens.push({ kind: 'text', text: m[4] });
    } else {
      const name = m[2].toUpperCase();
      if (m[1]) tokens.push({ kind: 'close', name });
      else if (m[3].trim().endsWith('/')) tokens.push({ kind: 'empty', name });
      else tokens.push({ kind: 'open', name });
    }
  }
  return tokens;
}

function buildTree(tokens: Token[]): OfxNode {
  const root: OfxNode = { name: '#root', children: [] };
  const stack: OfxNode[] = [root];
  const top = () => stack[stack.length - 1];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'text') continue; // texto solto entre agregados (espaços)
    if (t.kind === 'empty') {
      top().children.push({ name: t.name, value: '', children: [] });
      continue;
    }
    if (t.kind === 'open') {
      const next = tokens[i + 1];
      const text = next && next.kind === 'text' ? next.text.trim() : '';
      if (text || KNOWN_LEAVES.has(t.name)) {
        top().children.push({ name: t.name, value: decodeEntities(text), children: [] });
        if (next && next.kind === 'text') i++;
        const after = tokens[i + 1];
        if (after && after.kind === 'close' && after.name === t.name) i++;
      } else {
        const node: OfxNode = { name: t.name, children: [] };
        top().children.push(node);
        stack.push(node);
      }
      continue;
    }
    // close
    for (let j = stack.length - 1; j > 0; j--) {
      if (stack[j].name === t.name) {
        stack.length = j;
        break;
      }
    }
  }
  return root;
}

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

export function child(node: OfxNode | undefined, name: string): OfxNode | undefined {
  return node?.children.find((c) => c.name === name);
}

export function childValue(node: OfxNode | undefined, name: string): string | undefined {
  const c = child(node, name);
  return c?.value !== undefined ? c.value : undefined;
}

export function findAll(node: OfxNode, name: string, out: OfxNode[] = []): OfxNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    else findAll(c, name, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cabeçalho
// ---------------------------------------------------------------------------

function parseHeader(text: string): { header: Record<string, string>; version: 1 | 2; body: string } {
  const header: Record<string, string> = {};
  const ofxPi = /<\?OFX([^?]*)\?>/i.exec(text);
  if (ofxPi || /^\s*<\?xml/i.test(text)) {
    if (ofxPi) {
      for (const m of ofxPi[1].matchAll(/([A-Z]+)\s*=\s*"([^"]*)"/gi)) header[m[1].toUpperCase()] = m[2];
    }
    const idx = text.search(/<OFX[\s>]/i);
    return { header, version: 2, body: idx >= 0 ? text.slice(idx) : text };
  }
  const idx = text.search(/<OFX[\s>]/i);
  const head = idx >= 0 ? text.slice(0, idx) : '';
  for (const line of head.split(/\r?\n|\r/)) {
    const m = /^\s*([A-Z]+)\s*:\s*(.*?)\s*$/i.exec(line);
    if (m) header[m[1].toUpperCase()] = m[2];
  }
  const v = parseInt(header.VERSION ?? '', 10);
  return { header, version: v >= 200 ? 2 : 1, body: idx >= 0 ? text.slice(idx) : text };
}

// ---------------------------------------------------------------------------
// Conversão para o modelo
// ---------------------------------------------------------------------------

const ACCOUNT_TYPES: AccountType[] = ['CHECKING', 'SAVINGS', 'MONEYMRKT', 'CREDITLINE', 'CREDITCARD'];

function buildDescription(name?: string, memo?: string): string {
  const n = (name ?? '').trim();
  const m = (memo ?? '').trim();
  if (n && m) {
    const un = n.toUpperCase();
    const um = m.toUpperCase();
    if (um.includes(un)) return m;
    if (un.includes(um)) return n;
    return `${n} - ${m}`;
  }
  return m || n;
}

function parseStatement(stmtrs: OfxNode, warnings: string[]): Statement {
  const isCard = stmtrs.name === 'CCSTMTRS';
  const acctNode = child(stmtrs, isCard ? 'CCACCTFROM' : 'BANKACCTFROM') ?? child(stmtrs, 'BANKACCTFROM');
  const bankId = childValue(acctNode, 'BANKID');
  const rawType = (childValue(acctNode, 'ACCTTYPE') ?? '').toUpperCase() as AccountType;
  const account: AccountInfo = {
    bankId: bankId ? bankId.replace(/\D/g, '').padStart(3, '0').slice(-3) : undefined,
    branchId: childValue(acctNode, 'BRANCHID'),
    accountId: childValue(acctNode, 'ACCTID'),
    accountType: isCard ? 'CREDITCARD' : ACCOUNT_TYPES.includes(rawType) ? rawType : 'CHECKING',
  };
  account.bankName = bankName(account.bankId) || undefined;

  const list = child(stmtrs, 'BANKTRANLIST');
  const transactions: Transaction[] = [];
  let debitWithPositive = 0;
  for (const trn of list ? findAll(list, 'STMTTRN') : []) {
    const date = ofxDateToISO(childValue(trn, 'DTPOSTED') ?? '') ?? ofxDateToISO(childValue(trn, 'DTUSER') ?? '');
    const amount = decimalToCents(childValue(trn, 'TRNAMT') ?? '');
    if (!date || amount === null) {
      warnings.push(`Lançamento ignorado por data ou valor inválido (FITID ${childValue(trn, 'FITID') ?? '?'}).`);
      continue;
    }
    const trnType = (childValue(trn, 'TRNTYPE') ?? '').toUpperCase() || undefined;
    if (trnType === 'DEBIT' && amount > 0) debitWithPositive++;
    transactions.push({
      id: newId(),
      date,
      amount,
      description: buildDescription(childValue(trn, 'NAME'), childValue(trn, 'MEMO')),
      checkNum: childValue(trn, 'CHECKNUM') || childValue(trn, 'REFNUM') || undefined,
      fitId: childValue(trn, 'FITID') || undefined,
      trnType,
    });
  }
  if (debitWithPositive > 0) {
    warnings.push(
      `${debitWithPositive} lançamento(s) com TRNTYPE=DEBIT e valor positivo. O sinal do TRNAMT foi mantido (padrão OFX); confira.`,
    );
  }

  const ledger = child(stmtrs, 'LEDGERBAL');
  const avail = child(stmtrs, 'AVAILBAL');
  const ledgerAmt = decimalToCents(childValue(ledger, 'BALAMT') ?? '');
  const availAmt = decimalToCents(childValue(avail, 'BALAMT') ?? '');

  const dates = transactions.map((t) => t.date).sort();
  return {
    account,
    currency: childValue(stmtrs, 'CURDEF') || 'BRL',
    startDate: ofxDateToISO(childValue(list, 'DTSTART') ?? '') ?? dates[0],
    endDate: ofxDateToISO(childValue(list, 'DTEND') ?? '') ?? dates[dates.length - 1],
    transactions,
    closingBalance: ledgerAmt ?? undefined,
    closingBalanceDate: ofxDateToISO(childValue(ledger, 'DTASOF') ?? '') ?? undefined,
    availableBalance: availAmt ?? undefined,
    availableBalanceDate: ofxDateToISO(childValue(avail, 'DTASOF') ?? '') ?? undefined,
  };
}

/** Lê um OFX a partir do texto ou dos bytes do arquivo. */
export function parseOfx(input: string | Uint8Array): OfxDocument {
  let text: string;
  let encoding: OfxDocument['encoding'] = 'text';
  if (typeof input === 'string') {
    text = input.replace(/^﻿/, '');
  } else {
    const decoded = decodeText(input);
    text = decoded.text;
    encoding = decoded.encoding;
  }
  if (!/<OFX[\s>]/i.test(text)) {
    throw new OfxParseError('O arquivo não parece ser um OFX válido (tag <OFX> não encontrada).');
  }
  const { header, version, body } = parseHeader(text);
  const root = buildTree(tokenize(body));
  const ofx = findAll(root, 'OFX')[0] ?? root;
  const warnings: string[] = [];

  const stmts = [...findAll(ofx, 'STMTRS'), ...findAll(ofx, 'CCSTMTRS')];
  if (stmts.length === 0) {
    throw new OfxParseError('Nenhum extrato (STMTRS) encontrado no arquivo OFX.');
  }
  const fi = findAll(ofx, 'FI')[0];
  return {
    version,
    header,
    encoding,
    org: childValue(fi, 'ORG'),
    fid: childValue(fi, 'FID'),
    statements: stmts.map((s) => parseStatement(s, warnings)),
    warnings,
    root,
  };
}
