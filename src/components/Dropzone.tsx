import { useRef, useState, type DragEvent } from 'react';
import { Icon, cx } from './ui';

interface Props {
  /** Extensões aceitas, ex.: [".pdf"]. */
  extensions: string[];
  multiple?: boolean;
  title: string;
  hint?: string;
  compact?: boolean;
  onFiles: (files: File[]) => void;
  onReject?: (names: string[]) => void;
}

export function Dropzone({ extensions, multiple, title, hint, compact, onFiles, onReject }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const ok = files.filter((f) => extensions.some((ext) => f.name.toLowerCase().endsWith(ext)));
    const bad = files.filter((f) => !ok.includes(f));
    if (bad.length) onReject?.(bad.map((f) => f.name));
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    handle(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.current?.click();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={title}
      className={cx(
        'group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        compact ? 'gap-1 px-4 py-4' : 'gap-3 px-6 py-10 sm:py-12',
        over ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white hover:border-brand-500 hover:bg-brand-50/40',
      )}
    >
      {!compact && (
        <div className={cx('rounded-full p-3 transition-colors', over ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500 group-hover:bg-brand-100 group-hover:text-brand-700')}>
          <Icon.Upload size={24} />
        </div>
      )}
      <p className={cx('font-medium text-slate-800', compact ? 'text-sm' : 'text-base')}>
        {compact && <Icon.Plus size={14} className="mr-1 inline -translate-y-px" />}
        {title}
      </p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={extensions.join(',')}
        multiple={multiple}
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
