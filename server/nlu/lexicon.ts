import type { Unit } from '../../shared/types';

/**
 * The shop's vocabulary. Aliases are matched on normalized text (Latin or
 * Devanagari), and on a phonetic key so ASR slips like "chawal/chaval",
 * "cheeni/chini", "atta/aata" still land on the right item.
 */
export interface ItemSeed {
  name: string;
  nameHi: string;
  unit: Unit;
  aliases: string[];
  price: number;
  cost: number;
  stock: number;
  lowStockAt: number;
}

export const ITEM_SEEDS: ItemSeed[] = [
  {
    name: 'Chawal',
    nameHi: 'चावल',
    unit: 'kg',
    aliases: ['chawal', 'chaawal', 'chaval', 'rice', 'चावल', 'अनाज'],
    price: 60,
    cost: 48,
    stock: 38,
    lowStockAt: 10,
  },
  {
    name: 'Atta',
    nameHi: 'आटा',
    unit: 'kg',
    aliases: ['atta', 'aata', 'flour', 'gehun', 'आटा', 'गेहूं'],
    price: 45,
    cost: 36,
    stock: 24,
    lowStockAt: 8,
  },
  {
    name: 'Sugar',
    nameHi: 'चीनी',
    unit: 'kg',
    aliases: ['sugar', 'cheeni', 'chini', 'shakar', 'चीनी', 'शक्कर'],
    price: 50,
    cost: 42,
    stock: 12,
    lowStockAt: 6,
  },
  {
    name: 'Toor Dal',
    nameHi: 'अरहर दाल',
    unit: 'kg',
    aliases: ['dal', 'daal', 'toor', 'arhar', 'tur dal', 'दाल', 'अरहर'],
    price: 140,
    cost: 120,
    stock: 9,
    lowStockAt: 5,
  },
  {
    name: 'Sarson Tel',
    nameHi: 'सरसों तेल',
    unit: 'litre',
    aliases: ['tel', 'oil', 'sarson', 'mustard oil', 'तेल', 'सरसों'],
    price: 165,
    cost: 145,
    stock: 3,
    lowStockAt: 4,
  },
  {
    name: 'Doodh',
    nameHi: 'दूध',
    unit: 'litre',
    aliases: ['doodh', 'dudh', 'milk', 'दूध'],
    price: 60,
    cost: 50,
    stock: 10,
    lowStockAt: 5,
  },
  {
    name: 'Ghee',
    nameHi: 'घी',
    unit: 'litre',
    aliases: ['ghee', 'ghi', 'घी'],
    price: 640,
    cost: 570,
    stock: 1,
    lowStockAt: 2,
  },
  {
    name: 'Namak',
    nameHi: 'नमक',
    unit: 'kg',
    aliases: ['namak', 'salt', 'नमक'],
    price: 22,
    cost: 16,
    stock: 14,
    lowStockAt: 5,
  },
  {
    name: 'Chai Patti',
    nameHi: 'चाय पत्ती',
    unit: 'packet',
    aliases: ['chai patti', 'chai', 'patti', 'tea', 'चाय', 'पत्ती'],
    price: 150,
    cost: 125,
    stock: 6,
    lowStockAt: 3,
  },
  {
    name: 'Biscuit',
    nameHi: 'बिस्किट',
    unit: 'packet',
    aliases: ['biscuit', 'biskut', 'बिस्किट'],
    price: 20,
    cost: 15,
    stock: 22,
    lowStockAt: 8,
  },
  {
    name: 'Maggi',
    nameHi: 'मैगी',
    unit: 'packet',
    aliases: ['maggi', 'meggi', 'मैगी'],
    price: 14,
    cost: 11,
    stock: 30,
    lowStockAt: 10,
  },
  {
    name: 'Sabun',
    nameHi: 'साबुन',
    unit: 'piece',
    aliases: ['sabun', 'soap', 'साबुन'],
    price: 35,
    cost: 27,
    stock: 16,
    lowStockAt: 6,
  },
  {
    name: 'Anda',
    nameHi: 'अंडा',
    unit: 'dozen',
    aliases: ['anda', 'ande', 'egg', 'eggs', 'अंडा', 'अंडे'],
    price: 84,
    cost: 72,
    stock: 8,
    lowStockAt: 3,
  },
  {
    name: 'Haldi',
    nameHi: 'हल्दी',
    unit: 'kg',
    aliases: ['haldi', 'turmeric', 'हल्दी'],
    price: 180,
    cost: 150,
    stock: 0.75,
    lowStockAt: 1,
  },
];

export const CUSTOMER_SEEDS = [
  { name: 'Ramesh', nameHi: 'रमेश', balance: 1240 },
  { name: 'Sunita', nameHi: 'सुनीता', balance: 0 },
  { name: 'Imran', nameHi: 'इमरान', balance: 380 },
  { name: 'Kamla Devi', nameHi: 'कमला देवी', balance: 0 },
];

/** Words that look like names but are not. */
export const NAME_STOPWORDS = new Set([
  'mujhe', 'mera', 'meri', 'main', 'hum', 'ham', 'aaj', 'kal', 'parso', 'abhi',
  'iske', 'uske', 'inhe', 'unhe', 'sab', 'sabko', 'kuch', 'kisi', 'ek', 'do',
  'teen', 'saare', 'sara', 'dukaan', 'dukan', 'shop', 'grahak', 'customer',
  'kisko', 'kisne', 'kaun', 'khata', 'udhaar', 'udhar', 'bhai', 'ji', 'sahab',
  'aur', 'par', 'phir', 'toh', 'to', 'bhi', 'ka', 'ki', 'ke', 'ko', 'ne', 'se',
  'mein', 'me', 'hai', 'hua', 'hui', 'liya', 'diya', 'diye', 'becha', 'aaya',
  'aaye', 'stock', 'sale', 'total', 'hisaab', 'hisab', 'summary', 'rate',
  'price', 'wala', 'wali', 'gaya', 'gayi', 'kar', 'karo', 'kar', 'de', 'do',
]);

/** Strong intent verbs/nouns. Each is matched as a substring of the
 * normalized utterance, so Hinglish word order does not matter. */
export const INTENT_KEYWORDS = {
  stock_in: [
    'aaya', 'aaye', 'aayi', 'aa gaya', 'aa gayi', 'mila', 'mile', 'aaya hai',
    'stock mein', 'stock me', 'godown', 'mangwaya', 'mangaya', 'khareeda',
    'kharida', 'purchase', 'bhar diya', 'naya maal', 'maal aaya',
    'आया', 'आए', 'मिला', 'खरीदा', 'मंगाया',
  ],
  credit: [
    'udhaar', 'udhar', 'udhaar diya', 'udhar diya', 'khaate mein', 'khate mein',
    'khata mein', 'credit', 'likh do', 'likh de', 'chadha do', 'baad mein dega',
    'उधार', 'खाते', 'खाता',
  ],
  payment: [
    'diye', 'diya', 'de diya', 'de diye', 'jama', 'jama kiya', 'paid', 'payment',
    'vasooli', 'vasool', 'chuka diya', 'chukaya', 'wapas kiya', 'wapas kiye',
    'ne diye', 'ne diya', 'डिये', 'दिया', 'जमा', 'वसूल', 'चुका',
  ],
  sale: [
    'becha', 'bech diya', 'bech diye', 'bech', 'bika', 'bik gaya', 'bik gayi',
    'sale', 'sold', 'nikal diya', 'nikla', 'बेचा', 'बिक',
  ],
  summary: [
    'sale kitni', 'kitni sale', 'aaj ka hisaab', 'aaj ka hisab', 'hisaab',
    'hisab', 'summary', 'total sale', 'din kaisa', 'aaj kaisa', 'report',
    'batao aaj', 'sunao', 'हिसाब', 'कितनी बिक्री', 'रिपोर्ट',
  ],
  stock_query: [
    'kitna bacha', 'kitni bachi', 'kitna hai', 'kitni hai', 'stock', 'bacha',
    'bachi', 'baki', 'available', 'कितना बचा', 'स्टॉक', 'बचा',
  ],
  low_stock: [
    'khatam', 'khatm', 'kam ho raha', 'kam hai', 'low stock', 'mangana',
    'mangwana', 'order karna', 'kya khatam', 'खत्म', 'कम',
  ],
  khata_query: [
    'khata', 'khate', 'udhaar kitna', 'udhar kitna', 'kitna udhaar',
    'kitna udhar', 'kisne kitna', 'kaun ka kitna', 'baaki', 'khata batao',
    'खाता', 'उधार कितना',
  ],
  add_item: ['naya item', 'naya saman', 'add karo', 'jod do', 'naya product', 'नया सामान', 'जोड़'],
  set_price: ['rate', 'price', 'dam', 'kiraya', 'रेट', 'दाम', 'कीमत'],
  undo: ['undo', 'galti ho gayi', 'galti', 'wapas karo', 'cancel karo', 'delete karo', 'undo karo'],
  greet: ['namaste', 'namaskar', 'hello', 'hi ', 'salaam', 'kaise ho', 'नमस्ते'],
  help: ['help', 'kya kar sakta', 'kya kar sakte', 'madad', 'मदद'],
  affirm: ['haan', 'ha', 'yes', 'theek', 'thik', 'sahi', 'ok', 'okay', 'bilkul', 'kar do', 'हाँ', 'हां'],
  deny: ['nahi', 'nahin', 'na', 'no', 'mat karo', 'rehne do', 'cancel', 'नहीं'],
} as const;

export type Intent =
  | 'stock_in'
  | 'credit'
  | 'payment'
  | 'sale'
  | 'summary'
  | 'stock_query'
  | 'low_stock'
  | 'khata_query'
  | 'add_item'
  | 'set_price'
  | 'undo'
  | 'greet'
  | 'help'
  | 'affirm'
  | 'deny'
  | 'unknown';

export const UNIT_WORDS: Record<string, Unit> = {
  kilo: 'kg', kilos: 'kg', kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  किलो: 'kg', किलोग्राम: 'kg',
  gram: 'kg', grams: 'kg', gm: 'kg', g: 'kg', ग्राम: 'kg',
  litre: 'litre', liter: 'litre', litres: 'litre', liters: 'litre', ltr: 'litre',
  लीटर: 'litre',
  packet: 'packet', packets: 'packet', pkt: 'packet', pack: 'packet', packs: 'packet',
  पैकेट: 'packet',
  piece: 'piece', pieces: 'piece', pcs: 'piece', pc: 'piece', nag: 'piece',
  पीस: 'piece',
  dozen: 'dozen', darjan: 'dozen', दर्जन: 'dozen',
  bori: 'kg', boori: 'kg', बोरी: 'kg',
};

/** Gram/litre style units need scaling into the item's base unit. */
export const UNIT_FACTORS: Record<string, { unit: Unit; factor: number }> = {
  gram: { unit: 'kg', factor: 0.001 },
  grams: { unit: 'kg', factor: 0.001 },
  gm: { unit: 'kg', factor: 0.001 },
  g: { unit: 'kg', factor: 0.001 },
  ग्राम: { unit: 'kg', factor: 0.001 },
  ml: { unit: 'litre', factor: 0.001 },
  किलो: { unit: 'kg', factor: 1 },
};

export const NUMBER_WORDS: Record<string, number> = {
  ek: 1, ik: 1, do: 2, doo: 2, teen: 3, tin: 3, char: 4, chaar: 4, panch: 5,
  paanch: 5, chhe: 6, che: 6, chah: 6, chhah: 6, saat: 7, sat: 7,
  aath: 8, ath: 8, nau: 9, no: 9, das: 10, dus: 10, gyarah: 11, barah: 12,
  pandrah: 15, solah: 16, bees: 20, bis: 20, pachees: 25, pachis: 25,
  tees: 30, tis: 30, chalees: 40, pachas: 50, pachaas: 50, saath: 60,
  sattar: 70, assi: 80, nabbe: 90, sau: 100, hazar: 1000, hazaar: 1000,
  dedh: 1.5, dedha: 1.5, dhai: 2.5, adha: 0.5, aadha: 0.5, adhi: 0.5,
  aadhi: 0.5, sava: 1.25, sawa: 1.25, dhaai: 2.5,
  एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, सात: 7, आठ: 8,
  नौ: 9, दस: 10, बारह: 12, पंद्रह: 15, बीस: 20, पच्चीस: 25, तीस: 30,
  चालीस: 40, पचास: 50, साठ: 60, सत्तर: 70, अस्सी: 80, नब्बे: 90, सौ: 100,
  हज़ार: 1000, हजार: 1000, डेढ़: 1.5, ढाई: 2.5, आधा: 0.5, आधी: 0.5,
};

export const MONEY_WORDS = ['rupaye', 'rupee', 'rupay', 'rs', 'rupees', 'रुपये', 'रुपए', '₹'];
