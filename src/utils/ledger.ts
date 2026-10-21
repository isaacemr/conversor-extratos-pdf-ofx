/**
 * Cálculos de saldo: saldo corrente, totais e conferência
 * (saldo inicial + movimentações = saldo final).
 */
import type { Statement, Transaction } from '../types';

export interface LedgerRow {
  tx: Transaction;
  /** Saldo corrente calculado após o lançamento. */
  running: number;
}

export interface Ledger {
  rows: LedgerRow[];
  opening: number;
  /** "informed" = vindo do arquivo/usuário; "derived" = saldo final − movimentações; "none" = assumido 0. */
  openingSource: 'informed' | 'derived' | 'none';
  /** Saldo final calculado (abertura + movimentações). */
  computedClosing: number;
  totalCredits: number;
  totalDebits: number;
  net: number;
  /** Saldo final informado − calculado (undefined se não há saldo final informado). */
  difference?: number;
}

/** Ordena por data mantendo a ordem original entre lançamentos do mesmo dia. */
export function sortByDate<T extends { date: string }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.date < b.item.date ? -1 : a.item.date > b.item.date ? 1 : a.i - b.i))
    .map((x) => x.item);
}

export function computeLedger(st: Statement, opts: { sort?: boolean } = {}): Ledger {
  const txs = opts.sort ? sortByDate(st.transactions) : st.transactions;
  let totalCredits = 0;
  let totalDebits = 0;
  for (const t of txs) {
    if (t.amount >= 0) totalCredits += t.amount;
    else totalDebits += t.amount;
  }
  const net = totalCredits + totalDebits;

  let opening: number;
  let openingSource: Ledger['openingSource'];
  if (st.openingBalance !== undefined) {
    opening = st.openingBalance;
    openingSource = 'informed';
  } else if (st.closingBalance !== undefined) {
    opening = st.closingBalance - net;
    openingSource = 'derived';
  } else {
    opening = 0;
    openingSource = 'none';
  }

  let running = opening;
  const rows = txs.map((tx) => {
    running += tx.amount;
    return { tx, running };
  });
  const computedClosing = opening + net;
  const difference =
    st.closingBalance !== undefined && openingSource === 'informed' ? st.closingBalance - computedClosing : undefined;

  return { rows, opening, openingSource, computedClosing, totalCredits, totalDebits, net, difference };
}
