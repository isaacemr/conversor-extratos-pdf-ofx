# Conversor de Extratos PDF ⇄ OFX

Aplicação web para profissionais de contabilidade e finanças que converte:

1. **PDF → OFX**: extratos bancários em PDF viram arquivos OFX importáveis em sistemas contábeis e financeiros, com **revisão e edição obrigatórias** antes de exportar.
2. **OFX → PDF**: arquivos OFX (1.x SGML ou 2.x XML) viram um extrato A4 legível, com saldo corrente e totais. Também exporta CSV.

**Privacidade:** todo o processamento acontece no navegador. Nenhum arquivo é enviado a servidor. A única requisição externa é opcional: na primeira vez que alguém usa o OCR, o `tesseract.js` baixa o motor e o modelo de português (~15 MB) de um CDN público. O PDF do usuário nunca sai da máquina.

## Instalação e execução

Requer Node.js 20+.

```bash
npm install
npm run dev        # servidor de desenvolvimento (http://localhost:5199)
npm test           # testes unitários (Vitest)
npm run build      # checagem de tipos + build de produção em dist/
npm run preview    # serve o build de produção
npm run fixtures   # regenera os PDFs de exemplo em fixtures/
```

O build em `dist/` é estático (HTML/JS/CSS) e pode ser hospedado em qualquer servidor de arquivos ou aberto offline.

## Funcionalidades

### PDF → OFX
- Upload por arrastar e soltar ou seleção, com vários arquivos (combinados em um único extrato da mesma conta).
- PDFs **protegidos por senha**: a senha é pedida e usada só no navegador.
- PDFs **escaneados** são detectados (pouco ou nenhum texto), e o OCR em português é oferecido.
- Identificação automática de banco, agência, conta, tipo de conta e período. O que faltar é preenchido no formulário.
- Tabela de revisão editável: data, descrição, documento, tipo (crédito/débito) e valor; excluir, adicionar, inverter sinal, ordenar e filtrar.
- **Conferência de saldo**: saldo inicial + créditos − débitos = saldo final. Quando há diferença, o painel sugere a causa provável (sinal trocado ou lançamento duplicado). Quando o PDF tem coluna de saldo, cada linha mostra se o saldo calculado bate com o impresso, e a primeira divergência fica destacada.
- Lançamentos com tipo deduzido por palavra-chave ficam em amarelo, para conferência.
- Exporta OFX 1.02 SGML (padrão) ou OFX 2.2 XML. O arquivo é **validado reabrindo-o com o próprio leitor** antes do download. Também exporta PDF e CSV a partir dos dados revisados.

### OFX → PDF
- Lê OFX 1.x (SGML, com tags sem fechamento) e 2.x (XML), em UTF-8, Windows-1252 ou ISO-8859-1. Os acentos saem corretos.
- Tolera peculiaridades comuns de bancos brasileiros: TRNAMT com vírgula, BANKID com 4 dígitos, datas com fuso (`[-3:BRT]`), `&` sem escape, NAME + MEMO, cartão de crédito (CCSTMTRS) e vários extratos no mesmo arquivo.
- Pré-visualização na tela e PDF A4 com cabeçalho, lançamentos (data, histórico, documento, valor e saldo corrente), totais, saldo final, data de geração e paginação. Débitos em vermelho.
- Exportação CSV no padrão do Excel brasileiro (`;`, vírgula decimal, UTF-8 com BOM).

## OFX gerado

- Cabeçalho `OFXHEADER:100 / DATA:OFXSGML / VERSION:102 / ENCODING:USASCII / CHARSET:1252`, arquivo codificado em Windows-1252. Na versão 2.2, XML em UTF-8.
- `SIGNONMSGSRSV1` (STATUS, DTSERVER, LANGUAGE POR) e `BANKMSGSRSV1 > STMTTRNRS > STMTRS` com CURDEF BRL, `BANKACCTFROM` (BANKID de 3 dígitos, BRANCHID, ACCTID, ACCTTYPE), `BANKTRANLIST` e `LEDGERBAL` (mais `AVAILBAL` quando conhecido).
- `STMTTRN` contém TRNTYPE (CREDIT/DEBIT), DTPOSTED (`AAAAMMDD`), TRNAMT (ponto decimal, negativo para débito), FITID, CHECKNUM (quando houver) e MEMO.
- **FITID determinístico**: `AAAAMMDD` + hash de banco|conta|data|valor|descrição|n, em que *n* é o índice de ocorrência entre lançamentos idênticos. Reimportar o mesmo extrato não duplica lançamentos, e editar ou excluir uma linha não altera o FITID das outras. FITIDs vindos de um OFX são preservados.
- MEMO é sanitizado: sem quebras de linha, controles, `<` e `>`. Em SGML, `&` vira `E`; em XML, é escapado como `&amp;`. O limite é 255 caracteres. Há opção para remover acentos.

## Arquitetura

```
src/
  types.ts                 Modelo: Statement, Transaction, AccountInfo (valores em centavos, datas ISO)
  utils/br-format.ts       Valores (1.234,56 / D / C / parênteses) e datas BR (dd/mm/aaaa, dd/mm, "05 JAN")
  utils/encoding.ts        Detecção UTF-8 × Windows-1252 e codificador 1252
  utils/banks.ts           Bancos (código COMPE, nome, padrões de identificação)
  utils/ledger.ts          Saldo corrente, totais e conferência
  utils/hash.ts            Hash determinístico (FITID)
  ofx/parse.ts             Leitor OFX 1.x/2.x (tokenizador único SGML/XML)
  ofx/write.ts             Gerador OFX 1.02/2.2
  pdf/extract.ts           pdf.js → itens com (x, y) → linhas e palavras
  pdf/pdfjs.ts             Carregamento do pdf.js no navegador (worker, senha)
  pdf/ocr.ts               OCR com tesseract.js (por), carregado sob demanda
  pdf/pipeline.ts          PDF → (texto | OCR) → parser
  pdf/render.ts            Extrato PDF A4 (jsPDF + jspdf-autotable)
  csv/write.ts             Exportação CSV
  parsers/
    types.ts               Contrato BankParser (detect + parse)
    generic.ts             Parser genérico (colunas por cabeçalho, cadeia de saldos)
    metadata.ts            Banco, agência, conta e período
    registry.ts            Registro e escolha do parser
    banks/                 Parsers específicos (nubank.ts, itau.ts)
  components/              Interface React
fixtures/                  Exemplos fictícios: OFX 1.x (1252), OFX 2.x (UTF-8) e PDFs gerados
scripts/gerar-fixtures.ts  Gera os PDFs de exemplo
```

### Como o parser genérico funciona
1. O pdf.js entrega trechos de texto com posição. Eles são agrupados em linhas pela coordenada vertical e quebrados em palavras com posição x.
2. O parser procura a **linha de títulos** (Data / Histórico / Documento / Valor / Débito / Crédito / Saldo / D/C) e usa a posição x de cada título para classificar as palavras das linhas seguintes. Isso resolve extratos com débito e crédito em colunas separadas. Sem títulos, ele usa a posição relativa: o último valor é o saldo e o penúltimo é o lançamento.
3. Uma linha que começa com data abre um lançamento. Uma linha sem data mas com valor também vira lançamento, no mesmo dia (bancos que imprimem a data uma vez por dia). Uma linha sem data e sem valor, logo abaixo e alinhada à descrição, é tratada como continuação da descrição.
4. Linhas de saldo (SALDO ANTERIOR, SALDO DO DIA, SALDO FINAL…), totais e seções como "Lançamentos futuros" não viram lançamento. Os saldos são guardados para a conferência.
5. Ordem de prioridade para o sinal: indicação explícita (`-`, `D`, `C`, parênteses) > coluna Débito/Crédito > coluna D/C > seção ("Total de saídas") > palavras-chave. Neste último caso, o lançamento é marcado como incerto.
6. A **cadeia de saldos** (saldo anterior + lançamentos = saldo impresso) confirma ou corrige sinais incertos. Quando só uma combinação de sinais fecha o saldo, ela é aplicada.

## Como adicionar o parser de um novo banco

A maioria dos bancos funciona com o genérico. Crie um parser específico quando o layout precisar de ajustes, como linhas extras a ignorar, marcadores de seção ou palavras-chave.

1. Crie `src/parsers/banks/meubanco.ts`:

```ts
import { createGenericParser } from '../generic';

export const meuBancoParser = createGenericParser({
  id: 'meubanco',
  name: 'Meu Banco',
  bankCode: '999',                                  // código COMPE
  ignore: [/^SALDO BLOQUEADO/, /^CPMF/],            // texto normalizado: sem acento, maiúsculas
  closingBalance: [/^SALDO CONTABIL/],              // linhas extras de saldo final
  sections: [{ pattern: /^RETIRADAS$/, sign: -1 }], // seções que definem o sinal
  debitKeywords: /\bBX APLIC\b/,
});
```

   Para layouts muito diferentes, implemente diretamente a interface `BankParser` (`detect` + `parse`) de `src/parsers/types.ts`. O `parse` recebe as linhas com as palavras e suas posições.

2. Registre o parser na lista de `src/parsers/registry.ts`, antes do `genericParser`.
3. Se o banco não estiver em `src/utils/banks.ts`, adicione o código, o nome e os padrões de identificação.
4. Adicione um teste em `src/parsers/` simulando o texto do extrato com `linesFromText` (veja `generic.test.ts`). Use dados fictícios.

Por padrão, o parser específico é escolhido quando o banco detectado tem o mesmo `bankCode`. Se ele não encontrar lançamentos, o registro tenta o genérico.

## Testes

`npm test` executa:
- parse/format de valores e datas brasileiras e de encodings;
- leitura de OFX SGML (Windows-1252) e XML (UTF-8), com casos de robustez;
- geração de OFX 1.02 e 2.2, sanitização e FITIDs estáveis;
- **ida e volta** OFX → objeto → OFX → objeto (os dois formatos, os dois fixtures);
- parser genérico com textos de extrato simulados (cabeçalho, colunas C/D, data por dia, estilo Nubank, D/C sem cabeçalho, cadeia de saldos, lançamentos futuros);
- **ponta a ponta com PDF real**: OFX → PDF gerado pelo app → pdf.js → parser → mesmas transações → OFX.

## Limitações conhecidas

- A extração automática de PDF não é 100% confiável. Por isso a revisão é obrigatória.
- Os parsers do Nubank e do Itaú são ajustes baseados no layout público e **não foram validados com extratos reais**. Os demais bancos usam o genérico.
- O OCR depende da qualidade da digitalização e pode errar dígitos e sinais. Ele exige download do modelo na primeira vez e é lento em documentos longos.
- Faturas de cartão de crédito e extratos de investimento não são o foco do parser de PDF.
- Datas sem ano (`dd/mm`, `05 JAN`) dependem do período detectado ou do ano predominante no documento.
- Vários PDFs no mesmo envio devem ser da mesma conta.

## Melhorias futuras

- Parsers validados com extratos reais de cada banco (Bradesco, BB, Caixa, Santander, Inter, Sicoob, Sicredi…).
- Leitura de faturas de cartão (OFX `CREDITCARDMSGSRSV1`).
- Detecção de lançamentos duplicados entre arquivos sobrepostos.
- Visualização do PDF lado a lado com a tabela de revisão, destacando a linha de origem.
- Empacotar o modelo de OCR junto com o app, para funcionar 100% offline.
- PWA (instalável e offline).
