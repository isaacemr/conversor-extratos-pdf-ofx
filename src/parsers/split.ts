/**
 * Separação de vários extratos contidos num mesmo PDF (ex.: o usuário juntou os extratos de
 * várias contas num arquivo só). Cada página tem seu "cabeçalho" (o texto antes da tabela)
 * comparado com o extrato atual: se a conta ou o banco mudam, começa um novo extrato.
 */
import type { TextLine } from '../pdf/extract';
import { parseBRAmountDetailed } from '../utils/br-format';
import { detectHeader } from './generic';
import { detectBank, detectMetadata } from './metadata';

function lineHasAmount(l: TextLine): boolean {
  return l.words.some((w, i) => parseBRAmountDetailed(w.text) || (l.words[i + 1] && parseBRAmountDetailed(`${w.text} ${l.words[i + 1].text}`)));
}

/** Linhas de topo da página antes da tabela (ou antes do primeiro valor, se não há títulos). */
function pageHead(lines: TextLine[]): TextLine[] {
  const header = lines.findIndex((l) => detectHeader(l) !== null);
  if (header >= 0) return lines.slice(0, header);
  const firstAmount = lines.findIndex(lineHasAmount);
  return lines.slice(0, firstAmount >= 0 ? firstAmount : Math.min(lines.length, 15));
}

export function splitStatements(lines: TextLine[]): TextLine[][] {
  const pages: TextLine[][] = [];
  for (const l of lines) {
    const last = pages[pages.length - 1];
    if (last && last[0].page === l.page) last.push(l);
    else pages.push([l]);
  }

  const segments: TextLine[][] = [];
  let cur: TextLine[] = [];
  let key: { bank?: string; account?: string } = {};
  for (const page of pages) {
    const head = pageHead(page).map((l) => l.text);
    const account = head.length ? detectMetadata(head).account.accountId?.replace(/\D/g, '') : undefined;
    const bank = head.length ? detectBank(head)?.code : undefined;
    const differs =
      cur.length > 0 && ((account && key.account && account !== key.account) || (bank && key.bank && bank !== key.bank));
    if (differs) {
      segments.push(cur);
      cur = [];
      key = {};
    }
    cur.push(...page);
    key.account ??= account || undefined;
    key.bank ??= bank;
  }
  if (cur.length) segments.push(cur);
  return segments;
}
