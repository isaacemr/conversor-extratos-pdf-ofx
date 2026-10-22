/**
 * Registro de parsers por banco. Para adicionar um banco, crie um arquivo em
 * `parsers/banks/` e registre-o na lista abaixo (veja o README).
 */
import { genericParser } from './generic';
import { detectBank } from './metadata';
import { splitStatements } from './split';
import { bbParser } from './banks/bb';
import { itauParser } from './banks/itau';
import { nubankParser } from './banks/nubank';
import type { BankParser, ParseInput, ParseResult } from './types';

const parsers: BankParser[] = [bbParser, nubankParser, itauParser, genericParser];

export function registerParser(p: BankParser): void {
  const i = parsers.findIndex((x) => x.id === p.id);
  if (i >= 0) parsers[i] = p;
  else parsers.unshift(p);
}

export function getParsers(): readonly BankParser[] {
  return parsers;
}

/** Escolhe o parser de maior pontuação (ou o indicado) e processa o documento. */
export function parseStatement(input: ParseInput, parserId?: string): ParseResult {
  if (parserId) {
    const chosen = parsers.find((p) => p.id === parserId);
    if (chosen) return chosen.parse(input);
  }
  const code = detectBank(input.lines.map((l) => l.text))?.code;
  let best = genericParser;
  let bestScore = -1;
  for (const p of parsers) {
    const s = p.detect(input, code);
    if (s > bestScore) [best, bestScore] = [p, s];
  }
  const result = best.parse(input);
  // Se o parser específico não achou nada, tenta o genérico.
  if (result.statement.transactions.length === 0 && best !== genericParser) {
    const fallback = genericParser.parse(input);
    if (fallback.statement.transactions.length > 0) return fallback;
  }
  return result;
}

/**
 * Processa um documento que pode conter vários extratos (contas diferentes num mesmo PDF).
 * Retorna um resultado por extrato encontrado.
 */
export function parseDocument(input: ParseInput, parserId?: string): ParseResult[] {
  const segments = splitStatements(input.lines);
  const results = segments.map((lines) => parseStatement({ ...input, lines }, parserId));
  const withTx = results.filter((r) => r.statement.transactions.length > 0);
  return withTx.length ? withTx : results.slice(0, 1);
}
