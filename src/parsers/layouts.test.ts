/**
 * Layouts de bancos reais, reproduzidos com DADOS FICTÍCIOS: a geometria (colunas,
 * deslocamentos verticais, centralização, sinais) foi copiada de extratos reais analisados
 * localmente; nomes, contas e valores são inventados.
 */
import { describe, expect, it } from 'vitest';
import { pageToLines } from '../pdf/extract';
import { positioned, row } from '../test-utils/text-lines';
import type { Statement } from '../types';
import { parseDocument, parseStatement } from './registry';

const key = (st: Statement) => st.transactions.map((t) => [t.date, t.description, t.amount, t.checkNum ?? '']);
const closes = (st: Statement) => st.openingBalance! + st.transactions.reduce((a, t) => a + t.amount, 0) === st.closingBalance;

describe('Banco do Brasil (app): data, descrição e valor em linhas deslocadas, sinais (+)/(-)', () => {
  const W = [12, 8, 18, 36, 14, 4];
  const A: Array<'l' | 'r'> = ['l', 'l', 'l', 'l', 'r', 'l'];
  const r = (...c: string[]) => row(c, W, A);
  const lines = positioned([
    [
      [40, 'Extrato de Conta Corrente'],
      [60, 'Agência: 1234-5   Conta: 99999-9'],
      [100, r('Dia', 'Lote', 'Documento', 'Histórico', 'Valor', '')],
      [112, r('29/05/2026')],
      [117, r('', '', '', 'Saldo Anterior', '4.546,98', '(+)')],
      [132, r('01/06/2026')],
      [137, r('', '14024', '900000000001', 'Stone Pagamento Débito', '563,93', '(+)')],
      [152, r('', '', '', 'Pix - Recebido')],
      [157, r('01/06/2026')],
      [163, r('', '14397', '10000000000001', '01/06 14:09 00000000000 FULANO', '58,00', '(+)')],
      [183, r('01/06/2026', '', '', 'Pagamento de Boleto')],
      [188, r('', '13105', '60103', '', '350,53', '(-)')],
      [193, r('', '', '', 'EMPRESA FICTICIA LTDA')],
      [213, r('01/06/2026')],
      [218, r('', '14024', '00/00/0000', 'Saldo do dia', '4.818,38', '(+)')],
      [238, r('02/06/2026')],
      [243, r('', '14024', '900000000002', 'Stone Pagamento Antecipac', '1.000,00', '(+)')],
      [263, r('30/06/2026')],
      [268, r('', '', '', 'S A L D O', '5.818,38', '(+)')],
    ],
  ]);
  const res = parseStatement({ lines });

  it('reconhece o BB pelo layout e remonta as linhas', () => {
    expect(res.parserId).toBe('bb');
    expect(res.statement.account).toMatchObject({ bankId: '001', branchId: '1234-5', accountId: '99999-9' });
    expect(key(res.statement)).toEqual([
      ['2026-06-01', 'Stone Pagamento Débito', 56393, '900000000001'],
      ['2026-06-01', 'Pix - Recebido 01/06 14:09 00000000000 FULANO', 5800, '10000000000001'],
      ['2026-06-01', 'Pagamento de Boleto EMPRESA FICTICIA LTDA', -35053, '60103'],
      ['2026-06-02', 'Stone Pagamento Antecipac', 100000, '900000000002'],
    ]);
    expect(res.statement.openingBalance).toBe(454698);
    expect(res.statement.closingBalance).toBe(581838);
    expect(closes(res.statement)).toBe(true);
  });
});

describe('Sicoob: sufixo C/D, valor quebrado acima/abaixo da data, DOC.: e quadro RESUMO', () => {
  const r = (...c: string[]) => row(c, [8, 58, 12], ['l', 'l', 'r']);
  const lines = positioned([
    [
      [20, 'SICOOB - SISTEMA DE COOPERATIVAS DE CRÉDITO DO BRASIL'],
      [40, 'COOP.: 1111-1 / SICOOB FICTICIO'],
      [52, 'CONTA: 123.456-7 / EMPRESA FICTICIA LTDA'],
      [64, 'PERÍODO: 01/06/2026 - 30/06/2026'],
      [90, r('DATA', 'HISTÓRICO', 'VALOR')],
      [102, r('29/05', 'SALDO ANTERIOR', '617,00C')],
      [114, r('01/06', 'DÉB.TIT.COMPE.EFETI', '617,00D')],
      [126, r('', 'DOC.: 10000001', '')],
      [138, r('01/06', 'SALDO DO DIA', '0,00C')],
      [150, r('', '', '8.000,00')],
      [155, r('19/06', 'PIX REC.OUTRA IF MT', '')],
      [160, r('', '', 'C')],
      [172, r('', 'Recebimento Pix', '')],
      [184, r('', 'DOC.: Pix', '')],
      [196, r('19/06', 'SALDO DO DIA', '8.000,00C')],
      [208, r('30/06', 'DEB PACOTE SERVIÇOS', '92,50D')],
      [220, r('', 'DOC.: 129', '')],
      [232, r('30/06', 'SALDO DO DIA', '7.907,50')],
      [242, r('', '', 'C')],
      [264, '                              RESUMO'],
      [276, r('', '(+) SALDO EM CONTA:', '7.907,50C')],
      [288, r('', '(+) CHEQUE ESPECIAL CONTRATADO:', '0,00C')],
    ],
  ]);
  const res = parseStatement({ lines });

  it('junta valor e indicador, extrai o documento e para no resumo', () => {
    expect(key(res.statement)).toEqual([
      ['2026-06-01', 'DÉB.TIT.COMPE.EFETI', -61700, '10000001'],
      ['2026-06-19', 'PIX REC.OUTRA IF MT Recebimento Pix', 800000, ''],
      ['2026-06-30', 'DEB PACOTE SERVIÇOS', -9250, '129'],
    ]);
    expect(res.statement.account).toMatchObject({ bankId: '756', branchId: '1111-1', accountId: '123456-7' });
    expect(res.statement.openingBalance).toBe(61700);
    expect(res.statement.closingBalance).toBe(790750);
    expect(closes(res.statement)).toBe(true);
  });
});

describe('Mercado Pago: descrição centralizada acima/abaixo, saldo por linha, resumo no topo', () => {
  const r = (...c: string[]) => row(c, [12, 30, 16, 14, 14], ['l', 'l', 'l', 'r', 'r']);
  const lines = positioned(
    [
      [
        [20, 'EXTRATO DE CONTA'],
        [30, 'CPF/CNPJ: 00000000000100 Agência: 1 Conta: 1234567890'],
        [40, 'Periodo: De 01-06-2026 al 30-06-2026'],
        [60, 'Entradas: R$ 100,00          Saldo final: R$ 140,00'],
        [67, 'Saldo inicial: R$ 100,00'],
        [74, 'Saidas: R$ -60,00'],
        [100, r('Data', 'Descrição', 'ID da operação', 'Valor', 'Saldo')],
        [125, r('', 'Pix recebido CLIENTE')],
        [137, r('01-06-2026', 'EXEMPLO LTDA', '100000000001', 'R$ 100,00', 'R$ 200,00')],
        [149, r('', 'ME')],
        [175, r('', 'Débito por dívida/dinheiro')],
        [182, r('01-06-2026', '', '100000000002', 'R$ -60,00', 'R$ 140,00')],
        [187, r('', 'retido')],
        [300, 'Mercado Pago Instituição de Pagamento Ltda.'],
      ],
    ],
    8,
  );
  const res = parseStatement({ lines });

  it('reconstrói as descrições e não trata o resumo como seção de saídas', () => {
    expect(key(res.statement)).toEqual([
      ['2026-06-01', 'Pix recebido CLIENTE EXEMPLO LTDA ME', 10000, '100000000001'],
      ['2026-06-01', 'Débito por dívida/dinheiro retido', -6000, '100000000002'],
    ]);
    expect(res.statement.account).toMatchObject({ bankId: '323', branchId: '0001', accountId: '1234567890' });
    expect([res.statement.startDate, res.statement.endDate]).toEqual(['2026-06-01', '2026-06-30']);
    expect(res.statement.openingBalance).toBe(10000);
    expect(res.statement.closingBalance).toBe(14000);
    expect(res.statement.transactions.every((t) => !t.uncertain)).toBe(true);
  });
});

describe('Stone: ordem decrescente, coluna TIPO, conta em linha de rótulos', () => {
  const r = (...c: string[]) => row(c, [10, 9, 30, 14, 14], ['l', 'l', 'l', 'r', 'r']);
  const lines = positioned([
    [
      [20, 'Extrato de conta corrente'],
      [40, row(['Instituição', 'Agência', 'Conta'], [40, 10, 10], ['l', 'l', 'l'])],
      [55, row(['Stone Instituição de Pagamento S.A.', '0001', '4321-0'], [40, 10, 10], ['l', 'l', 'l'])],
      [70, 'Período: de 01/08/2026 a 31/08/2026'],
      [90, r('DATA', 'TIPO', 'DESCRIÇÃO', 'VALOR', 'SALDO')],
      [108, r('', '', 'MARIA EXEMPLO')],
      [120, r('31/08/26', 'Entrada', '', 'R$ 29,00', 'R$ 1.229,00')],
      [132, r('', '', 'Pix | Maquininha')],
      [157, r('', '', 'FORNECEDOR FICTICIO')],
      [169, r('30/08/26', 'Saída', '', '- R$ 300,00', 'R$ 1.200,00')],
      [181, r('', '', 'Transferência | Pix')],
      [206, r('', '', 'JOAO EXEMPLO')],
      [218, r('01/08/26', 'Entrada', '', 'R$ 500,00', 'R$ 1.500,00')],
      [230, r('', '', 'Pix | Maquininha')],
    ],
  ]);
  const res = parseStatement({ lines });

  it('coloca em ordem cronológica e fecha o saldo', () => {
    expect(key(res.statement)).toEqual([
      ['2026-08-01', 'JOAO EXEMPLO Pix | Maquininha', 50000, ''],
      ['2026-08-30', 'FORNECEDOR FICTICIO Transferência | Pix', -30000, ''],
      ['2026-08-31', 'MARIA EXEMPLO Pix | Maquininha', 2900, ''],
    ]);
    expect(res.statement.account).toMatchObject({ bankId: '197', branchId: '0001', accountId: '4321-0' });
    expect(res.statement.openingBalance).toBe(100000);
    expect(res.statement.closingBalance).toBe(122900);
    expect(res.statement.transactions.every((t) => !t.uncertain)).toBe(true);
  });
});

describe('Inter: "saldo do dia" antes dos lançamentos, saldo por transação, "-R$"', () => {
  const r = (...c: string[]) => row(c, [60, 16, 18], ['l', 'r', 'r']);
  const interPage: Array<[number, string]> = [
    [20, 'Instituição: Banco Inter, Agência: 0001-9, Conta: 1234567-8'],
    [30, 'Período: 01/05/2026 a 31/05/2026'],
    [60, '1 de Maio de 2026   Saldo do dia: R$ 1.300,00              Valor         Saldo por transação'],
    [80, r('Pix recebido: "Cp :00000000-CLIENTE UM"', 'R$ 500,00', 'R$ 1.500,00')],
    [100, r('Pix enviado: "Cp :00000000-FORNECEDOR"', '-R$ 200,00', 'R$ 1.300,00')],
    [130, '2 de Maio de 2026   Saldo do dia: R$ 1.350,00'],
    [150, r('Pix recebido: "Cp :00000000-CLIENTE DOIS"', 'R$ 50,00', 'R$ 1.350,00')],
  ];

  it('usa o saldo de cada linha e ignora o saldo do dia no topo', () => {
    const res = parseStatement({ lines: positioned([interPage]) });
    expect(key(res.statement)).toEqual([
      ['2026-05-01', 'Pix recebido: "Cp :00000000-CLIENTE UM"', 50000, ''],
      ['2026-05-01', 'Pix enviado: "Cp :00000000-FORNECEDOR"', -20000, ''],
      ['2026-05-02', 'Pix recebido: "Cp :00000000-CLIENTE DOIS"', 5000, ''],
    ]);
    expect(res.statement.account).toMatchObject({ bankId: '077', branchId: '0001-9', accountId: '1234567-8' });
    expect(res.statement.openingBalance).toBe(100000);
    expect(res.statement.closingBalance).toBe(135000);
    expect(res.statement.transactions.every((t) => !t.uncertain)).toBe(true);
  });

  it('separa extratos de contas diferentes no mesmo PDF', () => {
    const sicoobPage: Array<[number, string]> = [
      [20, 'SICOOB - SISTEMA DE COOPERATIVAS DE CRÉDITO DO BRASIL'],
      [40, 'COOP.: 2222-2 / SICOOB FICTICIO'],
      [52, 'CONTA: 98.765-4 / EMPRESA FICTICIA LTDA'],
      [64, 'PERÍODO: 01/05/2026 - 31/05/2026'],
      [90, row(['DATA', 'HISTÓRICO', 'VALOR'], [8, 58, 12], ['l', 'l', 'r'])],
      [102, row(['30/04', 'SALDO ANTERIOR', '100,00C'], [8, 58, 12], ['l', 'l', 'r'])],
      [114, row(['04/05', 'PIX EMIT.OUTRA IF', '40,00D'], [8, 58, 12], ['l', 'l', 'r'])],
      [126, row(['04/05', 'SALDO DO DIA', '60,00C'], [8, 58, 12], ['l', 'l', 'r'])],
    ];
    const results = parseDocument({ lines: positioned([interPage, sicoobPage]) });
    expect(results.map((r) => [r.statement.account.bankId, r.statement.account.accountId, r.statement.transactions.length])).toEqual([
      ['077', '1234567-8', 3],
      ['756', '98765-4', 1],
    ]);
    expect(results.every((r) => closes(r.statement))).toBe(true);
  });
});

describe('PagBank: "-R$" nos débitos, crédito sem sinal, descrição centralizada', () => {
  const r = (...c: string[]) => row(c, [16, 70, 16], ['l', 'l', 'r']);
  const lines = positioned(
    [
      [
        [20, '290 - PagSeguro Internet S/A'],
        [28, 'Agência 0001   Conta 12345678-9'],
        [40, 'Periodo: 01/06/2026 a 30/06/2026'],
        [60, r('Data', 'Descrição', 'Valor')],
        [80, r('01/06/2026', 'Pix enviado - Fornecedor Exemplo', '-R$ 200,00')],
        [100, r('01/06/2026', 'Pix recebido - Cliente Exemplo', 'R$ 2.000,00')],
        [120, r('01/06/2026', 'Saldo do dia', 'R$ 1.825,47')],
        [137, r('', 'Mensalidade Seguro Conta - Para: PAGSEGURO INTERNET', '')],
        [142, r('23/06/2026', '', '-R$ 4,90')],
        [146, r('', 'PAGAMENTO', '')],
        [163, r('23/06/2026', 'Saldo do dia', 'R$ 1.820,57')],
      ],
    ],
    8,
  );
  const res = parseStatement({ lines });

  it('deduz o saldo inicial e trata valor sem sinal como crédito', () => {
    expect(key(res.statement)).toEqual([
      ['2026-06-01', 'Pix enviado - Fornecedor Exemplo', -20000, ''],
      ['2026-06-01', 'Pix recebido - Cliente Exemplo', 200000, ''],
      ['2026-06-23', 'Mensalidade Seguro Conta - Para: PAGSEGURO INTERNET PAGAMENTO', -490, ''],
    ]);
    expect(res.statement.account).toMatchObject({ bankId: '290', accountId: '12345678-9' });
    expect(res.statement.openingBalance).toBe(2547);
    expect(res.statement.closingBalance).toBe(182057);
    expect(res.statement.transactions.every((t) => !t.uncertain)).toBe(true);
  });
});

describe('Santander (internet banking): dia da semana no cabeçalho do dia, coluna DEBITO/CREDITO sem título', () => {
  const r = (...c: string[]) => row(c, [72, 18, 16], ['l', 'l', 'r']);
  const lines = positioned([
    [
      [20, 'Internet Banking Empresarial'],
      [40, 'EMPRESA FICTICIA LTDA                                        Agência: 1234 Conta: 123456789'],
      [60, '   Quarta, 30 de setembro de 2026'],
      [75, r('APLICACAO CONTAMAX', 'DEBITO', 'R$ 1.000,00')],
      [90, r('PIX RECEBIDO', 'CREDITO', 'R$ 1.000,00')],
      [110, '   Terça, 29 de setembro de 2026'],
      [125, r('PAGAMENTO CARTAO DE DEBITO', 'CREDITO', 'R$ 39,46')],
      [140, r('TARIFA PIX RECEBIDO QR CHECKOUT', 'DEBITO', 'R$ 2,49')],
      [200, 'Central de Atendimento Santander Empresarial'],
    ],
  ]);
  const res = parseStatement({ lines });

  it('lê a data com dia da semana e o sinal pela coluna de tipo', () => {
    expect(key(res.statement)).toEqual([
      ['2026-09-29', 'TARIFA PIX RECEBIDO QR CHECKOUT', -249, ''],
      ['2026-09-29', 'PAGAMENTO CARTAO DE DEBITO', 3946, ''],
      ['2026-09-30', 'PIX RECEBIDO', 100000, ''],
      ['2026-09-30', 'APLICACAO CONTAMAX', -100000, ''],
    ]);
    expect(res.statement.account).toMatchObject({ bankId: '033', branchId: '1234', accountId: '123456789' });
    expect(res.statement.transactions.every((t) => !t.uncertain)).toBe(true);
  });
});

describe('Itaú (extrato mensal PJ): legenda à esquerda, saldo da conta × saldo com aplicações', () => {
  const r = (...c: string[]) => row(c, [26, 10, 30, 14, 14, 14], ['l', 'l', 'l', 'r', 'r', 'r']);
  const lines = positioned([
    [
      [20, 'extrato mensal   ag 1234 cc 56789-0 set 2026'],
      [60, r('A = agendamento', 'data', 'descrição', 'entradas R$', 'saídas R$', 'saldo R$')],
      [72, r('B = ações movimentadas', '31/08', 'Saldo anterior', '', '', '19.000,00')],
      [84, r('D = débito a compensar', '01/09', 'FATURA EMPRESARIAL', '', '11.000,00-', '')],
      [94, r('', '', 'Res Aplic Aut Mais', '10.999,80', '', '')],
      [104, r('', '', 'Rend Pago Aplic Aut Mais', '0,20', '', '1,00')],
      [114, r('', '', 'SALDO APLIC AUT MAIS', '', '', '7.999,20')],
      [138, r('', '03/09', 'PIX TRANSF CLIENTE', '500,00', '', '')],
      [148, r('', '', 'Apl Aplic Aut Mais', '', '500,00-', '1,00')],
      [158, r('', '', 'SALDO APLIC AUT MAIS', '', '', '8.499,20')],
      [182, r('', '', 'Saldo em C/C', '', '', '1,00')],
      [192, r('', '', 'Saldo final', '', '', '8.500,20')],
      [215, '                                    totalizador de aplicações automáticas   entrada R$   saída R$'],
      [225, r('', '', 'na conta corrente (1)', '10.999,80', '500,00-', '')],
      [300, 'Itaú Unibanco S.A.'],
    ],
  ]);
  const res = parseStatement({ lines });

  it('usa o saldo da conta corrente e ignora legenda, saldos com aplicação e totalizador', () => {
    expect(res.parserId).toBe('itau');
    expect(key(res.statement)).toEqual([
      ['2026-09-01', 'FATURA EMPRESARIAL', -1100000, ''],
      ['2026-09-01', 'Res Aplic Aut Mais', 1099980, ''],
      ['2026-09-01', 'Rend Pago Aplic Aut Mais', 20, ''],
      ['2026-09-03', 'PIX TRANSF CLIENTE', 50000, ''],
      ['2026-09-03', 'Apl Aplic Aut Mais', -50000, ''],
    ]);
    expect(res.statement.account).toMatchObject({ bankId: '341', branchId: '1234', accountId: '56789-0' });
    expect(res.statement.openingBalance).toBe(100);
    expect(res.statement.closingBalance).toBe(100);
  });
});

describe('Cora: ordem decrescente com saldo do dia no topo e resumo no início', () => {
  const r = (...c: string[]) => row(c, [80, 20], ['l', 'r']);
  const lines = positioned([
    [
      [20, 'EMPRESA FICTICIA LTDA'],
      [35, 'Agência: 0001 - Conta: 1234567-8'],
      [55, 'Extrato do período                                   01/08/2026 a 01/09/2026'],
      [75, r('Saldo inicial disponível', 'R$ 1.000,00')],
      [90, r('Total de entradas', '+ R$ 500,00')],
      [105, r('Total de saídas', '- R$ 1.250,00')],
      [120, r('Saldo final disponível', 'R$ 250,00')],
      [140, 'Transações'],
      [160, r('28/08/2026                                   Saldo do dia', 'R$ 250,00')],
      [175, r('    Transf Pix enviada FORNECEDOR', '- R$ 750,00')],
      [195, r('20/08/2026                                   Saldo do dia', 'R$ 1.000,00')],
      [210, r('    Transf Pix enviada FORNECEDOR', '- R$ 500,00')],
      [225, r('    Transf Pix recebida CLIENTE', '+ R$ 500,00')],
      [300, 'Cora SCFI - CNPJ 00.000.000/0001-00'],
    ],
  ]);
  const res = parseStatement({ lines });

  it('inverte a ordem mantendo saldo inicial e final nas pontas', () => {
    expect(key(res.statement)).toEqual([
      ['2026-08-20', 'Transf Pix recebida CLIENTE', 50000, ''],
      ['2026-08-20', 'Transf Pix enviada FORNECEDOR', -50000, ''],
      ['2026-08-28', 'Transf Pix enviada FORNECEDOR', -75000, ''],
    ]);
    expect(res.statement.account).toMatchObject({ bankId: '403', branchId: '0001', accountId: '1234567-8' });
    expect(res.statement.openingBalance).toBe(100000);
    expect(res.statement.closingBalance).toBe(25000);
    expect(closes(res.statement)).toBe(true);
  });
});

describe('Nubank (conta PJ): resumo no topo, totais por dia, contraparte de outro banco', () => {
  const r = (...c: string[]) => row(c, [12, 76, 14], ['l', 'l', 'r']);
  const top = (y: number): Array<[number, string]> => [
    [y, '                                                                  EMPRESA FICTICIA LTDA'],
    [y + 13, '                                                            CNPJ 00.000.000/0001-00     Agência 0001 Conta'],
    [y + 25, '                                                                                                1234567-8'],
    [y + 76, '           01 DE JANEIRO DE 2026 a 31 DE JANEIRO DE 2026                                VALORES EM R$'],
  ];
  const lines = positioned([
    [
      ...top(67),
      [172, '                                                                Saldo inicial                   100,00'],
      [187, '           Saldo final do período'],
      [192, '                                                                Total de entradas             +500,00'],
      [210, '           R$ 400,00                                            Total de saídas               -200,00'],
      [232, '                                                                Saldo final do período          400,00'],
      [261, '           Movimentações'],
      [283, r('05 JAN 2026', 'Total de saídas', '- 200,00')],
      [304, r('', 'Transferência enviada pelo Pix FORNECEDOR FICTICIO LTDA -', '200,00')],
      [324, r('', '00.000.000/0001-00 - BCO SANTANDER (BRASIL) S.', '')],
      [344, r('', 'A. (0033) Agência: 1111 Conta: 2222-3', '')],
      [378, r('', 'Saldo do dia', '-100,00')],
      [410, r('06 JAN 2026', 'Total de entradas', '+ 500,00')],
      [788, '                    Extrato gerado dia 05 de fevereiro de 2026 às 12:54                 1 de 2'],
    ],
    [
      ...top(61),
      [168, r('', 'Depósito recebido CLIENTE FICTICIO -', '500,00')],
      [202, r('', 'Saldo do dia', '400,00')],
      [722, '           Tem alguma dúvida? Mande uma mensagem pelo chat do app. nubank.com.br/contatos'],
    ],
  ]);
  const res = parseStatement({ lines });

  it('reconhece o Nubank pelo layout e fecha o saldo', () => {
    expect(res.parserId).toBe('nubank');
    expect(key(res.statement)).toEqual([
      ['2026-01-05', 'Transferência enviada pelo Pix FORNECEDOR FICTICIO LTDA 00.000.000/0001-00 - BCO SANTANDER (BRASIL) S. A. (0033) Agência: 1111 Conta: 2222-3', -20000, ''],
      ['2026-01-06', 'Depósito recebido CLIENTE FICTICIO', 50000, ''],
    ]);
    expect(res.statement.account).toMatchObject({ bankId: '260', branchId: '0001', accountId: '1234567-8' });
    expect([res.statement.startDate, res.statement.endDate]).toEqual(['2026-01-01', '2026-01-31']);
    expect(res.statement.openingBalance).toBe(10000);
    expect(res.statement.closingBalance).toBe(40000);
    expect(closes(res.statement)).toBe(true);
  });
});

describe('extração: caracteres sem mapeamento Unicode', () => {
  it('vira hífen entre dígitos e some quando solto', () => {
    const [line] = pageToLines({
      page: 1,
      width: 600,
      height: 800,
      items: [
        { str: 'Conta', x: 400, y: 100, w: 25, h: 9 },
        { str: '4321', x: 457, y: 100, w: 26, h: 9 },
        { str: '\uE088', x: 483, y: 100, w: 5, h: 9 },
        { str: '0', x: 488, y: 100, w: 6.7, h: 9 },
        { str: '\uE092', x: 540, y: 100, w: 5, h: 9 },
      ],
    });
    expect(line.text).toBe('Conta 4321-0');
  });
});
