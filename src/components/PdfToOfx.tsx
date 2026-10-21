import { useMemo, useState } from 'react';
import { parseOfx } from '../ofx/parse';
import { encodeOfx, writeOfx, type OfxVersion } from '../ofx/write';
import type { ParseResult } from '../parsers/types';
import { PdfPasswordError } from '../pdf/pdfjs';
import { processPdf } from '../pdf/pipeline';
import type { Statement, Transaction } from '../types';
import { newId } from '../types';
import { formatBRL } from '../utils/br-format';
import { downloadBlob, safeFilename } from '../utils/download';
import { sortByDate } from '../utils/ledger';
import { AccountForm } from './AccountForm';
import { BalanceCheck, balanceStatus } from './BalanceCheck';
import { Dropzone } from './Dropzone';
import { ReviewTable } from './ReviewTable';
import { Alert, Badge, Button, Card, CardHeader, Icon, ProgressBar, Spinner } from './ui';

type JobStatus = 'reading' | 'password' | 'scanned' | 'ocr' | 'done' | 'error';

interface Job {
  id: string;
  file: File;
  status: JobStatus;
  progress?: { msg: string; ratio: number };
  error?: string;
  passwordIncorrect?: boolean;
  result?: ParseResult;
  pageCount?: number;
  ocr?: boolean;
}

function emptyStatement(): Statement {
  return { account: { accountType: 'CHECKING' }, currency: 'BRL', transactions: [] };
}

/** Junta o resultado de um PDF ao rascunho em revisão (vários meses da mesma conta). */
function mergeStatement(prev: Statement | null, st: Statement, jobId: string): Statement {
  const txs = st.transactions.map((t) => ({ ...t, source: jobId }));
  if (!prev || prev.transactions.length === 0) return { ...st, transactions: txs };
  const acc = { ...prev.account };
  for (const [k, v] of Object.entries(st.account)) {
    if (v && !(acc as Record<string, unknown>)[k]) (acc as Record<string, unknown>)[k] = v;
  }
  const earlier = !!st.startDate && (!prev.startDate || st.startDate < prev.startDate);
  const later = !!st.endDate && (!prev.endDate || st.endDate > prev.endDate);
  return {
    ...prev,
    account: acc,
    startDate: earlier ? st.startDate : prev.startDate,
    endDate: later ? st.endDate : prev.endDate,
    openingBalance: earlier ? (st.openingBalance ?? prev.openingBalance) : prev.openingBalance,
    closingBalance: later ? (st.closingBalance ?? prev.closingBalance) : prev.closingBalance,
    transactions: sortByDate([...prev.transactions, ...txs]),
  };
}

export function PdfToOfx() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [draft, setDraft] = useState<Statement | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success' | 'warn'; text: string } | null>(null);
  const [version, setVersion] = useState<OfxVersion>('102');
  const [noAccents, setNoAccents] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [passwords, setPasswords] = useState<Record<string, string>>({});

  const updateJob = (id: string, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  async function run(job: Job, opts: { password?: string; ocr?: boolean } = {}) {
    updateJob(job.id, {
      status: opts.ocr ? 'ocr' : 'reading',
      error: undefined,
      progress: { msg: opts.ocr ? 'Preparando OCR…' : 'Lendo PDF…', ratio: 0 },
    });
    try {
      const data = await job.file.arrayBuffer();
      const out = await processPdf(data, {
        fileName: job.file.name,
        password: opts.password,
        ocr: opts.ocr,
        onProgress: (msg, ratio) => updateJob(job.id, { progress: { msg, ratio } }),
      });
      if (out.kind === 'scanned') {
        updateJob(job.id, { status: 'scanned', pageCount: out.pageCount, progress: undefined });
        return;
      }
      updateJob(job.id, { status: 'done', result: out.result, pageCount: out.pageCount, ocr: out.ocr, progress: undefined });
      if (out.result.statement.transactions.length > 0) {
        setDraft((prev) => mergeStatement(prev, out.result.statement, job.id));
      }
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        updateJob(job.id, { status: 'password', passwordIncorrect: e.incorrect, progress: undefined });
      } else {
        console.error(e);
        updateJob(job.id, {
          status: 'error',
          progress: undefined,
          error: e instanceof Error ? e.message : 'Erro inesperado ao ler o PDF.',
        });
      }
    }
  }

  function addFiles(files: File[]) {
    setNotice(null);
    const fresh = files.filter((f) => !jobs.some((j) => j.file.name === f.name && j.file.size === f.size));
    if (fresh.length < files.length) setNotice({ tone: 'warn', text: 'Arquivo(s) já adicionado(s) foram ignorados.' });
    const created: Job[] = fresh.map((file) => ({ id: newId(), file, status: 'reading' }));
    setJobs((js) => [...js, ...created]);
    // processa em sequência para não sobrecarregar o navegador
    void created.reduce((p, job) => p.then(() => run(job)), Promise.resolve());
  }

  function removeJob(id: string) {
    setJobs((js) => js.filter((j) => j.id !== id));
    setDraft((d) => {
      if (!d) return d;
      const txs = d.transactions.filter((t) => t.source !== id);
      return jobs.filter((j) => j.id !== id && j.status === 'done').length === 0 && txs.length === 0 ? null : { ...d, transactions: txs };
    });
  }

  function reset() {
    setJobs([]);
    setDraft(null);
    setNotice(null);
    setShowErrors(false);
  }

  const sources = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j.file.name])), [jobs]);
  const warnings = jobs.flatMap((j) => (j.result ? j.result.warnings.map((w) => (jobs.length > 1 ? `${j.file.name}: ${w}` : w)) : []));
  const busy = jobs.some((j) => j.status === 'reading' || j.status === 'ocr');
  const doneEmpty = jobs.filter((j) => j.status === 'done' && j.result && j.result.statement.transactions.length === 0);

  // ----- Exportação -----
  const exportErrors: string[] = [];
  const exportWarnings: string[] = [];
  if (draft) {
    if (!/^\d{3}$/.test(draft.account.bankId ?? '')) exportErrors.push('Informe o código do banco (3 dígitos).');
    if (!draft.account.accountId) exportErrors.push('Informe o número da conta.');
    if (draft.transactions.length === 0) exportErrors.push('Não há lançamentos para exportar.');
    const zeros = draft.transactions.filter((t) => t.amount === 0).length;
    if (zeros) exportWarnings.push(`${zeros} lançamento(s) com valor zero.`);
    const unc = draft.transactions.filter((t) => t.uncertain).length;
    if (unc) exportWarnings.push(`${unc} lançamento(s) com tipo deduzido ainda não conferido(s).`);
    const bs = balanceStatus(draft);
    if (bs.difference) exportWarnings.push(`A conferência de saldo tem diferença de R$ ${formatBRL(bs.difference)}.`);
    if (draft.closingBalance === undefined) exportWarnings.push('Saldo final não informado: o LEDGERBAL será o saldo inicial + movimentações.');
  }

  function baseName(st: Statement) {
    return safeFilename(
      ['extrato', st.account.bankId, st.account.accountId, st.startDate, st.endDate].filter(Boolean).join('_'),
    );
  }

  function exportOfx() {
    if (!draft) return;
    setShowErrors(true);
    if (exportErrors.length) {
      setNotice({ tone: 'error', text: exportErrors.join(' ') });
      return;
    }
    try {
      const st: Statement = {
        ...draft,
        transactions: draft.transactions.map(({ id, date, description, amount, checkNum, fitId, trnType }) => ({
          id, date, description, amount, checkNum, fitId, trnType,
        })),
      };
      const text = writeOfx(st, { version, stripAccents: noAccents });
      const bytes = encodeOfx(text, version);
      // Validação: reabre o arquivo gerado com o próprio leitor.
      const check = parseOfx(bytes).statements[0];
      const sum = (txs: Transaction[]) => txs.reduce((a, t) => a + t.amount, 0);
      if (check.transactions.length !== st.transactions.length || sum(check.transactions) !== sum(st.transactions)) {
        throw new Error('A validação do arquivo gerado falhou (contagem ou soma diferente).');
      }
      downloadBlob(bytes, `${baseName(st)}.ofx`, 'application/x-ofx');
      setNotice({
        tone: 'success',
        text: `OFX ${version === '102' ? '1.02 (SGML)' : '2.2 (XML)'} gerado e validado: ${check.transactions.length} lançamento(s), saldo final R$ ${formatBRL(check.closingBalance ?? 0)}.`,
      });
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Falha ao gerar o OFX.' });
    }
  }

  async function exportPdf() {
    if (!draft) return;
    const { renderStatementPdf } = await import('../pdf/render');
    downloadBlob(renderStatementPdf(draft), `${baseName(draft)}.pdf`, 'application/pdf');
  }

  async function exportCsv() {
    if (!draft) return;
    const { writeCsv } = await import('../csv/write');
    downloadBlob(writeCsv(draft), `${baseName(draft)}.csv`, 'text/csv;charset=utf-8');
  }

  // ----- Render -----
  if (jobs.length === 0) {
    return (
      <div className="space-y-4">
        <Dropzone
          extensions={['.pdf']}
          multiple
          title="Arraste extratos em PDF aqui ou clique para selecionar"
          hint="Aceita vários arquivos (ex.: meses seguidos da mesma conta). PDFs com senha e escaneados também."
          onFiles={addFiles}
          onReject={(n) => setNotice({ tone: 'error', text: `Arquivo(s) não suportado(s): ${n.join(', ')}. Envie PDFs.` })}
        />
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        <p className="text-center text-xs text-slate-500">
          Você revisa e edita todos os lançamentos antes de gerar o OFX.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Arquivos"
          subtitle={jobs.length > 1 ? 'Os lançamentos de todos os arquivos são combinados em um único extrato.' : undefined}
          actions={
            <Button size="sm" variant="ghost" onClick={reset}>
              Recomeçar
            </Button>
          }
        />
        <ul className="divide-y divide-slate-100">
          {jobs.map((j) => (
            <li key={j.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Icon.File size={18} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800" title={j.file.name}>
                  {j.file.name}
                </span>
                <JobBadge job={j} />
                <Button size="icon" variant="ghost" aria-label={`Remover ${j.file.name}`} title="Remover arquivo" onClick={() => removeJob(j.id)}>
                  <Icon.X size={16} />
                </Button>
              </div>
              {j.progress && (
                <div className="mt-2 space-y-1 pl-7">
                  <ProgressBar value={j.progress.ratio} />
                  <p className="text-xs text-slate-500">{j.progress.msg}</p>
                </div>
              )}
              {j.status === 'password' && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2 pl-7"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(j, { password: passwords[j.id] ?? '' });
                  }}
                >
                  <input
                    type="password"
                    className="field max-w-[14rem] py-1.5"
                    placeholder="Senha do PDF"
                    autoComplete="off"
                    value={passwords[j.id] ?? ''}
                    aria-invalid={j.passwordIncorrect || undefined}
                    onChange={(e) => setPasswords((p) => ({ ...p, [j.id]: e.target.value }))}
                  />
                  <Button type="submit" size="sm" variant="primary">
                    Abrir
                  </Button>
                  <span className="text-xs text-slate-500">
                    {j.passwordIncorrect ? 'Senha incorreta. ' : ''}A senha é usada só no seu navegador (muitos bancos usam parte do CPF).
                  </span>
                </form>
              )}
              {(j.status === 'scanned' || (j.status === 'done' && j.result?.statement.transactions.length === 0)) && (
                <div className="mt-2 pl-7">
                  <Alert tone="warn" title="Não encontramos transações neste PDF.">
                    <p>
                      {j.status === 'scanned'
                        ? 'Ele parece ser escaneado (sem texto selecionável).'
                        : 'O layout pode não ter sido reconhecido, ou o PDF pode ser uma imagem.'}{' '}
                      Você pode tentar o OCR (reconhecimento de texto): é mais lento e menos preciso, e na primeira vez baixa o
                      modelo de português (~15 MB). O PDF continua sem sair do seu computador.
                    </p>
                    {!j.ocr && (
                      <Button size="sm" variant="primary" className="mt-2" onClick={() => void run(j, { ocr: true })}>
                        <Icon.Scan size={14} /> Tentar OCR
                      </Button>
                    )}
                  </Alert>
                </div>
              )}
              {j.status === 'error' && (
                <div className="mt-2 pl-7">
                  <Alert tone="error">{j.error}</Alert>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-100 p-3 sm:px-5">
          <Dropzone extensions={['.pdf']} multiple compact title="Adicionar mais PDFs" onFiles={addFiles} />
        </div>
      </Card>

      {notice && <Alert tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Alert>}

      {warnings.length > 0 && (
        <Alert tone="warn" title="Pontos de atenção">
          <ul className="list-disc space-y-0.5 pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      {!draft && busy && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
          <Spinner /> Processando…
        </div>
      )}

      {!draft && !busy && doneEmpty.length > 0 && (
        <div className="text-center">
          <Button
            onClick={() => {
              setDraft(emptyStatement());
            }}
          >
            <Icon.Plus size={16} /> Digitar lançamentos manualmente
          </Button>
        </div>
      )}

      {draft && (
        <>
          <div className="grid gap-5 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader title="Dados da conta" subtitle="Preenchidos automaticamente quando possível. Confira." />
              <div className="p-4 sm:p-5">
                <AccountForm statement={draft} showErrors={showErrors} onChange={(p) => setDraft((d) => (d ? { ...d, ...p } : d))} />
              </div>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Conferência de saldo" />
              <div className="p-4 sm:p-5">
                <BalanceCheck statement={draft} onChange={(p) => setDraft((d) => (d ? { ...d, ...p } : d))} />
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Revisão dos lançamentos"
              subtitle="Edite qualquer campo. Linhas em amarelo tiveram o tipo deduzido pela descrição."
            />
            <ReviewTable statement={draft} sources={sources} onTransactions={(txs) => setDraft((d) => (d ? { ...d, transactions: txs } : d))} />
          </Card>

          <Card className="lg:sticky lg:bottom-4 lg:z-20 lg:shadow-lg">
            <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
              <div className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-slate-600">Formato</span>
                  <select className="field w-auto py-1.5" value={version} onChange={(e) => setVersion(e.target.value as OfxVersion)}>
                    <option value="102">OFX 1.02 (SGML) — recomendado</option>
                    <option value="220">OFX 2.2 (XML)</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={noAccents} onChange={(e) => setNoAccents(e.target.checked)} />
                  Remover acentos das descrições
                </label>
                {(exportErrors.length > 0 || exportWarnings.length > 0) && (
                  <ul className="w-full space-y-0.5 text-xs">
                    {exportErrors.map((e) => (
                      <li key={e} className="text-red-700">• {e}</li>
                    ))}
                    {exportWarnings.map((w) => (
                      <li key={w} className="text-amber-800">• {w}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void exportCsv()} disabled={!draft.transactions.length}>
                  CSV
                </Button>
                <Button size="sm" onClick={() => void exportPdf()} disabled={!draft.transactions.length}>
                  PDF
                </Button>
                <Button variant="primary" onClick={exportOfx} disabled={busy}>
                  <Icon.Download size={16} /> Gerar OFX
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function JobBadge({ job }: { job: Job }) {
  switch (job.status) {
    case 'reading':
    case 'ocr':
      return (
        <Badge tone="brand">
          <Spinner className="h-3 w-3" /> {job.status === 'ocr' ? 'OCR' : 'Lendo'}
        </Badge>
      );
    case 'password':
      return (
        <Badge tone="amber">
          <Icon.Lock size={12} /> Senha
        </Badge>
      );
    case 'scanned':
      return <Badge tone="amber">Sem texto</Badge>;
    case 'error':
      return <Badge tone="red">Erro</Badge>;
    case 'done': {
      const n = job.result?.statement.transactions.length ?? 0;
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {job.ocr && <Badge tone="amber">OCR</Badge>}
          <Badge tone="slate">{job.result?.parserName}</Badge>
          <Badge tone={n ? 'green' : 'amber'}>
            {n} lançamento{n === 1 ? '' : 's'}
          </Badge>
        </span>
      );
    }
  }
}
