import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Statement } from '../types';
import { OfxParseError, parseOfx } from './parse';
import { computeFitIds, encodeOfx, sanitizeText, writeOfx } from './write';

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../fixtures', name)));
const NOW = new Date(2024, 1, 1, 10, 30, 0);

describe('parseOfx — OFX 1.x SGML (Windows-1252)', () => {
  const doc = parseOfx(fixture('exemplo-ofx1-sgml.ofx'));
  const st = doc.statements[0];

  it('lê cabeçalho e encoding', () => {
    expect(doc.version).toBe(1);
    expect(doc.header.CHARSET).toBe('1252');
    expect(doc.encoding).toBe('windows-1252');
    expect(doc.org).toBe('Banco Ficticio');
  });

  it('lê conta e período', () => {
    expect(st.account).toMatchObject({ bankId: '341', branchId: '1234', accountId: '56789-0', accountType: 'CHECKING' });
    expect(st.account.bankName).toBe('Itaú Unibanco');
    expect(st.startDate).toBe('2024-01-01');
    expect(st.endDate).toBe('2024-01-31');
    expect(st.currency).toBe('BRL');
  });

  it('lê transações com acentos corretos', () => {
    expect(st.transactions).toHaveLength(8);
    const [t0, t1, t2, t3, t4] = st.transactions;
    expect(t0).toMatchObject({ date: '2024-01-02', amount: 500000, description: 'TED RECEBIDA EMPRESA FICTÍCIA LTDA' });
    expect(t1).toMatchObject({ amount: -125075, checkNum: '000123', description: 'PAGTO BOLETO CONDOMÍNIO EDIFÍCIO SÃO JOSÉ' });
    expect(t2.description).toBe('COMPRA CARTÃO DÉBITO PADARIA PÃO & CIA');
    expect(t3).toMatchObject({ trnType: 'PAYMENT', description: 'PIX ENVIADO - JOÃO DA SILVA' });
    expect(t4.amount).toBe(123456); // TRNAMT com vírgula
  });

  it('lê saldos', () => {
    expect(st.closingBalance).toBe(400218);
    expect(st.closingBalanceDate).toBe('2024-01-31');
    expect(st.availableBalance).toBe(400218);
  });
});

describe('parseOfx — OFX 2.x XML (UTF-8)', () => {
  const doc = parseOfx(fixture('exemplo-ofx2-xml.ofx'));
  const st = doc.statements[0];

  it('lê versão, conta e transações', () => {
    expect(doc.version).toBe(2);
    expect(doc.header.VERSION).toBe('220');
    expect(doc.encoding).toBe('utf-8');
    expect(st.account).toMatchObject({ bankId: '260', branchId: '0001', accountId: '9876543-2' });
    expect(st.transactions).toHaveLength(6);
    expect(st.transactions[2]).toMatchObject({
      description: 'Pagamento de boleto - Energia Elétrica & Gás',
      checkNum: '778899',
      amount: -98000,
    });
    expect(st.startDate).toBe('2024-02-01');
    expect(st.endDate).toBe('2024-02-29');
    expect(st.closingBalance).toBe(540244);
  });
});

describe('parseOfx — robustez', () => {
  it('aceita SGML com fechamentos de folha, minúsculas e MEMO vazio', () => {
    const text = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
      <CURDEF>BRL<BANKACCTFROM><BANKID>1</BANKID><ACCTID>123<ACCTTYPE>SAVINGS</BANKACCTFROM>
      <BANKTRANLIST><stmttrn><trntype>DEBIT<dtposted>20240301<trnamt>-10.5<fitid>X1<memo>
      </stmttrn><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20240302<TRNAMT>20<FITID>X2<MEMO>Ok &amp; tal</STMTTRN>
      </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const st = parseOfx(text).statements[0];
    expect(st.account).toMatchObject({ bankId: '001', accountId: '123', accountType: 'SAVINGS' });
    expect(st.transactions.map((t) => [t.amount, t.description])).toEqual([
      [-1050, ''],
      [2000, 'Ok & tal'],
    ]);
  });

  it('lê cartão de crédito (CCSTMTRS)', () => {
    const text = `<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>BRL<CCACCTFROM><ACCTID>4111</CCACCTFROM>
      <BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240301<TRNAMT>-99.99<FITID>1<MEMO>Loja</STMTTRN></BANKTRANLIST>
      </CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    const st = parseOfx(text).statements[0];
    expect(st.account.accountType).toBe('CREDITCARD');
    expect(st.transactions[0].amount).toBe(-9999);
  });

  it('rejeita arquivos que não são OFX', () => {
    expect(() => parseOfx('olá mundo')).toThrow(OfxParseError);
    expect(() => parseOfx('<OFX></OFX>')).toThrow(/STMTRS/);
  });
});

describe('writeOfx', () => {
  const st: Statement = {
    account: { bankId: '237', branchId: '0123', accountId: '45678-9', accountType: 'CHECKING' },
    currency: 'BRL',
    startDate: '2024-03-01',
    endDate: '2024-03-31',
    openingBalance: 100000,
    transactions: [
      { id: 'a', date: '2024-03-02', description: 'PIX RECEBIDO <JOSÉ> & FILHOS\nLTDA', amount: 25050 },
      { id: 'b', date: '2024-03-05', description: 'TARIFA', amount: -1990, checkNum: '0042' },
      { id: 'c', date: '2024-03-05', description: 'TARIFA', amount: -1990 },
    ],
  };

  it('gera OFX 1.02 SGML no formato especificado', () => {
    const out = writeOfx(st, { now: NOW });
    expect(out.startsWith('OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\nSECURITY:NONE\r\nENCODING:USASCII\r\nCHARSET:1252\r\nCOMPRESSION:NONE\r\nOLDFILEUID:NONE\r\nNEWFILEUID:NONE\r\n\r\n<OFX>')).toBe(true);
    expect(out).toContain('<LANGUAGE>POR');
    expect(out).toContain('<BANKID>237\r\n');
    expect(out).toContain('<DTPOSTED>20240302\r\n');
    expect(out).toContain('<TRNAMT>-19.90\r\n');
    expect(out).toContain('<CHECKNUM>0042\r\n');
    expect(out).toContain('<MEMO>PIX RECEBIDO JOSÉ E FILHOS LTDA\r\n');
    expect(out).toContain('<BALAMT>1210.70'); // 1000,00 + 250,50 - 19,90 - 19,90
    expect(out).not.toContain('</MEMO>');
  });

  it('gera OFX 2.2 XML bem formado', () => {
    const out = writeOfx(st, { version: '220', now: NOW });
    expect(out).toMatch(/^<\?xml version="1.0" encoding="UTF-8"/);
    expect(out).toContain('<?OFX OFXHEADER="200" VERSION="220"');
    expect(out).toContain('<MEMO>PIX RECEBIDO JOSÉ &amp; FILHOS LTDA</MEMO>');
    // Toda tag aberta é fechada.
    const opens = [...out.matchAll(/<([A-Z0-9.]+)>/g)].length;
    const closes = [...out.matchAll(/<\/([A-Z0-9.]+)>/g)].length;
    expect(opens).toBe(closes);
  });

  it('FITIDs são únicos, determinísticos e estáveis a edições de outros lançamentos', () => {
    const ids = computeFitIds(st);
    expect(new Set(ids).size).toBe(3);
    expect(computeFitIds(st)).toEqual(ids);
    const edited: Statement = { ...st, transactions: [st.transactions[1], st.transactions[2]] };
    expect(computeFitIds(edited)).toEqual([ids[1], ids[2]]);
    expect(ids[0]).toMatch(/^20240302[0-9A-F]{14}$/);
  });

  it('sanitiza texto', () => {
    expect(sanitizeText('a<b>c & d', { xml: false })).toBe('a b c E d');
    expect(sanitizeText('Ação', { xml: false, stripAccents: true })).toBe('Acao');
    expect(sanitizeText('x'.repeat(400), { xml: true })).toHaveLength(255);
  });

  it('codifica 1.02 em Windows-1252', () => {
    const bytes = encodeOfx(writeOfx(st, { now: NOW }), '102');
    expect(Array.from(bytes)).toContain(0xc9); // É
  });
});

describe('ida e volta', () => {
  for (const name of ['exemplo-ofx1-sgml.ofx', 'exemplo-ofx2-xml.ofx']) {
    for (const version of ['102', '220'] as const) {
      it(`${name} → objeto → OFX ${version} → objeto`, () => {
        const original = parseOfx(fixture(name)).statements[0];
        const bytes = encodeOfx(writeOfx(original, { version, now: NOW }), version);
        const again = parseOfx(bytes).statements[0];
        expect(again.account).toEqual(original.account);
        expect(again.startDate).toBe(original.startDate);
        expect(again.endDate).toBe(original.endDate);
        expect(again.closingBalance).toBe(original.closingBalance);
        expect(again.availableBalance).toBe(original.availableBalance);
        // Em SGML o "&" vira "E" (sanitização intencional); no XML ele é preservado.
        const strip = (s: Statement) =>
          s.transactions.map(({ id: _id, ...rest }) => ({
            ...rest,
            description: sanitizeText(rest.description, { xml: false }),
          }));
        expect(strip(again)).toEqual(strip(original));
        if (version === '220') {
          expect(again.transactions.map((t) => t.description)).toEqual(original.transactions.map((t) => t.description));
        }
        // E escrever de novo produz exatamente o mesmo arquivo.
        expect(writeOfx(again, { version, now: NOW })).toBe(writeOfx(original, { version, now: NOW }));
      });
    }
  }
});
