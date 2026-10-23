/**
 * Nubank — ajustes sobre o parser genérico, validados com um extrato real de conta PJ.
 *
 * Layout: quadro de resumo no topo (Saldo inicial, Total de entradas/saídas, Saldo final
 * do período); depois, para cada dia, "05 JAN 2026  Total de saídas  - 78,75", os
 * lançamentos (sem data e sem sinal: o sinal vem da seção de entradas/saídas) e
 * "Saldo do dia". As linhas abaixo de cada lançamento trazem dados da contraparte.
 *
 * - O nome do banco quase não aparece no texto (só "nubank.com.br" no rodapé), e as
 *   contrapartes citam outros bancos ("BCO SANTANDER (BRASIL)"); por isso o banco é
 *   reconhecido pelo layout.
 * - O "Total de saídas" do resumo fica na mesma altura do quadro "Saldo final do período"
 *   e as duas coisas se juntam numa linha; ela é ignorada.
 */
import type { ParseInput } from '../types';
import { createGenericParser } from '../generic';
import { normalizeForMatch } from '../../utils/br-format';

function looksLikeNubank(input: ParseInput): boolean {
  let site = false;
  let dayTotals = 0;
  let dayBalances = 0;
  for (const l of input.lines) {
    const n = normalizeForMatch(l.text);
    if (/NUBANK\.COM\.BR|NU PAGAMENTOS S\.?A|NU FINANCEIRA/.test(n)) site = true;
    if (/^\d{2} [A-Z]{3} \d{4} TOTAL DE (ENTRADAS|SAIDAS)\b/.test(n)) dayTotals++;
    if (/^SALDO DO DIA\b/.test(n)) dayBalances++;
  }
  return (site && dayTotals > 0) || (dayTotals >= 2 && dayBalances >= 2);
}

export const nubankParser = createGenericParser(
  {
    id: 'nubank',
    name: 'Nubank',
    bankCode: '260',
    sections: [
      { pattern: /^TOTAL DE ENTRADAS\b/, sign: 1 },
      { pattern: /^TOTAL DE SAIDAS\b/, sign: -1 },
    ],
    ignore: [
      /^(MOVIMENTACOES|RENDIMENTO LIQUIDO TOTAL|TEM ALGUMA DUVIDA|OUVIDORIA|EXTRATO GERADO)/,
      /\bTOTAL DE (ENTRADAS|SAIDAS)\b/,
    ],
  },
  (input, code) => (code === '260' || looksLikeNubank(input) ? 0.9 : 0),
);
