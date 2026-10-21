import type { ReactNode } from 'react';
import { Icon } from './ui';

const ITEMS: Array<{ q: string; a: ReactNode }> = [
  {
    q: 'Meus arquivos são enviados para algum servidor?',
    a: (
      <p>
        Não. Leitura, conversão e geração dos arquivos acontecem inteiramente no seu navegador. Você pode até desconectar a
        internet depois de abrir a página. A única exceção é o OCR: na primeira vez, o navegador baixa o motor e o modelo de
        português de um CDN público. Mesmo assim, o seu PDF não é enviado.
      </p>
    ),
  },
  {
    q: 'Como conferir se a conversão PDF → OFX está correta?',
    a: (
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Use o painel <strong>Conferência de saldo</strong>: saldo inicial + créditos − débitos precisa ser igual ao saldo
          final impresso no extrato. Se houver diferença, o painel sugere a causa provável (sinal trocado ou lançamento
          duplicado).
        </li>
        <li>
          Quando o PDF traz a coluna de saldo, cada linha mostra se o saldo calculado bate com o impresso. A primeira
          divergência fica em vermelho.
        </li>
        <li>
          Linhas em <span className="rounded bg-amber-100 px-1">amarelo</span> tiveram o tipo (crédito/débito) deduzido pela
          descrição. Confira essas primeiro.
        </li>
        <li>Compare a quantidade de lançamentos e os totais com o extrato original antes de importar.</li>
      </ul>
    ),
  },
  {
    q: 'Quais são as limitações?',
    a: (
      <ul className="list-disc space-y-1 pl-5">
        <li>
          A extração depende do layout do PDF. O parser genérico entende a maioria dos extratos em tabela (data, histórico,
          valor e saldo, inclusive com colunas separadas de débito e crédito), mas nenhum método automático é 100% confiável.
        </li>
        <li>PDFs escaneados (imagem) exigem OCR, que é mais lento e pode errar dígitos. Revise com atenção redobrada.</li>
        <li>Faturas de cartão de crédito e extratos de investimento não são o foco: os resultados podem variar.</li>
        <li>Se você enviar vários PDFs, eles devem ser da mesma conta. Os lançamentos são combinados em um único OFX.</li>
      </ul>
    ),
  },
  {
    q: 'Posso importar o mesmo OFX duas vezes sem duplicar lançamentos?',
    a: (
      <p>
        Sim. Cada lançamento recebe um identificador (FITID) calculado a partir da conta, data, valor e descrição. Ao gerar o
        OFX de novo a partir do mesmo extrato, os identificadores se repetem, e os sistemas que respeitam o FITID ignoram os
        já importados.
      </p>
    ),
  },
  {
    q: 'Qual formato de OFX escolher?',
    a: (
      <p>
        O <strong>OFX 1.02 (SGML)</strong> é o mais aceito por sistemas contábeis e financeiros brasileiros e é o padrão. Use o{' '}
        <strong>OFX 2.2 (XML)</strong> se o seu sistema pedir. Se o sistema exibir acentos errados, marque “Remover acentos das
        descrições”.
      </p>
    ),
  },
];

export function Help() {
  return (
    <section aria-labelledby="ajuda" className="space-y-3">
      <h2 id="ajuda" className="text-lg font-semibold text-slate-900">
        Ajuda
      </h2>
      <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {ITEMS.map((it) => (
          <details key={it.q} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50 sm:px-5 [&::-webkit-details-marker]:hidden">
              {it.q}
              <Icon.Chevron size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="px-4 pb-4 text-sm leading-relaxed text-slate-600 sm:px-5">{it.a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}
