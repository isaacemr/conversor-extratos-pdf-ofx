import { useMemo, useState } from 'react';
import { OfxParseError, parseOfx, type OfxDocument } from '../ofx/parse';
import type { Statement } from '../types';
import { bankName } from '../utils/banks';
import { formatBRDate, formatBRL } from '../utils/br-format';
import { downloadBlob, safeFilename } from '../utils/download';
import { computeLedger } from '../utils/ledger';
import { Dropzone } from './Dropzone';
import { Alert, Badge, Button, Card, CardHeader, Icon, Spinner, cx } from './ui';

const ACCOUNT_TYPES: Record<string, string> = {
  CHECKING: 'Conta corrente',
  SAVINGS: 'Poupança',
  MONEYMRKT: 'Aplicação',
  CREDITLINE: 'Conta garantida',
  CREDITCARD: 'Cartão de crédito',
};

export function OfxToPdf() {
  const [fileName, setFileName] = useState('');
  const [doc, setDoc] = useState<OfxDocument | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'read' | 'pdf' | null>(null);

  async function onFiles([file]: File[]) {
    setError(null);
    setBusy('read');
    try {
      const parsed = parseOfx(new Uint8Array(await file.arrayBuffer()));
      setDoc(parsed);
      setIndex(0);
      setFileName(file.name);
    } catch (e) {
      setDoc(null);
      setError(
        e instanceof OfxParseError
          ? `Não foi possível ler "${file.name}": ${e.message}`
          : `Erro inesperado ao ler "${file.name}". Verifique se é um arquivo OFX.`,
      );
    } finally {
      setBusy(null);
    }
  }

  const st = doc?.statements[index];
  const base = st
    ? safeFilename(['extrato', st.account.bankId, st.account.accountId, st.startDate, st.endDate].filter(Boolean).join('_'))
    : 'extrato';

  async function downloadPdf() {
    if (!st) return;
    setBusy('pdf');
    try {
      const { renderStatementPdf } = await import('../pdf/render');
      downloadBlob(renderStatementPdf(st), `${base}.pdf`, 'application/pdf');
    } catch (e) {
      console.error(e);
      setError('Falha ao gerar o PDF.');
    } finally {
      setBusy(null);
    }
  }

  async function downloadCsv() {
    if (!st) return;
    const { writeCsv } = await import('../csv/write');
    downloadBlob(writeCsv(st), `${base}.csv`, 'text/csv;charset=utf-8');
  }

  if (!doc || !st) {
    return (
      <div className="space-y-4">
        <Dropzone
          extensions={['.ofx', '.qfx']}
          title="Arraste um arquivo OFX aqui ou clique para selecionar"
          hint="OFX 1.x (SGML) ou 2.x (XML), em UTF-8, Windows-1252 ou ISO-8859-1."
          onFiles={(f) => void onFiles(f)}
          onReject={(n) => setError(`Arquivo(s) não suportado(s): ${n.join(', ')}. Envie um arquivo .ofx.`)}
        />
        {busy === 'read' && (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
            <Spinner /> Lendo arquivo…
          </div>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="error" onClose={() => setError(null)}>{error}</Alert>}
      {doc.warnings.length > 0 && (
        <Alert tone="warn" title="Pontos de atenção no arquivo">
          <ul className="list-disc space-y-0.5 pl-5">
            {doc.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Icon.File size={18} className="text-slate-400" />
              <span className="break-all">{fileName}</span>
            </span>
          }
          subtitle={
            <span className="flex flex-wrap gap-1.5 pt-1">
              <Badge>OFX {doc.version === 1 ? '1.x (SGML)' : '2.x (XML)'}</Badge>
              <Badge>{doc.encoding === 'windows-1252' ? 'Windows-1252' : 'UTF-8'}</Badge>
              <Badge tone="brand">{st.transactions.length} lançamento(s)</Badge>
            </span>
          }
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={() => setDoc(null)}>
                Trocar arquivo
              </Button>
              <Button size="sm" onClick={() => void downloadCsv()}>
                <Icon.Download size={14} /> CSV
              </Button>
              <Button size="sm" variant="primary" onClick={() => void downloadPdf()} disabled={busy === 'pdf'}>
                {busy === 'pdf' ? <Spinner className="h-3.5 w-3.5" /> : <Icon.Download size={14} />} Baixar PDF
              </Button>
            </>
          }
        />
        {doc.statements.length > 1 && (
          <div className="border-b border-slate-100 px-4 py-2.5 sm:px-5">
            <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              O arquivo contém {doc.statements.length} extratos:
              <select className="field w-auto py-1.5" value={index} onChange={(e) => setIndex(+e.target.value)}>
                {doc.statements.map((s, i) => (
                  <option key={i} value={i}>
                    {s.account.accountId ?? `Extrato ${i + 1}`} — {formatBRDate(s.startDate)} a {formatBRDate(s.endDate)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <StatementPreview st={st} />
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="truncate text-sm font-medium text-slate-900" title={value}>
        {value || '—'}
      </dd>
    </div>
  );
}

function StatementPreview({ st }: { st: Statement }) {
  const ledger = useMemo(() => computeLedger(st, { sort: true }), [st]);
  const acc = st.account;
  return (
    <div>
      <dl className="grid grid-cols-2 gap-4 border-b border-slate-100 px-4 py-4 sm:grid-cols-4 sm:px-5">
        <Info label="Banco" value={[acc.bankId, acc.bankName || bankName(acc.bankId)].filter(Boolean).join(' — ')} />
        <Info label="Agência / Conta" value={[acc.branchId, acc.accountId].filter(Boolean).join(' / ')} />
        <Info label="Tipo" value={ACCOUNT_TYPES[acc.accountType ?? 'CHECKING'] ?? acc.accountType ?? ''} />
        <Info label="Período" value={st.startDate || st.endDate ? `${formatBRDate(st.startDate)} a ${formatBRDate(st.endDate)}` : ''} />
      </dl>

      <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
        {[
          { label: ledger.openingSource === 'derived' ? 'Saldo anterior (calculado)' : 'Saldo anterior', value: ledger.opening, tone: '' },
          { label: 'Créditos', value: ledger.totalCredits, tone: 'text-emerald-700' },
          { label: 'Débitos', value: ledger.totalDebits, tone: 'text-red-700' },
          { label: 'Saldo final', value: ledger.computedClosing, tone: ledger.computedClosing < 0 ? 'text-red-700' : '' },
        ].map((k) => (
          <div key={k.label} className="bg-white px-4 py-3 sm:px-5">
            <p className="text-xs text-slate-500">{k.label}</p>
            <p className={cx('mt-0.5 text-lg font-semibold num', k.tone)}>R$ {formatBRL(k.value)}</p>
          </div>
        ))}
      </div>
      {st.availableBalance !== undefined && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 sm:px-5">
          Saldo disponível informado (AVAILBAL): R$ {formatBRL(st.availableBalance)}
          {st.availableBalanceDate ? ` em ${formatBRDate(st.availableBalanceDate)}` : ''}
        </p>
      )}

      <div className="max-h-[60vh] overflow-auto border-t border-slate-100">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-[0_1px_0_#e2e8f0]">
            <tr>
              <th className="px-4 py-2 sm:pl-5">Data</th>
              <th className="px-2 py-2">Histórico</th>
              <th className="px-2 py-2">Documento</th>
              <th className="px-2 py-2 text-right">Valor (R$)</th>
              <th className="px-4 py-2 text-right sm:pr-5">Saldo (R$)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-slate-50/50 font-medium">
              <td className="px-4 py-1.5 sm:pl-5" />
              <td className="px-2 py-1.5 text-slate-600">SALDO ANTERIOR</td>
              <td />
              <td />
              <td className="px-4 py-1.5 text-right num sm:pr-5">{formatBRL(ledger.opening)}</td>
            </tr>
            {ledger.rows.map(({ tx, running }) => (
              <tr key={tx.id} className="hover:bg-slate-50/60">
                <td className="whitespace-nowrap px-4 py-1.5 num sm:pl-5">{formatBRDate(tx.date)}</td>
                <td className="px-2 py-1.5">{tx.description}</td>
                <td className="px-2 py-1.5 text-slate-500 num">{tx.checkNum}</td>
                <td className={cx('whitespace-nowrap px-2 py-1.5 text-right num', tx.amount < 0 ? 'text-red-700' : 'text-emerald-700')}>
                  {formatBRL(tx.amount)}
                </td>
                <td className={cx('whitespace-nowrap px-4 py-1.5 text-right num sm:pr-5', running < 0 && 'text-red-700')}>{formatBRL(running)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
