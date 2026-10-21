import type { ReactNode } from 'react';
import type { Statement } from '../types';
import { formatBRDate, formatBRL } from '../utils/br-format';
import { MoneyInput } from './inputs';
import { Icon, cx } from './ui';

interface Props {
  statement: Statement;
  onChange: (patch: Partial<Statement>) => void;
}

export interface BalanceStatus {
  credits: number;
  debits: number;
  computed?: number;
  difference?: number;
  hints: string[];
}

/** Totais e conferência: saldo inicial + movimentações = saldo final. */
export function balanceStatus(st: Statement): BalanceStatus {
  let credits = 0;
  let debits = 0;
  for (const t of st.transactions) {
    if (t.amount >= 0) credits += t.amount;
    else debits += t.amount;
  }
  const hints: string[] = [];
  if (st.openingBalance === undefined) return { credits, debits, hints };
  const computed = st.openingBalance + credits + debits;
  if (st.closingBalance === undefined) return { credits, debits, computed, hints };
  const difference = st.closingBalance - computed;
  if (difference !== 0) {
    const idx = (pred: (a: number) => boolean) =>
      st.transactions.flatMap((t, i) => (pred(t.amount) ? [`#${i + 1} (${formatBRDate(t.date)}, ${formatBRL(t.amount)})`] : []));
    if (difference % 2 === 0) {
      const flipped = idx((a) => a === -difference / 2);
      if (flipped.length) hints.push(`Possível sinal trocado: ${flipped.slice(0, 3).join(', ')}.`);
    }
    const dup = idx((a) => a === -difference);
    if (dup.length >= 1) hints.push(`Possível lançamento duplicado ou indevido: ${dup.slice(0, 3).join(', ')}.`);
    if (!hints.length) {
      hints.push(`Pode faltar um lançamento de ${difference > 0 ? 'crédito' : 'débito'} de R$ ${formatBRL(Math.abs(difference))}.`);
    }
  }
  return { credits, debits, computed, difference, hints };
}

function Line({ label, children, strong, tone }: { label: ReactNode; children: ReactNode; strong?: boolean; tone?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-3 py-1.5', strong && 'font-semibold')}>
      <span className="text-sm text-slate-600">{label}</span>
      <span className={cx('text-sm num', tone)}>{children}</span>
    </div>
  );
}

export function BalanceCheck({ statement, onChange }: Props) {
  const s = balanceStatus(statement);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Saldo inicial (anterior)</span>
          <MoneyInput value={statement.openingBalance} onChange={(v) => onChange({ openingBalance: v })} placeholder="não encontrado" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Saldo final do extrato</span>
          <MoneyInput value={statement.closingBalance} onChange={(v) => onChange({ closingBalance: v })} placeholder="não encontrado" />
        </label>
      </div>

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/60 px-3">
        <Line label="Saldo inicial">{statement.openingBalance === undefined ? '—' : formatBRL(statement.openingBalance)}</Line>
        <Line label="(+) Créditos" tone="text-emerald-700">{formatBRL(s.credits)}</Line>
        <Line label="(−) Débitos" tone="text-red-700">{formatBRL(s.debits)}</Line>
        <Line label="(=) Saldo final calculado" strong>{s.computed === undefined ? '—' : formatBRL(s.computed)}</Line>
      </div>

      {s.difference === undefined ? (
        <div className="flex gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
          <Icon.Info size={18} className="mt-0.5 shrink-0 text-slate-400" />
          <p>
            Informe o {statement.openingBalance === undefined ? 'saldo inicial' : 'saldo final'} impresso no extrato para conferir se
            todos os lançamentos foram capturados.
          </p>
        </div>
      ) : s.difference === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800" role="status">
          <Icon.Check size={18} className="shrink-0" /> Saldo confere: inicial + movimentações = saldo final.
        </div>
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">
          <p className="flex items-center gap-2 font-semibold">
            <Icon.Alert size={18} className="shrink-0" /> Diferença de R$ {formatBRL(s.difference)}
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-6">
            {s.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
