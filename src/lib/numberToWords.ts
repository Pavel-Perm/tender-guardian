// Russian number-to-words converter for currency (rubles and kopecks)

const units = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const unitsF = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function pluralize(n: number, one: string, two: string, five: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return five;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return two;
  return five;
}

function tripletToWords(n: number, feminine: boolean): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;

  if (h > 0) parts.push(hundreds[h]);
  if (t === 1) {
    parts.push(teens[u]);
    return parts.join(' ');
  }
  if (t > 1) parts.push(tens[t]);
  if (u > 0) parts.push(feminine ? unitsF[u] : units[u]);
  return parts.join(' ');
}

export function numberToWordsRubles(amount: number): string {
  if (amount === 0) return 'ноль рублей 00 копеек';

  const rub = Math.floor(Math.abs(amount));
  const kop = Math.round((Math.abs(amount) - rub) * 100);

  const parts: string[] = [];
  if (amount < 0) parts.push('минус');

  if (rub === 0) {
    parts.push('ноль');
  } else {
    const billions = Math.floor(rub / 1_000_000_000);
    const millions = Math.floor((rub % 1_000_000_000) / 1_000_000);
    const thousands = Math.floor((rub % 1_000_000) / 1_000);
    const remainder = rub % 1_000;

    if (billions > 0) {
      parts.push(tripletToWords(billions, false));
      parts.push(pluralize(billions, 'миллиард', 'миллиарда', 'миллиардов'));
    }
    if (millions > 0) {
      parts.push(tripletToWords(millions, false));
      parts.push(pluralize(millions, 'миллион', 'миллиона', 'миллионов'));
    }
    if (thousands > 0) {
      parts.push(tripletToWords(thousands, true)); // тысяча — feminine
      parts.push(pluralize(thousands, 'тысяча', 'тысячи', 'тысяч'));
    }
    if (remainder > 0) {
      parts.push(tripletToWords(remainder, false));
    }
  }

  parts.push(pluralize(rub, 'рубль', 'рубля', 'рублей'));
  parts.push(`${kop.toString().padStart(2, '0')} ${pluralize(kop, 'копейка', 'копейки', 'копеек')}`);

  // Capitalize first letter
  const result = parts.join(' ');
  return result.charAt(0).toUpperCase() + result.slice(1);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(amount);
}
