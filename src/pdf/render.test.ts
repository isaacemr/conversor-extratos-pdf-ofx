import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeCsv } from '../csv/write';
import { parseOfx } from '../ofx/parse';
import { pdfLinesNode } from '../test-utils/pdf-node';
import { computeLedger } from '../utils/ledger';
import { pdfSafe, renderStatementPdf } from './render';

const st = parseOfx(new Uint8Array(readFileSync(resolve(__dirname, '../../fixtures/exemplo-ofx1-sgml.ofx')))).statements[0];
const NOW = new Date(2024, 1, 1, 10, 30);

describe('computeLedger', () => {
  it('deriva o saldo anterior do saldo final e calcula o saldo corrente', () => {
    const l = computeLedger(st, { sort: true });
    expect(l.openingSource).toBe('derived');
    expect(l.opening).toBe(150000);
    expect(l.totalCredits).toBe(500000 + 123456 + 327);
    expect(l.totalDebits).toBe(-(125075 + 8990 + 35000 + 4500 + 200000));
    expect(l.rows[l.rows.length - 1].running).toBe(400218);
    expect(l.computedClosing).toBe(400218);
  });

  it('aponta diferença quando saldos informados não fecham', () => {
    const l = computeLedger({ ...st, openingBalance: 100000 });
    expect(l.difference).toBe(50000);
  });
});

describe('renderStatementPdf', () => {
  it('gera um PDF A4 legível com acentos, totais e saldo corrente', async () => {
    const bytes = renderStatementPdf(st, { now: NOW });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const text = (await pdfLinesNode(bytes)).map((l) => l.text).join('\n');
    expect(text).toContain('Extrato de Conta Corrente');
    expect(text).toContain('Gerado em 01/02/2024 10:30');
    expect(text).toContain('341 - Itaú Unibanco');
    expect(text).toMatch(/Período: ?01\/01\/2024 a 31\/01\/2024/);
    expect(text).toContain('PAGTO BOLETO CONDOMÍNIO EDIFÍCIO SÃO JOSÉ');
    expect(text).toMatch(/03\/01\/2024 PAGTO BOLETO .* 000123 -1\.250,75 5\.249,25/);
    expect(text).toMatch(/Total de créditos 6\.237,83/);
    expect(text).toMatch(/Total de débitos -3\.735,65/);
    expect(text).toMatch(/Saldo final 4\.002,18/);
    expect(text).toContain('Página 1 de 1');
  });

  it('pagina extratos longos', async () => {
    const many = {
      ...st,
      transactions: Array.from({ length: 120 }, (_, i) => ({ ...st.transactions[i % 8], id: `x${i}` })),
    };
    const text = (await pdfLinesNode(renderStatementPdf(many, { now: NOW }))).map((l) => l.text).join('\n');
    expect(text).toMatch(/Página 1 de [3-9]/);
  });

  it('troca caracteres fora do WinAnsi', () => {
    expect(pdfSafe('“Olá” – teste… ✓')).toBe('"Olá" - teste... ?');
  });
});

describe('writeCsv', () => {
  it('gera CSV com ; e vírgula decimal, com BOM', () => {
    const csv = writeCsv(st);
    expect(csv.startsWith('﻿Data;Histórico;Documento;Tipo;Valor;Saldo;FITID\r\n')).toBe(true);
    expect(csv).toContain('03/01/2024;PAGTO BOLETO CONDOMÍNIO EDIFÍCIO SÃO JOSÉ;000123;Débito;-1.250,75;5.249,25;20240103001');
  });
});
