/**
 * Decodificação/codificação de texto para OFX: UTF-8, Windows-1252 e ISO-8859-1.
 */

/**
 * Decodifica bytes de um arquivo de texto.
 *
 * Estratégia: tenta UTF-8 estrito; se falhar, usa Windows-1252 (superconjunto prático de
 * ISO-8859-1). Isso é mais confiável que o cabeçalho, pois muitos bancos declaram
 * CHARSET:1252 e gravam UTF-8 (ou o contrário). Texto 1252 com acentos quase nunca é
 * UTF-8 válido, então o teste estrito distingue bem os dois casos.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const body = bytes.subarray(start);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    return { text, encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(body), encoding: 'windows-1252' };
  }
}

// Caracteres do intervalo 0x80–0x9F do Windows-1252 (o resto de 0xA0–0xFF coincide com Unicode).
const CP1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Codifica texto em Windows-1252. Caracteres sem equivalente viram a versão sem acento ou "?". */
export function encodeWindows1252(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) {
      out.push(cp);
    } else if (CP1252_EXTRA[cp] !== undefined) {
      out.push(CP1252_EXTRA[cp]);
    } else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (const b of base) {
        const c = b.codePointAt(0)!;
        out.push(c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : 0x3f);
      }
    }
  }
  return Uint8Array.from(out);
}
