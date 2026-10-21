/**
 * Modelo de dados compartilhado por todo o app.
 *
 * Convenções:
 * - Valores monetários são SEMPRE inteiros em centavos (evita erros de ponto flutuante).
 *   Positivo = crédito, negativo = débito.
 * - Datas são strings ISO "AAAA-MM-DD" (sem fuso horário).
 */

export type AccountType = 'CHECKING' | 'SAVINGS' | 'MONEYMRKT' | 'CREDITLINE' | 'CREDITCARD';

export interface AccountInfo {
  /** Código COMPE do banco, 3 dígitos (ex.: "341"). */
  bankId?: string;
  bankName?: string;
  branchId?: string;
  accountId?: string;
  accountType?: AccountType;
}

export interface Transaction {
  /** Identificador interno (UI). Não confundir com FITID. */
  id: string;
  /** Data ISO AAAA-MM-DD. */
  date: string;
  description: string;
  /** Centavos com sinal: negativo = débito. */
  amount: number;
  /** Número do documento / cheque. */
  checkNum?: string;
  /** FITID original (quando lido de um OFX). */
  fitId?: string;
  /** TRNTYPE original do OFX (ex.: PAYMENT, XFER). Se ausente, deriva do sinal. */
  trnType?: string;
  /** Saldo informado no extrato após este lançamento (centavos), quando houver. */
  balance?: number;
  /** Marcado pelo parser quando o sinal (crédito/débito) foi deduzido por heurística fraca. */
  uncertain?: boolean;
  /** Arquivo de origem (quando vários PDFs são combinados). */
  source?: string;
}

export interface Statement {
  account: AccountInfo;
  currency: string;
  startDate?: string;
  endDate?: string;
  transactions: Transaction[];
  /** Saldo anterior ao primeiro lançamento (centavos). */
  openingBalance?: number;
  /** Saldo final / LEDGERBAL (centavos). */
  closingBalance?: number;
  closingBalanceDate?: string;
  /** AVAILBAL (centavos). */
  availableBalance?: number;
  availableBalanceDate?: string;
}

let idCounter = 0;
/** Gera um id interno único para transações na UI. */
export function newId(): string {
  idCounter += 1;
  return `t${Date.now().toString(36)}${idCounter.toString(36)}`;
}
