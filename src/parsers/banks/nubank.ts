/**
 * Nubank (conta) — exemplo de parser específico baseado no genérico.
 *
 * O extrato agrupa lançamentos por dia ("05 JAN 2024  Total de entradas + 1.234,56") e
 * imprime cada lançamento sem data e, em geral, sem sinal. O sinal vem da seção
 * (entradas/saídas), que o genérico já entende; aqui reforçamos os marcadores e as
 * linhas a ignorar.
 *
 * Observação: ajustes feitos a partir do layout público; valide com seus extratos.
 */
import { createGenericParser } from '../generic';
import { normalizeForMatch } from '../../utils/br-format';

export const nubankParser = createGenericParser(
  {
    id: 'nubank',
    name: 'Nubank',
    bankCode: '260',
    sections: [
      { pattern: /^TOTAL DE ENTRADAS\b/, sign: 1 },
      { pattern: /^TOTAL DE SAIDAS\b/, sign: -1 },
    ],
    ignore: [/^(MOVIMENTACOES|RENDIMENTO LIQUIDO TOTAL|TEM ALGUMA DUVIDA|OUVIDORIA|EXTRATO GERADO)/],
  },
  (input, code) => {
    if (code === '260') return 0.9;
    const head = normalizeForMatch(input.lines.slice(0, 30).map((l) => l.text).join(' '));
    return /NU PAGAMENTOS|NUBANK/.test(head) ? 0.9 : 0;
  },
);
