/**
 * Bancos brasileiros conhecidos: código COMPE (3 dígitos), nome e padrões para
 * identificação automática no texto do extrato.
 */
export interface BankInfo {
  code: string;
  name: string;
  /** Padrões buscados no texto do PDF (sem acentos, maiúsculas). */
  patterns: RegExp[];
}

export const BANKS: BankInfo[] = [
  { code: '001', name: 'Banco do Brasil', patterns: [/BANCO DO BRASIL/, /\bBB\.COM\.BR\b/, /\bOUVIDORIA BB\b/, /\bBB RENDE FACIL\b/] },
  { code: '033', name: 'Santander', patterns: [/SANTANDER/] },
  { code: '104', name: 'Caixa Econômica Federal', patterns: [/CAIXA ECONOMICA/, /\bCAIXA\.GOV\.BR\b/] },
  { code: '237', name: 'Bradesco', patterns: [/BRADESCO/] },
  { code: '341', name: 'Itaú Unibanco', patterns: [/ITAU UNIBANCO/, /\bBANCO ITAU\b/, /\bITAU\b/] },
  { code: '260', name: 'Nu Pagamentos (Nubank)', patterns: [/NU PAGAMENTOS/, /NUBANK/] },
  { code: '077', name: 'Banco Inter', patterns: [/BANCO INTER\b/, /\bINTER S\.?A\b/, /BANCOINTER/] },
  { code: '756', name: 'Sicoob', patterns: [/SICOOB/, /BANCOOB/] },
  { code: '748', name: 'Sicredi', patterns: [/SICREDI/] },
  { code: '336', name: 'C6 Bank', patterns: [/\bC6 ?BANK\b/, /BANCO C6/] },
  { code: '208', name: 'BTG Pactual', patterns: [/BTG PACTUAL/] },
  { code: '041', name: 'Banrisul', patterns: [/BANRISUL/, /BANCO DO ESTADO DO RIO GRANDE DO SUL/] },
  { code: '422', name: 'Banco Safra', patterns: [/BANCO SAFRA/, /\bSAFRA\b/] },
  { code: '070', name: 'BRB - Banco de Brasília', patterns: [/\bBRB\b/, /BANCO DE BRASILIA/] },
  { code: '004', name: 'Banco do Nordeste', patterns: [/BANCO DO NORDESTE/] },
  { code: '021', name: 'Banestes', patterns: [/BANESTES/] },
  { code: '212', name: 'Banco Original', patterns: [/BANCO ORIGINAL/] },
  { code: '290', name: 'PagBank (PagSeguro)', patterns: [/PAGSEGURO/, /PAGBANK/] },
  { code: '323', name: 'Mercado Pago', patterns: [/MERCADO PAGO/] },
  { code: '380', name: 'PicPay', patterns: [/PICPAY/] },
  { code: '403', name: 'Cora', patterns: [/\bCORA (SCD|SCFI)\b/, /\bCORA\b.*\bSOCIEDADE DE CREDITO/] },
  { code: '197', name: 'Stone', patterns: [/STONE (PAGAMENTOS|INSTITUICAO)/] },
  { code: '655', name: 'Banco Votorantim (BV)', patterns: [/BANCO VOTORANTIM/, /\bBANCO BV\b/] },
  { code: '637', name: 'Banco Sofisa', patterns: [/SOFISA/] },
  { code: '623', name: 'Banco Pan', patterns: [/BANCO PAN\b/] },
  { code: '085', name: 'Ailos', patterns: [/\bAILOS\b/] },
  { code: '136', name: 'Unicred', patterns: [/UNICRED/] },
];

export function bankByCode(code: string | undefined): BankInfo | undefined {
  if (!code) return undefined;
  const c = code.replace(/\D/g, '').padStart(3, '0').slice(-3);
  return BANKS.find((b) => b.code === c);
}

export function bankName(code: string | undefined, fallback = ''): string {
  return bankByCode(code)?.name ?? fallback;
}
