/**
 * Contrato dos parsers de extrato (plugins). Cada banco pode ter um parser específico;
 * o genérico atende os demais.
 */
import type { TextLine } from '../pdf/extract';
import type { Statement } from '../types';

export interface ParseInput {
  /** Linhas reconstruídas do PDF (ou do OCR), em ordem de leitura. */
  lines: TextLine[];
  fileName?: string;
  /** true quando as linhas vieram de OCR (menos confiáveis). */
  ocr?: boolean;
}

export interface ParseStats {
  /** Linhas lidas no documento. */
  lines: number;
  /** Linhas reconhecidas como saldo/total (não viram lançamento). */
  balanceLines: number;
  /** Linhas anexadas à descrição do lançamento anterior. */
  continuationLines: number;
  /** Lançamentos cujo sinal foi confirmado ou corrigido pela cadeia de saldos. */
  signsResolvedByBalance: number;
  /** Se a linha de cabeçalho da tabela (Data/Histórico/Valor...) foi encontrada. */
  headerFound: boolean;
}

export interface ParseResult {
  parserId: string;
  parserName: string;
  statement: Statement;
  warnings: string[];
  stats: ParseStats;
}

export interface BankParser {
  id: string;
  name: string;
  /** Código COMPE do banco atendido (vazio no genérico). */
  bankCode?: string;
  /**
   * Confiança (0 a 1) de que este parser entende o documento.
   * O registro escolhe o de maior pontuação; o genérico responde com valor baixo.
   */
  detect(input: ParseInput, detectedBankCode?: string): number;
  parse(input: ParseInput): ParseResult;
}
