import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { Statement, Transaction } from '../types';
import { newId } from '../types';
import { formatBRDate, formatBRL, normalizeForMatch, type DateContext } from '../utils/br-format';
import { computeLedger, sortByDate } from '../utils/ledger';
import { DateInput, MoneyInput } from './inputs';
import { Badge, Button, Icon, cx } from './ui';

interface Props {
  statement: Statement;
  onTransactions: (txs: Transaction[]) => void;
  /** Nome do arquivo de origem por id (exibido quando há mais de um PDF). */
  sources?: Record<string, string>;
}

interface RowProps {
  tx: Transaction;
  index: number;
  running: number;
  showRunning: boolean;
  ctx: DateContext;
  source?: string;
  firstMismatch: boolean;
  onPatch: (id: string, patch: Partial<Transaction>) => void;
  onDelete: (id: string) => void;
}

const Row = memo(function Row({ tx, index, running, showRunning, ctx, source, firstMismatch, onPatch, onDelete }: RowProps) {
  const isDebit = tx.amount < 0;
  const mismatch = showRunning && tx.balance !== undefined && tx.balance !== running;
  const zero = tx.amount === 0;
  return (
    <tr
      className={cx(
        'group border-b border-slate-100 align-middle',
        firstMismatch ? 'bg-red-50' : tx.uncertain ? 'bg-amber-50/70' : 'hover:bg-slate-50/60',
      )}
    >
      <td className={cx('w-10 border-l-4 py-1 pl-2 pr-1 text-right text-xs text-slate-400 num', tx.uncertain ? 'border-amber-400' : 'border-transparent')}>
        {index + 1}
      </td>
      <td className="w-[7.5rem] px-1 py-1">
        <DateInput variant="cell" value={tx.date} ctx={ctx} required aria-label={`Data do lançamento ${index + 1}`} onChange={(d) => d && onPatch(tx.id, { date: d })} />
      </td>
      <td className="min-w-[16rem] px-1 py-1">
        <input
          className="cell-input"
          value={tx.description}
          aria-label={`Descrição do lançamento ${index + 1}`}
          onChange={(e) => onPatch(tx.id, { description: e.target.value })}
        />
        {source && <div className="truncate px-1.5 text-[11px] text-slate-400">{source}</div>}
      </td>
      <td className="w-24 px-1 py-1">
        <input
          className="cell-input num"
          value={tx.checkNum ?? ''}
          aria-label={`Documento do lançamento ${index + 1}`}
          onChange={(e) => onPatch(tx.id, { checkNum: e.target.value || undefined })}
        />
      </td>
      <td className="w-32 px-1 py-1">
        <div className="flex items-center gap-1">
          <select
            className={cx('cell-input pr-1 font-medium', isDebit ? 'text-red-700' : 'text-emerald-700')}
            value={isDebit ? 'D' : 'C'}
            aria-label={`Tipo do lançamento ${index + 1}`}
            onChange={(e) => {
              const abs = Math.abs(tx.amount);
              onPatch(tx.id, { amount: e.target.value === 'D' ? -abs : abs, uncertain: false });
            }}
          >
            <option value="C">Crédito</option>
            <option value="D">Débito</option>
          </select>
          {tx.uncertain && (
            <button
              type="button"
              title="Tipo deduzido pela descrição. Clique para confirmar."
              aria-label="Confirmar tipo"
              onClick={() => onPatch(tx.id, { uncertain: false })}
              className="shrink-0 rounded bg-amber-200 px-1 text-[10px] font-semibold uppercase text-amber-900 hover:bg-amber-300"
            >
              confira
            </button>
          )}
        </div>
      </td>
      <td className="w-32 px-1 py-1">
        <MoneyInput
          variant="cell"
          absolute
          value={tx.amount}
          aria-label={`Valor do lançamento ${index + 1}`}
          className={cx(isDebit ? 'text-red-700' : 'text-emerald-700', zero && 'bg-amber-50')}
          onChange={(c) => onPatch(tx.id, { amount: (isDebit ? -1 : 1) * Math.abs(c ?? 0) })}
        />
      </td>
      {showRunning && (
        <td className="w-32 px-2 py-1 text-right text-[13px] num">
          <span className={cx(running < 0 ? 'text-red-700' : 'text-slate-700')}>{formatBRL(running)}</span>
          {tx.balance !== undefined && (
            <div
              className={cx('text-[11px]', mismatch ? 'font-medium text-red-600' : 'text-emerald-600')}
              title={mismatch ? 'Saldo impresso no extrato difere do saldo calculado' : 'Confere com o saldo impresso no extrato'}
            >
              {mismatch ? `extrato: ${formatBRL(tx.balance)}` : '✓ extrato'}
            </div>
          )}
        </td>
      )}
      <td className="w-20 px-1 py-1">
        <div className="flex justify-end gap-0.5 opacity-70 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            title="Inverter sinal (crédito ⇄ débito)"
            aria-label={`Inverter sinal do lançamento ${index + 1}`}
            onClick={() => onPatch(tx.id, { amount: -tx.amount, uncertain: false })}
          >
            <Icon.Swap size={15} />
          </Button>
          <Button variant="danger" size="icon" title="Excluir lançamento" aria-label={`Excluir lançamento ${index + 1}`} onClick={() => onDelete(tx.id)}>
            <Icon.Trash size={15} />
          </Button>
        </div>
      </td>
    </tr>
  );
});

export function ReviewTable({ statement, onTransactions, sources }: Props) {
  const [filter, setFilter] = useState('');
  const txs = statement.transactions;
  const ledger = useMemo(() => computeLedger(statement), [statement]);
  const showRunning = ledger.openingSource !== 'none' || txs.some((t) => t.balance !== undefined);
  const ctx: DateContext = { start: statement.startDate, end: statement.endDate };
  const uncertain = txs.filter((t) => t.uncertain).length;
  const multiSource = sources && new Set(txs.map((t) => t.source)).size > 1;

  const firstMismatchId = useMemo(() => {
    if (!showRunning) return undefined;
    return ledger.rows.find((r) => r.tx.balance !== undefined && r.tx.balance !== r.running)?.tx.id;
  }, [ledger, showRunning]);

  // Callbacks estáveis para que só a linha editada seja renderizada novamente.
  const latest = useRef({ txs, onTransactions });
  latest.current = { txs, onTransactions };
  const patch = useCallback((id: string, p: Partial<Transaction>) => {
    const { txs: cur, onTransactions: set } = latest.current;
    set(cur.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }, []);
  const remove = useCallback((id: string) => {
    const { txs: cur, onTransactions: set } = latest.current;
    set(cur.filter((t) => t.id !== id));
  }, []);
  const add = () => {
    const last = txs[txs.length - 1];
    onTransactions([
      ...txs,
      { id: newId(), date: last?.date ?? statement.endDate ?? new Date().toISOString().slice(0, 10), description: '', amount: 0, source: last?.source },
    ]);
  };

  const needle = normalizeForMatch(filter);
  const visible = ledger.rows
    .map((r, i) => ({ ...r, i }))
    .filter(({ tx }) => !needle || normalizeForMatch(`${tx.description} ${tx.checkNum ?? ''} ${formatBRDate(tx.date)} ${formatBRL(tx.amount)}`).includes(needle));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5 sm:px-5">
        <input
          type="search"
          className="field max-w-xs py-1.5"
          placeholder="Filtrar lançamentos…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filtrar lançamentos"
        />
        <Button size="sm" onClick={() => onTransactions(sortByDate(txs))} title="Ordena por data mantendo a ordem dentro de cada dia">
          <Icon.Sort size={14} /> Ordenar por data
        </Button>
        {uncertain > 0 && (
          <Button size="sm" onClick={() => onTransactions(txs.map((t) => (t.uncertain ? { ...t, uncertain: false } : t)))}>
            <Icon.Check size={14} /> Confirmar {uncertain} tipo(s) deduzido(s)
          </Button>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {filter ? `${visible.length} de ${txs.length}` : txs.length} lançamento(s)
          {uncertain > 0 && (
            <>
              {' · '}
              <Badge tone="amber">{uncertain} para conferir</Badge>
            </>
          )}
        </span>
      </div>

      <div className="max-h-[65vh] overflow-auto">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-[0_1px_0_#e2e8f0]">
            <tr>
              <th className="py-2 pl-2 pr-1 text-right font-semibold">#</th>
              <th className="px-2 py-2">Data</th>
              <th className="px-2 py-2">Descrição</th>
              <th className="px-2 py-2">Doc.</th>
              <th className="px-2 py-2">Tipo</th>
              <th className="px-2 py-2 text-right">Valor (R$)</th>
              {showRunning && <th className="px-2 py-2 text-right">Saldo (R$)</th>}
              <th className="px-2 py-2 text-right">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ tx, running, i }) => (
              <Row
                key={tx.id}
                tx={tx}
                index={i}
                running={running}
                showRunning={showRunning}
                ctx={ctx}
                source={multiSource && tx.source ? sources?.[tx.source] : undefined}
                firstMismatch={tx.id === firstMismatchId}
                onPatch={patch}
                onDelete={remove}
              />
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                  {txs.length === 0 ? 'Nenhum lançamento. Adicione manualmente ou envie outro PDF.' : 'Nenhum lançamento corresponde ao filtro.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 sm:px-5">
        <Button size="sm" onClick={add}>
          <Icon.Plus size={14} /> Adicionar lançamento
        </Button>
        {firstMismatchId && (
          <span className="text-xs text-red-600">
            A linha destacada em vermelho é a primeira em que o saldo calculado diverge do saldo impresso no extrato.
          </span>
        )}
      </div>
    </div>
  );
}
