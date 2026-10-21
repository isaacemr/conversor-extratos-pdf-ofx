import { describe, expect, it } from 'vitest';
import { linesFromText, row } from '../test-utils/text-lines';
import { detectHeader, guessSignByKeywords, parseGeneric, resolveSigns } from './generic';
import { detectMetadata } from './metadata';
import { parseStatement } from './registry';
import type { Transaction } from '../types';

const cfg = { id: 'generic', name: 'Genérico' };
const simplify = (txs: Transaction[]) => txs.map((t) => [t.date, t.description, t.amount, t.checkNum ?? '']);

describe('extrato com cabeçalho, coluna Valor com sinal, documento e saldo', () => {
  const W = [12, 36, 10, 14, 16];
  const A: Array<'l' | 'r'> = ['l', 'l', 'l', 'r', 'r'];
  const r = (...c: string[]) => row(c, W, A);
  const header = r('Data', 'Histórico', 'Docto.', 'Valor (R$)', 'Saldo (R$)');
  const text = [
    'BANCO BRADESCO S.A.',
    'Extrato de Conta Corrente',
    'Agência: 1234-5     Conta: 0012345-6',
    'Período: 01/03/2024 a 31/03/2024',
    '',
    header,
    r('29/02/2024', 'SALDO ANTERIOR', '', '', '1.000,00'),
    r('01/03/2024', 'PIX RECEBIDO', '123456', '500,00', '1.500,00'),
    r('', 'FULANO DE TAL', '', '', ''),
    r('05/03/2024', 'PAGTO ELETRON COBRANCA', '000789', '-250,50', '1.249,50'),
    r('', 'CONDOMINIO', '', '', ''),
    r('05/03/2024', 'TARIFA BANCARIA', '', '-12,90', '1.236,60'),
    'Página 1 de 2',
    '\f' + header,
    r('10/03/2024', 'TED RECEBIDA', '', '2.000,00', '3.236,60'),
    r('15/03/2024', 'COMPRA CARTAO DEB MERCADO', '', '-100,00', '3.136,60'),
    r('', 'SALDO FINAL', '', '', '3.136,60'),
    r('', 'Total de lançamentos', '', '2.137,00', ''),
  ].join('\n');
  const res = parseGeneric({ lines: linesFromText(text) }, cfg);
  const st = res.statement;

  it('encontra o cabeçalho e as transações', () => {
    expect(res.stats.headerFound).toBe(true);
    expect(simplify(st.transactions)).toEqual([
      ['2024-03-01', 'PIX RECEBIDO FULANO DE TAL', 50000, '123456'],
      ['2024-03-05', 'PAGTO ELETRON COBRANCA CONDOMINIO', -25050, '000789'],
      ['2024-03-05', 'TARIFA BANCARIA', -1290, ''],
      ['2024-03-10', 'TED RECEBIDA', 200000, ''],
      ['2024-03-15', 'COMPRA CARTAO DEB MERCADO', -10000, ''],
    ]);
    expect(st.transactions.every((t) => !t.uncertain)).toBe(true);
    expect(st.transactions[0].balance).toBe(150000);
  });

  it('lê metadados e saldos', () => {
    expect(st.account).toMatchObject({ bankId: '237', branchId: '1234-5', accountId: '0012345-6' });
    expect(st.startDate).toBe('2024-03-01');
    expect(st.endDate).toBe('2024-03-31');
    expect(st.openingBalance).toBe(100000);
    expect(st.closingBalance).toBe(313660);
    expect(res.stats.continuationLines).toBe(2);
  });
});

describe('colunas separadas de crédito e débito, data só no primeiro lançamento do dia', () => {
  const W = [11, 30, 14, 14, 14];
  const A: Array<'l' | 'r'> = ['l', 'l', 'r', 'r', 'r'];
  const r = (...c: string[]) => row(c, W, A);
  const text = [
    'Extrato - Período: 01/01/2024 a 31/01/2024',
    r('Data', 'Lançamento', 'Crédito', 'Débito', 'Saldo'),
    r('02/01', 'SALDO ANTERIOR', '', '', '500,00'),
    r('03/01', 'PIX RECEBIDO JOSE', '1.000,00', '', ''),
    r('', 'PAGAMENTO BOLETO', '', '200,00', '1.300,00'),
    r('04/01', 'TARIFA', '', '10,00', '1.290,00'),
    r('31/01', 'SALDO DO DIA', '', '', '1.290,00'),
  ].join('\n');
  const res = parseGeneric({ lines: linesFromText(text) }, cfg);

  it('classifica pelo cabeçalho e repete a data', () => {
    expect(simplify(res.statement.transactions)).toEqual([
      ['2024-01-03', 'PIX RECEBIDO JOSE', 100000, ''],
      ['2024-01-03', 'PAGAMENTO BOLETO', -20000, ''],
      ['2024-01-04', 'TARIFA', -1000, ''],
    ]);
    expect(res.statement.transactions.some((t) => t.uncertain)).toBe(false);
    expect(res.statement.openingBalance).toBe(50000);
    expect(res.statement.closingBalance).toBe(129000);
  });
});

describe('estilo Nubank: datas "05 JAN 2024", seções de entradas/saídas, sem cabeçalho', () => {
  const text = [
    'NU PAGAMENTOS S.A. - INSTITUIÇÃO DE PAGAMENTO',
    'Extrato de 01 de janeiro de 2024 a 31 de janeiro de 2024',
    'Agência 0001   Conta 1234567-8',
    '05 JAN 2024   Total de entradas                 + 1.500,00',
    '              Transferência recebida pelo Pix     1.500,00',
    '              CLIENTE A',
    '06 JAN 2024   Total de saídas                     - 230,00',
    '              Compra no débito                       30,00',
    '              Transferência enviada pelo Pix        200,00',
    '              Saldo do dia                        1.270,00',
  ].join('\n');
  const input = { lines: linesFromText(text) };
  const res = parseStatement(input);

  it('escolhe o parser do Nubank e usa as seções para o sinal', () => {
    expect(res.parserId).toBe('nubank');
    expect(simplify(res.statement.transactions)).toEqual([
      ['2024-01-05', 'Transferência recebida pelo Pix CLIENTE A', 150000, ''],
      ['2024-01-06', 'Compra no débito', -3000, ''],
      ['2024-01-06', 'Transferência enviada pelo Pix', -20000, ''],
    ]);
    expect(res.statement.account).toMatchObject({ bankId: '260', branchId: '0001', accountId: '1234567-8' });
    expect(res.statement.startDate).toBe('2024-01-01');
    expect(res.statement.closingBalance).toBe(127000);
  });
});

describe('sem cabeçalho, indicadores D/C e cadeia de saldos', () => {
  const text = [
    'SICREDI - Extrato de conta corrente',
    '01/02/2024  SALDO ANTERIOR                          1.000,00 C',
    '02/02/2024  DEPOSITO                 300,00 C       1.300,00 C',
    '03/02/2024  PAGAMENTO                 50,00 D       1.250,00 C',
    '04/02/2024  OPERACAO XYZ              20,00         1.230,00',
    '05/02/2024  OUTRA OPERACAO            70,00         1.300,00',
    'LANÇAMENTOS FUTUROS',
    '10/02/2024  AGENDAMENTO              99,00 D',
  ].join('\n');
  const res = parseGeneric({ lines: linesFromText(text) }, cfg);

  it('lê sinais explícitos e corrige os incertos pelo saldo', () => {
    expect(simplify(res.statement.transactions)).toEqual([
      ['2024-02-02', 'DEPOSITO', 30000, ''],
      ['2024-02-03', 'PAGAMENTO', -5000, ''],
      ['2024-02-04', 'OPERACAO XYZ', -2000, ''],
      ['2024-02-05', 'OUTRA OPERACAO', 7000, ''],
    ]);
    expect(res.statement.transactions.some((t) => t.uncertain)).toBe(false);
    expect(res.stats.signsResolvedByBalance).toBe(2);
    expect(res.statement.account.bankId).toBe('748');
    expect(res.statement.openingBalance).toBe(100000);
    expect(res.statement.closingBalance).toBe(130000);
  });

  it('ignora a seção de lançamentos futuros', () => {
    expect(res.statement.transactions.find((t) => t.description.includes('AGENDAMENTO'))).toBeUndefined();
  });
});

describe('sinal incerto sem saldo para conferir', () => {
  const text = ['10/04/2024  PIX ENVIADO MARIA        150,00', '11/04/2024  CREDITO SALARIO        3.000,00'].join('\n');
  const res = parseGeneric({ lines: linesFromText(text) }, cfg);
  it('usa palavras-chave e marca como incerto', () => {
    expect(res.statement.transactions.map((t) => [t.amount, t.uncertain])).toEqual([
      [-15000, true],
      [300000, true],
    ]);
    expect(res.warnings.join(' ')).toMatch(/2 lançamento/);
  });
});

describe('detectHeader', () => {
  it('reconhece títulos comuns', () => {
    const [l] = linesFromText('Data      Data Valor   Histórico            Nº Doc       Débito     Crédito      Saldo');
    const cols = detectHeader(l)!;
    expect(cols.map((c) => c.role)).toEqual(['date', 'date', 'description', 'doc', 'debit', 'credit', 'balance']);
  });
  it('não confunde lançamento com cabeçalho', () => {
    const [l] = linesFromText('05/01/2024  SALDO DO DIA   1.000,00');
    expect(detectHeader(l)).toBeNull();
  });
});

describe('heurísticas auxiliares', () => {
  it('guessSignByKeywords', () => {
    expect(guessSignByKeywords('PIX RECEBIDO JOAO')).toBe(1);
    expect(guessSignByKeywords('PAGAMENTO BOLETO')).toBe(-1);
    expect(guessSignByKeywords('ESTORNO TARIFA')).toBe(1);
    expect(guessSignByKeywords('XPTO')).toBe(0);
  });
  it('resolveSigns encontra a única combinação válida', () => {
    const g = [
      { id: 'a', date: '2024-01-01', description: '', amount: 1000, uncertain: true },
      { id: 'b', date: '2024-01-01', description: '', amount: 300, uncertain: true },
    ];
    expect(resolveSigns(g, -1300)).toBe(2);
    expect(g.map((t) => t.amount)).toEqual([-1000, -300]);
  });
  it('detectMetadata reconhece agência/conta combinadas', () => {
    const m = detectMetadata(['ITAÚ UNIBANCO S.A.', 'Agência/Conta: 1500 / 01234-5', 'período de 01/05/2024 até 31/05/2024']);
    expect(m.account).toMatchObject({ bankId: '341', branchId: '1500', accountId: '01234-5' });
    expect([m.startDate, m.endDate]).toEqual(['2024-05-01', '2024-05-31']);
  });
});
