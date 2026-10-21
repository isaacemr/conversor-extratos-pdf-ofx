/**
 * Gera um extrato em PDF (A4) a partir de um Statement, com jsPDF + jspdf-autotable.
 * Funciona no navegador e no Node (usado para gerar o fixture de exemplo).
 */
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { Statement } from '../types';
import { formatBRDate, formatBRDateTime, formatBRL } from '../utils/br-format';
import { bankName } from '../utils/banks';
import { computeLedger } from '../utils/ledger';

export interface RenderPdfOptions {
  now?: Date;
  title?: string;
}

const RED: [number, number, number] = [185, 28, 28];
const GREEN: [number, number, number] = [21, 128, 61];
const DARK: [number, number, number] = [30, 41, 59];
const MUTED: [number, number, number] = [100, 116, 139];
const ACCENT: [number, number, number] = [15, 118, 110];

/**
 * As fontes padrão do PDF usam WinAnsi (Latin-1 + alguns símbolos). Troca o que não cabe
 * por equivalentes simples para não sair lixo no PDF. Acentos do português são mantidos.
 */
export function pdfSafe(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\u0000-ÿ]/g, (ch) => {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      return /^[\u0000-ÿ]+$/.test(base) ? base : '?';
    });
}

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  CHECKING: 'Conta Corrente',
  SAVINGS: 'Conta Poupança',
  MONEYMRKT: 'Aplicação',
  CREDITLINE: 'Conta Garantida',
  CREDITCARD: 'Cartão de Crédito',
};

export function renderStatementPdf(st: Statement, opts: RenderPdfOptions = {}): Uint8Array {
  const now = opts.now ?? new Date();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 14;
  const ledger = computeLedger(st, { sort: true });
  const acc = st.account;
  const bank = acc.bankName || bankName(acc.bankId);
  const typeLabel = ACCOUNT_TYPE_LABEL[acc.accountType ?? 'CHECKING'] ?? 'Conta';
  const title = opts.title ?? `Extrato de ${typeLabel}`;

  doc.setDocumentProperties({ title: pdfSafe(title), creator: 'Conversor PDF/OFX' });

  // Cabeçalho
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, pageW, 4, 'F');
  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(pdfSafe(title), M, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`Gerado em ${formatBRDateTime(now)}`, pageW - M, 16, { align: 'right' });

  const info: Array<[string, string]> = [
    ['Banco', [acc.bankId, bank].filter(Boolean).join(' - ') || 'Não informado'],
    ['Agência', acc.branchId || '-'],
    ['Conta', acc.accountId || '-'],
    ['Período', st.startDate || st.endDate ? `${formatBRDate(st.startDate)} a ${formatBRDate(st.endDate)}` : '-'],
  ];
  doc.setFontSize(9.5);
  let y = 24;
  const colW = (pageW - 2 * M) / 2;
  info.forEach(([label, value], i) => {
    const x = M + (i % 2) * colW;
    const yy = y + Math.floor(i / 2) * 6;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK);
    doc.text(`${label}:`, x, yy);
    doc.setFont('helvetica', 'normal');
    doc.text(pdfSafe(value), x + doc.getTextWidth(`${label}: `), yy);
  });
  y += 10;

  // Tabela de lançamentos
  const openingLabel = ledger.openingSource === 'derived' ? 'SALDO ANTERIOR (CALCULADO)' : 'SALDO ANTERIOR';
  const body: string[][] = [['', openingLabel, '', '', formatBRL(ledger.opening)]];
  for (const { tx, running } of ledger.rows) {
    body.push([formatBRDate(tx.date), pdfSafe(tx.description), tx.checkNum ?? '', formatBRL(tx.amount), formatBRL(running)]);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 14, bottom: 16 },
    head: [['Data', 'Histórico', 'Documento', 'Valor (R$)', 'Saldo (R$)']],
    body,
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, textColor: DARK, overflow: 'linebreak' },
    headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [244, 247, 248] },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 24 },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head' && (data.column.index === 3 || data.column.index === 4)) {
        data.cell.styles.halign = 'right';
      }
      if (data.section !== 'body') return;
      if (data.row.index === 0) data.cell.styles.fontStyle = 'bold';
      if (data.row.index > 0 && data.column.index === 3) {
        const tx = ledger.rows[data.row.index - 1].tx;
        if (tx.amount < 0) data.cell.styles.textColor = RED;
      }
      if (data.column.index === 4) {
        const v = data.row.index === 0 ? ledger.opening : ledger.rows[data.row.index - 1].running;
        if (v < 0) data.cell.styles.textColor = RED;
      }
    },
  });

  // Totais
  let ty = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8;
  const totals: Array<[string, string, [number, number, number]]> = [
    ['Total de créditos', formatBRL(ledger.totalCredits), GREEN],
    ['Total de débitos', formatBRL(ledger.totalDebits), RED],
    ['Saldo final', formatBRL(ledger.computedClosing), ledger.computedClosing < 0 ? RED : DARK],
  ];
  if (ty + totals.length * 6 + 4 > pageH - 18) {
    doc.addPage();
    ty = 20;
  }
  const boxW = 80;
  const bx = pageW - M - boxW;
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(bx, ty - 5, boxW, totals.length * 6 + 3, 1.5, 1.5, 'S');
  doc.setFontSize(9.5);
  totals.forEach(([label, value, color], i) => {
    const yy = ty + i * 6;
    doc.setFont('helvetica', i === totals.length - 1 ? 'bold' : 'normal');
    doc.setTextColor(...DARK);
    doc.text(label, bx + 3, yy);
    doc.setTextColor(...color);
    doc.text(value, pageW - M - 3, yy, { align: 'right' });
  });
  if (st.closingBalance !== undefined && st.closingBalance !== ledger.computedClosing) {
    doc.setFontSize(8);
    doc.setTextColor(...RED);
    doc.text(
      `Atenção: saldo final informado no arquivo (${formatBRL(st.closingBalance)}) difere do calculado.`,
      M,
      ty + totals.length * 6 + 4,
    );
  }

  // Rodapé com paginação
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text('Documento gerado localmente a partir de arquivo OFX. Não substitui o extrato oficial do banco.', M, pageH - 8);
    doc.text(`Página ${p} de ${pages}`, pageW - M, pageH - 8, { align: 'right' });
  }

  return new Uint8Array(doc.output('arraybuffer'));
}
