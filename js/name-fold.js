// Plegado de nombres equivalente a public.fold_name: minúsculas, ligaduras, NFD sin marcas
// combinantes y letras latinas sin descomposición canónica (ł, ø, đ, ð, þ, ı…) a ASCII.
const LIGATURES = [['ß', 'ss'], ['æ', 'ae'], ['œ', 'oe'], ['ﬀ', 'ff'], ['ﬁ', 'fi'], ['ﬂ', 'fl'], ['þ', 'th'], ['ĳ', 'ij']];
const MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
const FROM = 'đłøıħŧŀðŋĸƒ';
const TO = 'dloihtldnkf';

// Pliega las letras latinas y conserva el resto de caracteres (otras escrituras, separadores).
export function foldLatin(value) {
  let text = String(value ?? '').toLowerCase();
  for (const [from, to] of LIGATURES) text = text.replaceAll(from, to);
  return [...text.normalize('NFD').replace(MARKS, '')]
    .map(char => { const i = FROM.indexOf(char); return i < 0 ? char : TO[i]; })
    .join('');
}

export const foldName = value => foldLatin(value).replace(/[^a-z0-9]+/g, ' ').trim();
