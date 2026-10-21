import { describe, expect, it } from 'vitest';
import {
  centsToDecimal,
  decimalToCents,
  formatBRDate,
  formatBRL,
  inferYear,
  ofxDateToISO,
  parseBRAmount,
  parseBRAmountDetailed,
  parseBRDate,
  parseUserAmount,
} from './br-format';
import { decodeText, encodeWindows1252 } from './encoding';

describe('parseBRAmount', () => {
  it.each([
    ['1.234,56', 123456],
    ['0,01', 1],
    ['1234,56', 123456],
    ['1.234.567,89', 123456789],
    ['-1.234,56', -123456],
    ['1.234,56-', -123456],
    ['1.234,56 D', -123456],
    ['1.234,56D', -123456],
    ['1.234,56 C', 123456],
    ['1.234,56 DB', -123456],
    ['(1.234,56)', -123456],
    ['R$ 1.234,56', 123456],
    ['- R$ 1.234,56', -123456],
    ['R$ -1.234,56', -123456],
    ['+ 10,00', 1000],
    ['−50,00', -5000], // sinal de menos Unicode
    ['1 234,56', null],
  ])('%s → %s', (input, expected) => {
    expect(parseBRAmount(input)).toBe(expected);
  });

  it.each(['abc', '', '12/01', '1.234', '1,2', '12.34', '1.23,45', '123456'])('rejeita "%s"', (input) => {
    expect(parseBRAmount(input)).toBeNull();
  });

  it('informa se o sinal era explícito', () => {
    expect(parseBRAmountDetailed('10,00')).toEqual({ cents: 1000, sign: 0 });
    expect(parseBRAmountDetailed('10,00 C')).toEqual({ cents: 1000, sign: 1 });
    expect(parseBRAmountDetailed('10,00-')).toEqual({ cents: 1000, sign: -1 });
  });
});

describe('parseUserAmount', () => {
  it.each([
    ['1234', 123400],
    ['1234,5', 123450],
    ['1.234,56', 123456],
    ['-50', -5000],
    ['R$ 10', 1000],
    ['1234.56', 123456],
    ['(10,00)', -1000],
    ['x', null],
  ])('%s → %s', (input, expected) => {
    expect(parseUserAmount(input)).toBe(expected);
  });
});

describe('formatBRL', () => {
  it('formata com milhar e vírgula', () => {
    expect(formatBRL(123456)).toBe('1.234,56');
    expect(formatBRL(-123456789)).toBe('-1.234.567,89');
    expect(formatBRL(5)).toBe('0,05');
    expect(formatBRL(0)).toBe('0,00');
    expect(formatBRL(100000, { symbol: true })).toBe('R$ 1.000,00');
    expect(formatBRL(100, { plus: true })).toBe('+1,00');
  });
});

describe('decimal OFX', () => {
  it('centavos → decimal com ponto', () => {
    expect(centsToDecimal(-123456)).toBe('-1234.56');
    expect(centsToDecimal(5)).toBe('0.05');
    expect(centsToDecimal(-5)).toBe('-0.05');
  });
  it.each([
    ['-1234.56', -123456],
    ['1234,56', 123456],
    ['+100', 10000],
    ['1,234.56', 123456],
    ['1.234,56', 123456],
    ['.5', 50],
    ['10.005', 1001],
    ['-0.10', -10],
    ['abc', null],
  ])('%s → %s', (input, expected) => {
    expect(decimalToCents(input)).toBe(expected);
  });
});

describe('parseBRDate', () => {
  it.each([
    ['05/01/2024', '2024-01-05'],
    ['5/1/2024', '2024-01-05'],
    ['05-01-2024', '2024-01-05'],
    ['05.01.2024', '2024-01-05'],
    ['05/01/24', '2024-01-05'],
    ['05 JAN 2024', '2024-01-05'],
    ['05/jan/2024', '2024-01-05'],
    ['05 de março de 2024', '2024-03-05'],
    ['31 DEZ 2023', '2023-12-31'],
    ['2024-02-29', '2024-02-29'],
  ])('%s → %s', (input, expected) => {
    expect(parseBRDate(input)).toBe(expected);
  });

  it('usa o ano do contexto para dd/mm e "05 JAN"', () => {
    expect(parseBRDate('05/01', { year: 2023 })).toBe('2023-01-05');
    expect(parseBRDate('05 FEV', { year: 2023 })).toBe('2023-02-05');
    expect(parseBRDate('05 fev.', { year: 2023 })).toBe('2023-02-05');
  });

  it('infere o ano pelo período em extratos que viram o ano', () => {
    const ctx = { start: '2023-12-15', end: '2024-01-14' };
    expect(parseBRDate('20/12', ctx)).toBe('2023-12-20');
    expect(parseBRDate('05/01', ctx)).toBe('2024-01-05');
    expect(inferYear(2, 29, { start: '2023-12-01', end: '2024-03-01' })).toBe(2024);
  });

  it.each(['31/02/2024', '32/01/2024', '00/01/2024', '05/13/2024', 'JAN', '05 XYZ', '1.234,56'])('rejeita "%s"', (input) => {
    expect(parseBRDate(input, { year: 2024 })).toBeNull();
  });

  it('formata e converte datas', () => {
    expect(formatBRDate('2024-01-05')).toBe('05/01/2024');
    expect(ofxDateToISO('20240105120000[-3:BRT]')).toBe('2024-01-05');
    expect(ofxDateToISO('20240105120000.000[-03:EST]')).toBe('2024-01-05');
    expect(ofxDateToISO('2024')).toBeNull();
  });
});

describe('encoding', () => {
  it('decodifica UTF-8 e Windows-1252', () => {
    const utf8 = new TextEncoder().encode('Ação Café');
    expect(decodeText(utf8)).toEqual({ text: 'Ação Café', encoding: 'utf-8' });
    const cp1252 = encodeWindows1252('Ação Café € “aspas”');
    expect(decodeText(cp1252)).toEqual({ text: 'Ação Café € “aspas”', encoding: 'windows-1252' });
  });
  it('remove BOM UTF-8', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('ok')]);
    expect(decodeText(bytes).text).toBe('ok');
  });
  it('troca caracteres sem equivalente em 1252', () => {
    expect(Array.from(encodeWindows1252('ğ✓'))).toEqual([0x67, 0x3f]);
  });
});
