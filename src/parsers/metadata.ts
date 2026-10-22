/**
 * Detecção de metadados do extrato no texto: banco, agência, conta, tipo de conta e período.
 * O que não for encontrado fica undefined e o usuário preenche no formulário.
 */
import type { AccountInfo } from '../types';
import { BANKS, bankByCode } from '../utils/banks';
import { normalizeForMatch, parseBRDate } from '../utils/br-format';

export interface DetectedMetadata {
  account: AccountInfo;
  startDate?: string;
  endDate?: string;
  /** Ano mais frequente entre as datas completas do documento (para datas sem ano). */
  dominantYear?: number;
}

const DATE_PAT = String.raw`(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}(?:\s+DE)?\s+[A-Z]{3,9}\.?(?:\s+DE)?\s+\d{4})`;

/** Identifica o banco: primeiro no cabeçalho (início do texto), depois por frequência. */
export function detectBank(lines: string[]): { code: string; name: string } | undefined {
  const norm = lines.map(normalizeForMatch);
  // "Banco: 341" / "Banco 341 -" explícito
  for (const l of norm.slice(0, 40)) {
    const m = /\bBANCO\s*:?\s*0?(\d{3})\b/.exec(l);
    const b = m && bankByCode(m[1]);
    if (b) return { code: b.code, name: b.name };
  }
  const head = norm.slice(0, 25).join('\n');
  for (const b of BANKS) {
    if (b.patterns.some((p) => p.test(head))) return { code: b.code, name: b.name };
  }
  const all = norm.join('\n');
  let best: { code: string; name: string; n: number } | undefined;
  for (const b of BANKS) {
    let n = 0;
    for (const p of b.patterns) n += (all.match(new RegExp(p.source, 'g')) ?? []).length;
    if (n > 0 && (!best || n > best.n)) best = { code: b.code, name: b.name, n };
  }
  return best && { code: best.code, name: best.name };
}

export function detectMetadata(lines: string[]): DetectedMetadata {
  const text = lines.map(normalizeForMatch).join('\n');
  const account: AccountInfo = {};

  const bank = detectBank(lines);
  if (bank) {
    account.bankId = bank.code;
    account.bankName = bank.name;
  }

  // Agência e conta juntas: "Agência/Conta: 1234 / 56789-0", "AG 1234 CC 56789-0"
  const combined =
    /AG(?:ENCIA)?\.?\s*\/\s*CONTA(?:\s+CORRENTE)?\s*:?\s*(\d{3,5})(?:-[\dX])?\s*[/|-]\s*(\d[\d.]{1,14}-?[\dX]?)\b/.exec(text);
  if (combined) {
    account.branchId = combined[1];
    account.accountId = combined[2].replace(/\./g, '');
  }
  if (!account.branchId) {
    // "Agência: 1" (com dois-pontos aceita 1 a 5 dígitos); cooperativas (Sicoob/Sicredi) usam "COOP."
    const ag =
      /\bAG(?:ENCIA|\.)?\s*(?:N[O°º]\.?\s*)?(?::\s*(\d{1,5}(?:-[\dX])?)|\s+(\d{3,5}(?:-[\dX])?))(?!\d)/.exec(text) ??
      /\bCOOP(?:ERATIVA)?\.?\s*:?\s*(\d{3,5}(?:-[\dX])?)(?!\d)/.exec(text);
    const branch = ag?.[1] ?? ag?.[2];
    if (branch) account.branchId = branch.length < 4 && !branch.includes('-') ? branch.padStart(4, '0') : branch;
  }
  if (!account.accountId) {
    const cc =
      /\b(?:CONTA(?:\s+CORRENTE|\s+POUPANCA|\s+PAGAMENTO)?|C\/C|CC)\s*(?:N[O°º]\.?\s*)?:?\s*(\d[\d.]{1,14}-[\dX](?![\dX])|\d{4,15}(?![\d-]))/.exec(text);
    if (cc) account.accountId = cc[1].replace(/\./g, '');
  }
  if (/\bPOUPANCA\b/.test(text.slice(0, 1500)) && !/CONTA CORRENTE/.test(text.slice(0, 1500))) {
    account.accountType = 'SAVINGS';
  }

  // Período
  let startDate: string | undefined;
  let endDate: string | undefined;
  const periodRes = [
    new RegExp(String.raw`PERIODO(?:\s+DE)?\s*:?\s*(?:DE\s+)?${DATE_PAT}\s*(?:AL|A|ATE|-|E)\s*${DATE_PAT}`),
    new RegExp(String.raw`(?:MOVIMENTACAO|EXTRATO|LANCAMENTOS)\s+(?:DE|DO DIA)\s+${DATE_PAT}\s*(?:A|ATE)\s*${DATE_PAT}`),
    new RegExp(String.raw`\b${DATE_PAT}\s+(?:A|ATE)\s+${DATE_PAT}`),
  ];
  for (const re of periodRes) {
    const m = re.exec(text);
    if (!m) continue;
    const a = parseBRDate(m[1]);
    const b = parseBRDate(m[2]);
    if (a && b && a <= b) {
      startDate = a;
      endDate = b;
      break;
    }
  }

  const years = new Map<number, number>();
  for (const m of text.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-](\d{4})\b/g)) {
    const y = +m[1];
    if (y > 1990 && y < 2200) years.set(y, (years.get(y) ?? 0) + 1);
  }
  let dominantYear: number | undefined;
  let max = 0;
  for (const [y, n] of years) if (n > max) [dominantYear, max] = [y, n];

  return { account, startDate, endDate, dominantYear };
}
