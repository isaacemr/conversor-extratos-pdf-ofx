import type { AccountType, Statement } from '../types';
import { BANKS, bankByCode } from '../utils/banks';
import { DateInput } from './inputs';
import { Field } from './ui';

interface Props {
  statement: Statement;
  onChange: (patch: Partial<Statement>) => void;
  /** Campos destacados como obrigatórios ainda não preenchidos. */
  showErrors?: boolean;
}

export function AccountForm({ statement, onChange, showErrors }: Props) {
  const acc = statement.account;
  const setAcc = (patch: Partial<Statement['account']>) => onChange({ account: { ...acc, ...patch } });
  const known = bankByCode(acc.bankId);
  const selectValue = !acc.bankId ? '' : known ? known.code : 'outro';

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Field label="Banco" className="col-span-2">
        <select
          className="field"
          value={selectValue}
          aria-invalid={showErrors && !acc.bankId ? true : undefined}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'outro') setAcc({ bankId: acc.bankId && !known ? acc.bankId : '000', bankName: undefined });
            else setAcc({ bankId: v || undefined, bankName: bankByCode(v)?.name });
          }}
        >
          <option value="">Selecione…</option>
          {[...BANKS]
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
            .map((b) => (
              <option key={b.code} value={b.code}>
                {b.code} — {b.name}
              </option>
            ))}
          <option value="outro">Outro (informar código)</option>
        </select>
      </Field>
      <Field label="Código (COMPE)" className="col-span-1">
        <input
          className="field num"
          inputMode="numeric"
          maxLength={3}
          value={acc.bankId ?? ''}
          aria-invalid={showErrors && !/^\d{3}$/.test(acc.bankId ?? '') ? true : undefined}
          onChange={(e) => {
            const code = e.target.value.replace(/\D/g, '').slice(0, 3);
            setAcc({ bankId: code || undefined, bankName: bankByCode(code)?.name });
          }}
        />
      </Field>
      <Field label="Tipo de conta" className="col-span-1">
        <select className="field" value={acc.accountType ?? 'CHECKING'} onChange={(e) => setAcc({ accountType: e.target.value as AccountType })}>
          <option value="CHECKING">Conta corrente</option>
          <option value="SAVINGS">Poupança</option>
          <option value="MONEYMRKT">Aplicação</option>
          <option value="CREDITLINE">Conta garantida</option>
        </select>
      </Field>
      <Field label="Agência" className="col-span-1">
        <input className="field num" value={acc.branchId ?? ''} placeholder="0000" onChange={(e) => setAcc({ branchId: e.target.value || undefined })} />
      </Field>
      <Field label="Conta (com dígito)" className="col-span-1">
        <input
          className="field num"
          value={acc.accountId ?? ''}
          placeholder="00000-0"
          aria-invalid={showErrors && !acc.accountId ? true : undefined}
          onChange={(e) => setAcc({ accountId: e.target.value || undefined })}
        />
      </Field>
      <Field label="Início do período" className="col-span-1">
        <DateInput value={statement.startDate} onChange={(d) => onChange({ startDate: d })} />
      </Field>
      <Field label="Fim do período" className="col-span-1">
        <DateInput value={statement.endDate} onChange={(d) => onChange({ endDate: d })} />
      </Field>
    </div>
  );
}
