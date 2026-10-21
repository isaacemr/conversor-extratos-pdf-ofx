/**
 * Itaú — exemplo de parser específico baseado no genérico.
 *
 * O extrato de conta corrente traz linhas "SALDO DO DIA" e "SDO CTA/APL AUTOMATICAS"
 * (saldo incluindo aplicações automáticas), que não são o saldo contábil. O genérico já
 * trata a maioria; aqui marcamos o saldo com aplicações como linha a ignorar.
 *
 * Observação: ajustes feitos a partir do layout público; valide com seus extratos.
 */
import { createGenericParser } from '../generic';

export const itauParser = createGenericParser({
  id: 'itau',
  name: 'Itaú',
  bankCode: '341',
  ignore: [/^SDO CTA\/APL/, /^SALDO APLIC/, /^SALDO TOTAL DISPONIVEL/],
});
