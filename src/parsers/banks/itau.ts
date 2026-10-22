/**
 * Itaú — ajustes sobre o parser genérico, validados com um extrato mensal PJ real
 * ("extrato mensal ag ... cc ...", colunas "data | descrição | entradas | saídas | saldo").
 *
 * Contas com aplicação automática (Aplic Aut Mais) mantêm um saldo fixo na conta corrente
 * (ex.: R$ 1,00) e mostram dois saldos diferentes:
 * - "Saldo anterior" e "Saldo final" = conta corrente + aplicações → não são o saldo da conta;
 * - "SALDO APLIC AUT MAIS" = saldo da aplicação → informativo;
 * - coluna saldo e "Saldo em C/C" = saldo da conta corrente → é este que vai para o OFX.
 * Os resgates/aplicações automáticos ("Res Aplic Aut Mais", "Apl Aplic Aut Mais") são
 * movimentos reais da conta corrente e entram como lançamentos.
 * A página "Conta Corrente | Aplicações Automáticas" (movimentação do CDB) e as notas
 * explicativas não são importadas.
 */
import { createGenericParser } from '../generic';

export const itauParser = createGenericParser({
  id: 'itau',
  name: 'Itaú',
  bankCode: '341',
  ignore: [/^SDO CTA\/APL/, /^SALDO APLIC/, /^SALDO TOTAL DISPONIVEL/, /^SALDO ANTERIOR\b/, /^SALDO FINAL\b/],
  closingBalance: [/^SALDO EM C\/C\b/],
  stop: [/^CONTA CORRENTE \| APLICACOES AUTOMATICAS/, /^APLIC AUT MAIS\b/, /^TOTALIZADOR DE APLICACOES/],
});
