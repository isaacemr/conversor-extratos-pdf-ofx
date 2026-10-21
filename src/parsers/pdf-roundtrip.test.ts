import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOfx } from '../ofx/parse';
import { encodeOfx, writeOfx } from '../ofx/write';
import { renderStatementPdf } from '../pdf/render';
import { pdfLinesNode } from '../test-utils/pdf-node';
import type { Statement } from '../types';
import { parseStatement } from './registry';

const fixtures = resolve(__dirname, '../../fixtures');
const load = (name: string) => parseOfx(new Uint8Array(readFileSync(resolve(fixtures, name)))).statements[0];
const key = (st: Statement) => st.transactions.map((t) => [t.date, t.description, t.amount, t.checkNum ?? '']);

describe('PDF gerado pelo app → parser genérico → mesmas transações', () => {
  it.each(['exemplo-ofx1-sgml.ofx', 'exemplo-ofx2-xml.ofx'])('%s', async (name) => {
    const original = load(name);
    const lines = await pdfLinesNode(renderStatementPdf(original));
    const res = parseStatement({ lines, fileName: 'teste.pdf' });
    const st = res.statement;

    expect(res.stats.headerFound).toBe(true);
    expect(key(st)).toEqual(key(original));
    expect(st.transactions.every((t) => !t.uncertain)).toBe(true);
    expect(st.account.bankId).toBe(original.account.bankId);
    expect(st.account.branchId).toBe(original.account.branchId);
    expect(st.account.accountId).toBe(original.account.accountId);
    expect(st.startDate).toBe(original.startDate);
    expect(st.endDate).toBe(original.endDate);
    expect(st.closingBalance).toBe(original.closingBalance);
    expect(st.openingBalance! + st.transactions.reduce((a, t) => a + t.amount, 0)).toBe(st.closingBalance);

    // E o OFX gerado a partir do PDF reabre corretamente.
    const again = parseOfx(encodeOfx(writeOfx(st))).statements[0];
    expect(again.transactions.map((t) => t.amount)).toEqual(original.transactions.map((t) => t.amount));
  });

  it('junta descrições quebradas em várias linhas', async () => {
    const original = load('exemplo-ofx2-xml.ofx');
    const long =
      'Pagamento de boleto - Associação dos Moradores do Condomínio Residencial Jardim das Flores - referência março/2024';
    const st: Statement = {
      ...original,
      transactions: [...original.transactions, { id: 'z', date: '2024-02-29', description: long, amount: -4250 }],
      closingBalance: original.closingBalance! - 4250,
    };
    const lines = await pdfLinesNode(renderStatementPdf(st));
    const res = parseStatement({ lines });
    expect(res.stats.continuationLines).toBeGreaterThan(0);
    expect(res.statement.transactions.at(-1)).toMatchObject({ description: long, amount: -4250 });
  });

  it.runIf(existsSync(resolve(fixtures, 'extrato-colunas-cd.pdf')))('fixture com colunas Crédito/Débito', async () => {
    const lines = await pdfLinesNode(new Uint8Array(readFileSync(resolve(fixtures, 'extrato-colunas-cd.pdf'))));
    const res = parseStatement({ lines });
    const st = res.statement;
    expect(key(st)).toEqual([
      ['2024-04-01', 'CRÉD. TED - CLIENTE BETA COMÉRCIO', 345000, '553311'],
      ['2024-04-01', 'DÉB. CONVÊNIO ÁGUA E ESGOTO', -18740, ''],
      ['2024-04-03', 'PIX EMITIDO OUTRA IF FAVORECIDO: JOSÉ DAS COUVES', -120000, ''],
      ['2024-04-08', 'TARIFA MANUTENÇÃO CONTA', -2990, ''],
      ['2024-04-15', 'CHEQUE COMPENSADO', -85000, '000017'],
      ['2024-04-30', 'RENDIMENTO APLICAÇÃO AUTOMÁTICA', 456, ''],
    ]);
    expect(st.account).toMatchObject({ bankId: '756', branchId: '0001', accountId: '98765-4' });
    expect(st.openingBalance).toBe(200000);
    expect(st.closingBalance).toBe(318726);
  });

  it.runIf(existsSync(resolve(fixtures, 'extrato-exemplo.pdf')))('fixture extrato-exemplo.pdf', async () => {
    const lines = await pdfLinesNode(new Uint8Array(readFileSync(resolve(fixtures, 'extrato-exemplo.pdf'))));
    const res = parseStatement({ lines });
    expect(res.statement.transactions.length).toBeGreaterThan(5);
    expect(res.statement.transactions.every((t) => !t.uncertain)).toBe(true);
  });
});
