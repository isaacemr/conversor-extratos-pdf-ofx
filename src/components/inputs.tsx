import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { formatBRDate, formatBRL, parseBRDate, parseUserAmount, type DateContext } from '../utils/br-format';
import { cx } from './ui';

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  variant?: 'cell' | 'field';
};

function normalizeDateTyping(s: string): string {
  const t = s.trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 2)}/${t.slice(2, 4)}/${t.slice(4)}`;
  if (/^\d{6}$/.test(t)) return `${t.slice(0, 2)}/${t.slice(2, 4)}/${t.slice(4)}`;
  if (/^\d{4}$/.test(t)) return `${t.slice(0, 2)}/${t.slice(2, 4)}`;
  return t;
}

/** Campo de data dd/mm/aaaa. Guarda o texto digitado até ficar válido. */
export function DateInput({
  value,
  onChange,
  ctx,
  required,
  variant = 'field',
  className,
  ...rest
}: BaseProps & { value: string | undefined; onChange: (iso: string | undefined) => void; ctx?: DateContext }) {
  const [text, setText] = useState(formatBRDate(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(formatBRDate(value));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const t = normalizeDateTyping(text);
    if (!t) {
      setInvalid(!!required);
      onChange(undefined);
      return;
    }
    const iso = parseBRDate(t, ctx);
    if (iso) {
      setInvalid(false);
      setText(formatBRDate(iso));
      if (iso !== value) onChange(iso);
    } else {
      setInvalid(true);
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="dd/mm/aaaa"
      autoComplete="off"
      value={text}
      aria-invalid={invalid || (required && !value) ? true : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cx(variant === 'cell' ? 'cell-input num' : 'field num', className)}
      {...rest}
    />
  );
}

/** Campo de valor no padrão brasileiro (1.234,56). */
export function MoneyInput({
  value,
  onChange,
  absolute,
  variant = 'field',
  className,
  ...rest
}: BaseProps & { value: number | undefined; onChange: (cents: number | undefined) => void; absolute?: boolean }) {
  const show = (v: number | undefined) => (v === undefined ? '' : formatBRL(absolute ? Math.abs(v) : v));
  const [text, setText] = useState(show(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(show(value));
    setInvalid(false);
  }, [value]); // `show` depende só de `absolute`, que não muda

  const commit = () => {
    if (!text.trim()) {
      setInvalid(false);
      onChange(undefined);
      return;
    }
    let cents = parseUserAmount(text);
    if (cents === null) {
      setInvalid(true);
      return;
    }
    if (absolute) cents = Math.abs(cents);
    setInvalid(false);
    setText(show(cents));
    if (cents !== value) onChange(cents);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0,00"
      value={text}
      aria-invalid={invalid || undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cx(variant === 'cell' ? 'cell-input num text-right' : 'field num text-right', className)}
      {...rest}
    />
  );
}
