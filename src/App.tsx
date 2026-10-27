import { useState } from 'react';
import { Help } from './components/Help';
import { OfxToPdf } from './components/OfxToPdf';
import { PdfToOfx } from './components/PdfToOfx';
import { Icon, cx } from './components/ui';

type Tab = 'pdf2ofx' | 'ofx2pdf';

const TABS: Array<{ id: Tab; label: string; desc: string }> = [
  { id: 'pdf2ofx', label: 'PDF → OFX', desc: 'Extraia os lançamentos de extratos em PDF, revise e gere um OFX para importar no seu sistema.' },
  { id: 'ofx2pdf', label: 'OFX → PDF', desc: 'Transforme um arquivo OFX em um extrato PDF legível, com saldo corrente e totais. Também exporta CSV.' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('pdf2ofx');
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-white">
              <Icon.Swap size={18} />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight text-slate-900 sm:text-lg">Conversor de Extratos</h1>
              <p className="text-xs text-slate-500">PDF ⇄ OFX para contabilidade e finanças</p>
            </div>
          </div>
          {/* No celular o selo desce para a linha de baixo; o logo fica sempre no canto superior direito. */}
          <div className="order-last flex w-full items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 lg:order-none lg:ml-auto lg:w-auto">
            <Icon.Lock size={14} className="shrink-0" />
            <span>Processamento 100% local: seus arquivos não saem do navegador</span>
          </div>
          <img src="./logo.png" alt="Logo" width={59} height={48} className="h-12 w-auto shrink-0" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <div role="tablist" aria-label="Tipo de conversão" className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={cx(
                  'rounded-lg px-4 py-2 text-sm font-semibold transition-colors sm:px-6',
                  tab === t.id ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-slate-600">{current.desc}</p>
        </div>

        {/* Os dois painéis ficam montados para não perder o trabalho ao trocar de aba. */}
        <div role="tabpanel" id="panel-pdf2ofx" aria-labelledby="tab-pdf2ofx" hidden={tab !== 'pdf2ofx'}>
          <PdfToOfx />
        </div>
        <div role="tabpanel" id="panel-ofx2pdf" aria-labelledby="tab-ofx2pdf" hidden={tab !== 'ofx2pdf'}>
          <OfxToPdf />
        </div>

        <Help />
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        Ferramenta de apoio: confira sempre o resultado com o extrato oficial do banco.
      </footer>
    </div>
  );
}
