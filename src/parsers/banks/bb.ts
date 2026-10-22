/**
 * Banco do Brasil — ajustes sobre o parser genérico, validados com extratos reais
 * (dois layouts: "Extrato de Conta Corrente" do app/site e "Consultas - Extrato de conta
 * corrente" do internet banking empresarial).
 *
 * - O extrato do app não traz o nome do banco no texto; ele é reconhecido pelo layout:
 *   colunas "Dia | Lote | Documento | Histórico | Valor", sinais "(+)" / "(-)" e a linha
 *   final "S A L D O" com letras espaçadas.
 * - O layout empresarial põe o código do histórico antes da descrição ("732 Cielo Vendas");
 *   o código é removido.
 * - Cada lançamento ocupa 2–3 linhas deslocadas poucos pontos (data, descrição, detalhes),
 *   o que a reconstrução de linhas do genérico já resolve.
 */
import type { ParseInput } from '../types';
import { createGenericParser } from '../generic';
import { normalizeForMatch } from '../../utils/br-format';

function looksLikeBB(input: ParseInput): boolean {
  let header = false;
  let spacedSaldo = false;
  let signs = 0;
  for (const l of input.lines) {
    const n = normalizeForMatch(l.text);
    if (/\bLOTE\b/.test(n) && /\bHISTORICO\b/.test(n) && /\bDOCUMENTO\b/.test(n)) header = true;
    if (/\bS A L D O\b/.test(n)) spacedSaldo = true;
    if (/\d,\d{2} \([+-]\)$/.test(n)) signs++;
    if (header && (spacedSaldo || signs > 3)) return true;
  }
  return false;
}

export const bbParser = createGenericParser(
  {
    id: 'bb',
    name: 'Banco do Brasil',
    bankCode: '001',
    cleanDescription: (d) => d.replace(/^\d{3}\s+(?=\D)/, ''),
  },
  (input, code) => (code === '001' || looksLikeBB(input) ? 0.85 : 0),
);
