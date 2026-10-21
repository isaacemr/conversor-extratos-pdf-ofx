/**
 * Exportação CSV no padrão do Excel brasileiro: separador ";", vírgula decimal, UTF-8 com BOM.
 */
import type { Statement } from '../types';
import { formatBRDate, formatBRL } from '../utils/br-format';
import { computeLedger } from '../utils/ledger';

function cell(v: string): string {
  return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function writeCsv(st: Statement): string {
  const ledger = computeLedger(st, { sort: true });
  const lines = [['Data', 'Histórico', 'Documento', 'Tipo', 'Valor', 'Saldo', 'FITID']];
  for (const { tx, running } of ledger.rows) {
    lines.push([
      formatBRDate(tx.date),
      tx.description,
      tx.checkNum ?? '',
      tx.amount < 0 ? 'Débito' : 'Crédito',
      formatBRL(tx.amount),
      formatBRL(running),
      tx.fitId ?? '',
    ]);
  }
  return '﻿' + lines.map((l) => l.map(cell).join(';')).join('\r\n') + '\r\n';
}
