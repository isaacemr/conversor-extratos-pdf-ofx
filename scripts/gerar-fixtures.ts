/**
 * Gera os PDFs de exemplo em fixtures/ (dados fictícios):
 *  - extrato-exemplo.pdf: gerado pelo próprio app (OFX → PDF) a partir de exemplo-ofx1-sgml.ofx
 *  - extrato-colunas-cd.pdf: layout "de banco" com colunas Crédito/Débito separadas, data
 *    impressa só no primeiro lançamento do dia e descrição em duas linhas.
 *
 * Uso: npm run fixtures
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { parseOfx } from '../src/ofx/parse';
import { renderStatementPdf } from '../src/pdf/render';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const NOW = new Date(2024, 1, 1, 9, 0, 0);

// 1) PDF gerado pelo app
const st = parseOfx(new Uint8Array(readFileSync(resolve(dir, 'exemplo-ofx1-sgml.ofx')))).statements[0];
writeFileSync(resolve(dir, 'extrato-exemplo.pdf'), renderStatementPdf(st, { now: NOW }));

// 2) Layout com colunas de crédito e débito
const doc = new jsPDF({ unit: 'mm', format: 'a4' });
doc.setFont('helvetica', 'bold');
doc.setFontSize(13);
doc.text('BANCO SICOOB - EXTRATO DE CONTA CORRENTE (FICTÍCIO)', 14, 16);
doc.setFont('helvetica', 'normal');
doc.setFontSize(9);
doc.text('Cooperativa: 3001   Agência: 0001   Conta: 98.765-4', 14, 23);
doc.text('Período: 01/04/2024 a 30/04/2024', 14, 28);
autoTable(doc, {
  startY: 34,
  theme: 'plain',
  styles: { fontSize: 8.5, cellPadding: 1.2 },
  headStyles: { fontStyle: 'bold' },
  head: [['Data', 'Histórico', 'Documento', 'Crédito', 'Débito', 'Saldo']],
  columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  body: [
    ['31/03', 'SALDO ANTERIOR', '', '', '', '2.000,00'],
    ['01/04', 'CRÉD. TED - CLIENTE BETA COMÉRCIO', '553311', '3.450,00', '', ''],
    ['', 'DÉB. CONVÊNIO ÁGUA E ESGOTO', '', '', '187,40', '5.262,60'],
    ['03/04', 'PIX EMITIDO OUTRA IF', '', '', '1.200,00', ''],
    ['', 'FAVORECIDO: JOSÉ DAS COUVES', '', '', '', '4.062,60'],
    ['08/04', 'TARIFA MANUTENÇÃO CONTA', '', '', '29,90', '4.032,70'],
    ['15/04', 'CHEQUE COMPENSADO', '000017', '', '850,00', '3.182,70'],
    ['30/04', 'RENDIMENTO APLICAÇÃO AUTOMÁTICA', '', '4,56', '', '3.187,26'],
    ['', 'SALDO FINAL', '', '', '', '3.187,26'],
  ],
});
writeFileSync(resolve(dir, 'extrato-colunas-cd.pdf'), new Uint8Array(doc.output('arraybuffer')));

console.log('Fixtures gerados em', dir);
