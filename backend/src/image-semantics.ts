/**
 * Semantic image search for vocabulary cards.
 *
 * The goal: never send the bare English headword to Pixabay/Unsplash. Resolve what
 * the learner's card actually means (Vietnamese meaning first, then the example
 * context, part of speech, and only then the English word) and turn that meaning
 * into an English image query.
 *
 * This is a deterministic, offline knowledge base (sense lexicon + a Vietnamese →
 * English keyword lexicon + example/definition analysis). It is intentionally
 * extensible: an LLM/translation provider can be plugged in later behind
 * `resolveImageSense` without touching the provider or job layers.
 */

export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb' | 'phrase' | 'idiom' | 'unknown';

export interface SemanticCard {
  front: string;
  back?: string | null;
  translation?: string | null;
  example?: string | null;
  partOfSpeech?: string | null;
  notes?: string | null;
  exampleTranslation?: string | null;
}

export interface SenseResolution {
  term: string;
  meaningVi: string;
  meaningEn: string;
  senseKey: string;
  partOfSpeech: PartOfSpeech;
  concept: string;
  queries: string[];
  requiredTerms: string[];
  contextTerms: string[];
  confidence: number;
  source: 'sense-lexicon' | 'translation-lexicon' | 'example-context' | 'definition' | 'front-fallback';
}

const DIACRITICS = /[\u0300-\u036f]/g;
export function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(DIACRITICS, '').replace(/đ/g, 'd');
}
export function tokenize(value: string): string[] {
  return normalizeText(value).split(/[^a-z0-9]+/).filter(token => token.length >= 2);
}
export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}
export function normalizeTerm(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^to /, '');
}

const VI_CHARS = /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i;
const VI_SYLLABLES = new Set([
  'ngan', 'hang', 'bo', 'song', 'con', 'doi', 'gay', 'bong', 'chay', 'anh', 'sang', 'nhe', 'van', 'hanh',
  'xe', 'hong', 'suy', 'sup', 'tinh', 'than', 'qua', 'tao', 'cong', 'ty', 'nha', 'bang', 'dien', 'may',
  'nguoi', 'dong', 'vat', 'the', 'thao', 'hoa', 'bai', 'bien', 'nui', 'dat', 'nuoc', 'tien', 'phuong',
  'buoc', 'toi', 'hoi', 'tra', 'phat', 'nghe', 'nghia', 'dich', 'vi', 'du', 'cau', 'vi', 'loai', 'tu',
  'kho', 'hieu', 'gan', 'minh', 'dung', 'nghia', 'chinh', 'xac', 'hinh', 'anh', 'tim', 'kiem',
]);
export function looksVietnamese(value: string): boolean {
  if (!value) return false;
  if (VI_CHARS.test(value)) return true;
  const tokens = normalizeText(value).split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const hits = tokens.filter(token => VI_SYLLABLES.has(token)).length;
  return hits >= Math.max(1, Math.ceil(tokens.length * 0.4));
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its', 'as', 'by', 'from', 'into', 'about',
  'something', 'someone', 'somebody', 'act', 'state', 'quality', 'way', 'very', 'more', 'most', 'than',
  'his', 'her', 'their', 'our', 'your', 'my', 'he', 'she', 'they', 'we', 'you', 'i', 'them', 'him',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might',
  'not', 'no', 'so', 'if', 'then', 'when', 'while', 'there', 'here', 'also', 'just', 'only', 'up', 'down',
  'nguoi', 'mot', 'cai', 'con', 'nhung', 'cac', 'va', 'la', 'cua', 'cho', 'voi', 'trong', 'ra', 'den',
  'tu', 'khi', 'de', 'bi', 'duoc', 'nhu', 'the', 'nay', 'do', 'co', 'khong', 'mot', 'cung', 'rat',
  'nhieu', 'it', 'hon', 'nhat', 'dang', 'da', 'se', 'vua', 'moi', 'boi', 'vi', 'nen', 'thi', 'ma',
]);

function contentWords(value: string, limit = 4): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const token of tokenize(value)) {
    if (token.length < 3 || STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    words.push(token);
    if (words.length >= limit) break;
  }
  return words;
}

interface SenseEntry {
  id: string;
  /** Normalized Vietnamese/English phrases that identify this sense. */
  match: string[];
  query: string;
  /** Additional query phrasings tried only when the primary query is not good enough. */
  variants?: string[];
  partOfSpeech: PartOfSpeech;
  required: string[];
  concept: string;
}

/**
 * Curated senses for the words where a bare headword search is most dangerous
 * (polysemy, homographs, idioms). The list is deliberately a knowledge base of
 * *senses*, not image URLs: every image still comes from the provider and is
 * scored against the resolved sense.
 */
const SENSES: Record<string, SenseEntry[]> = {
  bank: [
    { id: 'bank-finance', match: ['ngan hang', 'nha bang', 'tai chinh', 'financial institution', 'money'], query: 'bank building finance money', partOfSpeech: 'noun', required: ['bank', 'building', 'finance', 'money'], concept: 'ngân hàng / tòa nhà ngân hàng' },
    { id: 'bank-river', match: ['bo song', 'ven song', 'bo bien', 'bo ho', 'river bank', 'riverside', 'river side'], query: 'river bank landscape water', partOfSpeech: 'noun', required: ['river', 'bank', 'water', 'landscape'], concept: 'bờ sông' },
  ],
  bat: [
    { id: 'bat-animal', match: ['con doi', 'dong vat', 'bat animal', 'flying mammal'], query: 'bat animal flying night', partOfSpeech: 'noun', required: ['bat', 'animal', 'flying'], concept: 'con dơi' },
    { id: 'bat-baseball', match: ['gay bong chay', 'bong chay', 'baseball bat', 'sport'], query: 'baseball bat player sport', partOfSpeech: 'noun', required: ['baseball', 'bat', 'sport'], concept: 'gậy bóng chày' },
  ],
  light: [
    { id: 'light-illumination', match: ['anh sang', 'anh den', 'den', 'illumination', 'brightness', 'sunlight'], query: 'light bulb illumination bright', partOfSpeech: 'noun', required: ['light', 'bulb', 'illumination', 'bright'], concept: 'ánh sáng' },
    { id: 'light-weight', match: ['nhe', 'nhe nang', 'trong luong nhe', 'lightweight', 'not heavy'], query: 'lightweight feather balance', partOfSpeech: 'adjective', required: ['lightweight', 'feather', 'balance'], concept: 'nhẹ' },
  ],
  run: [
    { id: 'run-motion', match: ['chay', 'chay bo', 'running', 'sprint', 'jog'], query: 'person running action sport', partOfSpeech: 'verb', required: ['running', 'person', 'action', 'sport'], concept: 'chạy' },
    { id: 'run-operate', match: ['van hanh', 'dieu hanh', 'hoat dong', 'operate', 'machine', 'engine'], query: 'machine operating factory engine', partOfSpeech: 'verb', required: ['machine', 'operating', 'factory', 'engine'], concept: 'vận hành' },
  ],
  'break down': [
    { id: 'breakdown-vehicle', match: ['xe bi hong', 'xe hong', 'hu xe', 'broken car', 'vehicle breakdown', 'car broke'], query: 'broken car roadside breakdown', partOfSpeech: 'phrase', required: ['broken', 'car', 'roadside', 'breakdown'], concept: 'xe bị hỏng' },
    { id: 'breakdown-emotional', match: ['suy sup', 'tinh than', 'khung hoang', 'emotional', 'collapse', 'crying'], query: 'emotional breakdown stress crying', partOfSpeech: 'phrase', required: ['emotional', 'breakdown', 'stress'], concept: 'suy sụp tinh thần' },
  ],
  charge: [
    { id: 'charge-accuse', match: ['buoc toi', 'bi buoc toi', 'toi', 'accuse', 'criminal', 'court'], query: 'courtroom criminal accusation', partOfSpeech: 'verb', required: ['courtroom', 'criminal', 'accusation'], concept: 'buộc tội' },
    { id: 'charge-battery', match: ['sac', 'nap dien', 'pin', 'battery', 'charging'], query: 'charging phone battery cable', partOfSpeech: 'verb', required: ['charging', 'phone', 'battery'], concept: 'sạc pin' },
    { id: 'charge-fee', match: ['phi', 'gia', 'tien phi', 'fee', 'price', 'cost'], query: 'price fee payment money', partOfSpeech: 'noun', required: ['price', 'fee', 'payment', 'money'], concept: 'phí / giá' },
  ],
  apple: [
    { id: 'apple-fruit', match: ['qua tao', 'trai tao', 'tao', 'fruit'], query: 'apple fruit red', partOfSpeech: 'noun', required: ['apple', 'fruit'], concept: 'quả táo' },
    { id: 'apple-company', match: ['cong ty', 'thuong hieu', 'cong nghe', 'apple inc', 'technology', 'iphone'], query: 'apple technology iphone device', partOfSpeech: 'noun', required: ['apple', 'technology', 'iphone'], concept: 'công ty Apple' },
  ],
  'give up': [
    { id: 'giveup-quit', match: ['tu bo', 'bo cuoc', 'từ bỏ', 'quit', 'abandon'], query: 'person giving up quit goal', partOfSpeech: 'phrase', required: ['giving', 'quit', 'goal'], concept: 'từ bỏ' },
  ],
  'once in a blue moon': [
    { id: 'idiom-rare', match: ['rat hiem', 'hiem khi', 'rarely', 'rare'], query: 'rare event surprise', partOfSpeech: 'idiom', required: ['rare', 'event'], concept: 'rất hiếm khi' },
  ],
  spring: [
    { id: 'spring-season', match: ['mua xuan', 'xuan', 'spring season'], query: 'spring season flowers blossom', partOfSpeech: 'noun', required: ['spring', 'season', 'flowers'], concept: 'mùa xuân' },
    { id: 'spring-water', match: ['suoi', 'nguon nuoc', 'water spring'], query: 'natural spring water forest', partOfSpeech: 'noun', required: ['spring', 'water', 'forest'], concept: 'suối' },
  ],
  match: [
    { id: 'match-fire', match: ['que diem', 'diem', 'match fire'], query: 'matchstick fire flame', partOfSpeech: 'noun', required: ['matchstick', 'fire', 'flame'], concept: 'que diêm' },
    { id: 'match-game', match: ['tran dau', 'thi dau', 'game', 'competition'], query: 'sports match competition stadium', partOfSpeech: 'noun', required: ['match', 'competition', 'stadium'], concept: 'trận đấu' },
  ],
  seal: [
    { id: 'seal-animal', match: ['hai cau', 'con hai cau', 'seal animal'], query: 'seal animal ocean', partOfSpeech: 'noun', required: ['seal', 'animal', 'ocean'], concept: 'con hải cẩu' },
    { id: 'seal-stamp', match: ['con dau', 'an', 'stamp', 'seal stamp'], query: 'document seal stamp wax', partOfSpeech: 'noun', required: ['seal', 'stamp', 'document'], concept: 'con dấu' },
  ],
  bark: [
    { id: 'bark-dog', match: ['sua', 'cho sua', 'bark dog'], query: 'dog barking', partOfSpeech: 'verb', required: ['dog', 'barking'], concept: 'sủa' },
    { id: 'bark-tree', match: ['vo cay', 'vo', 'tree bark'], query: 'tree bark texture', partOfSpeech: 'noun', required: ['tree', 'bark'], concept: 'vỏ cây' },
  ],
  house: [
    { id: 'house-home', match: ['house', 'ngoi nha', 'nha o', 'home'], query: 'house home exterior', variants: ['suburban house', 'family home garden', 'house front door'], partOfSpeech: 'noun', required: ['house', 'home'], concept: 'ngôi nhà' },
  ],
  river: [
    { id: 'river-water', match: ['river', 'con song', 'dong song'], query: 'river landscape water', variants: ['flowing river', 'river bank nature', 'river water'], partOfSpeech: 'noun', required: ['river', 'water'], concept: 'con sông' },
  ],
  airplane: [
    { id: 'airplane-flight', match: ['airplane', 'may bay', 'plane'], query: 'airplane flying sky', variants: ['airplane runway', 'passenger plane flight', 'airplane clouds'], partOfSpeech: 'noun', required: ['airplane', 'flying'], concept: 'máy bay' },
  ],
  buy: [
    { id: 'buy-shopping', match: ['buy', 'mua'], query: 'person shopping buying', variants: ['shopping cart store', 'customer paying shop', 'buying groceries market'], partOfSpeech: 'verb', required: ['shopping'], concept: 'mua' },
  ],
  swim: [
    { id: 'swim-water', match: ['swim', 'boi'], query: 'person swimming pool', variants: ['swimmer freestyle pool', 'swimming underwater', 'swim goggles pool'], partOfSpeech: 'verb', required: ['swimming', 'person'], concept: 'bơi' },
  ],
  eat: [
    { id: 'eat-food', match: ['eat', 'an'], query: 'person eating food', variants: ['family eating dinner', 'eating meal table', 'person eating lunch'], partOfSpeech: 'verb', required: ['eating', 'person', 'food'], concept: 'ăn' },
  ],
  sing: [
    { id: 'sing-voice', match: ['sing', 'hat'], query: 'person singing microphone', variants: ['singer stage microphone', 'woman singing', 'choir singing'], partOfSpeech: 'verb', required: ['singing', 'person', 'microphone'], concept: 'hát' },
  ],
  sad: [
    { id: 'sad-emotion', match: ['sad', 'buon ba'], query: 'sad person crying', variants: ['sad woman window', 'unhappy person alone', 'tears sadness'], partOfSpeech: 'adjective', required: ['sad', 'person'], concept: 'buồn bã' },
  ],
  heavy: [
    { id: 'heavy-weight', match: ['heavy', 'nang'], query: 'heavy box lifting', variants: ['man carrying heavy box', 'heavy weight lifting', 'heavy stone'], partOfSpeech: 'adjective', required: ['heavy'], concept: 'nặng' },
  ],
  slow: [
    { id: 'slow-speed', match: ['slow', 'cham'], query: 'slow turtle', variants: ['turtle walking slow', 'snail slow motion', 'slow traffic'], partOfSpeech: 'adjective', required: ['slow', 'turtle'], concept: 'chậm' },
  ],
  beautiful: [
    { id: 'beautiful-scene', match: ['beautiful', 'xinh dep'], query: 'beautiful flower garden', variants: ['beautiful landscape sunset', 'beautiful woman portrait', 'beautiful nature'], partOfSpeech: 'adjective', required: ['beautiful', 'flower'], concept: 'xinh đẹp' },
  ],
  success: [
    { id: 'success-achievement', match: ['success', 'thanh cong'], query: 'success celebration trophy', variants: ['business success handshake', 'winner trophy celebration', 'goal achievement'], partOfSpeech: 'noun', required: ['success', 'trophy', 'celebration'], concept: 'thành công' },
  ],
  justice: [
    { id: 'justice-law', match: ['justice', 'cong ly'], query: 'lady justice scales', variants: ['courtroom judge gavel', 'scales of justice', 'law justice statue'], partOfSpeech: 'noun', required: ['justice', 'scales'], concept: 'công lý' },
  ],
  freedom: [
    { id: 'freedom-liberty', match: ['freedom', 'tu do'], query: 'statue of liberty freedom', variants: ['freedom hands raised', 'bird flying freedom', 'open sky freedom'], partOfSpeech: 'noun', required: ['freedom', 'liberty', 'statue'], concept: 'tự do' },
  ],
  'take off': [
    { id: 'takeoff-flight', match: ['take off', 'cat canh'], query: 'airplane takeoff runway', variants: ['plane taking off', 'airplane runway departure', 'jet takeoff'], partOfSpeech: 'phrase', required: ['airplane', 'takeoff', 'runway'], concept: 'cất cánh' },
  ],
  'hit the hay': [
    { id: 'idiom-bed', match: ['hit the hay', 'di ngu'], query: 'person sleeping bed', variants: ['sleeping in bed', 'person going to bed', 'bedroom sleep night'], partOfSpeech: 'idiom', required: ['sleeping', 'bed', 'person'], concept: 'đi ngủ' },
  ],
  'under the weather': [
    { id: 'idiom-sick', match: ['under the weather', 'thay khong khoe', 'khong khoe'], query: 'sick person bed rest', variants: ['person with cold tissues', 'feeling sick thermometer', 'ill person blanket'], partOfSpeech: 'idiom', required: ['sick', 'person', 'bed'], concept: 'thấy không khỏe' },
  ],
  'piece of cake': [
    { id: 'idiom-easy', match: ['piece of cake', 'de nhu an keo'], query: 'slice of cake dessert', variants: ['chocolate cake slice', 'easy task thumbs up', 'cake plate'], partOfSpeech: 'idiom', required: ['cake', 'slice'], concept: 'dễ như ăn kẹo' },
  ],
  'look after': [
    { id: 'lookafter-care', match: ['look after', 'cham soc'], query: 'caregiver caring child', variants: ['parent caring child', 'elderly care', 'nurse caring patient'], partOfSpeech: 'phrase', required: ['caregiver', 'caring', 'child'], concept: 'chăm sóc' },
  ],
  'turn on': [
    { id: 'turnon-switch', match: ['turn on', 'bat'], query: 'hand switching light switch', variants: ['light switch hand', 'turning on lamp', 'power switch'], partOfSpeech: 'phrase', required: ['hand', 'switch', 'light'], concept: 'bật' },
  ],
};

/** Additional phrasings for senses that are hard to illustrate with one query. */
const SENSE_VARIANTS: Record<string, string[]> = {
  'bank-finance': ['bank branch exterior', 'banking transaction money', 'bank building city'],
  'bank-river': ['river shoreline', 'grassy riverbank', 'river edge nature'],
  'bat-animal': ['fruit bat hanging', 'bat wildlife close up', 'bat wings night'],
  'bat-baseball': ['baseball player swinging bat', 'wooden baseball bat', 'baseball bat ball'],
  'light-illumination': ['lamp glowing light', 'sunlight rays', 'bright light beam'],
  'light-weight': ['light as a feather', 'weight scale light', 'light object floating'],
  'run-motion': ['runner jogging outdoors', 'sprint running track', 'running motion'],
  'run-operate': ['factory machine working', 'engine running industrial', 'machine control panel'],
  'breakdown-vehicle': ['car breakdown hood open', 'tow truck broken car', 'car smoke engine'],
  'breakdown-emotional': ['person crying stress', 'mental breakdown support', 'sad person comfort'],
  'charge-accuse': ['court trial judge', 'person accused court', 'handcuffs crime'],
  'charge-battery': ['phone charger battery', 'electric car charging', 'battery charging light'],
  'charge-fee': ['receipt payment cash', 'service fee invoice', 'price tag cost'],
  'apple-fruit': ['fresh apple orchard', 'red apple close up', 'green apple fruit'],
  'apple-company': ['iphone smartphone apple', 'apple store technology', 'apple laptop device'],
  'giveup-quit': ['surrendering white flag', 'person quitting walking away', 'giving up hands raised'],
  'idiom-rare': ['once in a lifetime moment', 'rare occurrence', 'surprise rare moment'],
  'spring-season': ['spring blossom tree', 'spring garden flowers', 'spring season park'],
  'spring-water': ['forest spring stream', 'fresh water spring', 'mountain spring water'],
  'match-fire': ['burning matchstick', 'match lighting flame', 'matchstick close up'],
  'match-game': ['football match stadium', 'players competition game', 'sports game crowd'],
  'seal-animal': ['seal swimming sea', 'seal colony rocks', 'seal close up'],
  'seal-stamp': ['wax seal letter', 'official stamp document', 'rubber stamp paper'],
  'bark-dog': ['dog barking outdoors', 'dog barking close up', 'angry dog barking'],
  'bark-tree': ['rough tree bark', 'tree trunk bark', 'bark texture close up'],
};

/** Small Vietnamese→English keyword lexicon for words outside the curated senses. */
const VI_EN: Array<[string, string]> = [
  ['ngan hang', 'bank'], ['bo song', 'river bank'], ['con doi', 'bat'], ['gay bong chay', 'baseball bat'],
  ['anh sang', 'light'], ['nhe', 'lightweight'], ['chay', 'running'], ['van hanh', 'operating'],
  ['xe bi hong', 'broken car'], ['suy sup', 'emotional breakdown'], ['qua tao', 'apple'], ['cong ty', 'company'],
  ['toa nha', 'building'], ['dong song', 'river'], ['con song', 'river'], ['khuc song', 'river'], ['nuoc', 'water'], ['nguoi', 'person'], ['may moc', 'machine'],
  ['nha hang', 'restaurant'], ['hoc sinh', 'student'], ['giao vien', 'teacher'], ['bac si', 'doctor'],
  ['benh vien', 'hospital'], ['truong hoc', 'school'], ['xe hoi', 'car'], ['may bay', 'airplane'],
  ['tau', 'ship'], ['xe dap', 'bicycle'], ['con meo', 'cat'], ['con cho', 'dog'], ['con chim', 'bird'],
  ['cay', 'tree'], ['bong hoa', 'flower'], ['mat troi', 'sun'], ['mat trang', 'moon'], ['bien', 'sea'],
  ['nui', 'mountain'], ['thanh pho', 'city'], ['lang', 'village'], ['cho', 'market'], ['tien', 'money'],
  ['sach', 'book'], ['but', 'pen'], ['ban', 'table'], ['ghe', 'chair'], ['cua', 'door'], ['nha', 'house'],
  ['phong', 'room'], ['bep', 'kitchen'], ['an', 'eating'], ['uong', 'drinking'], ['ngu', 'sleeping'],
  ['di', 'walking'], ['nhay', 'jumping'], ['noi', 'speaking'], ['cuoi', 'laughing'], ['khoc', 'crying'],
  ['hoc', 'studying'], ['lam viec', 'working'], ['choi', 'playing'], ['mua', 'buying'], ['doc', 'reading'],
  ['viet', 'writing'], ['nghe', 'listening'], ['nhin', 'looking'], ['mo', 'opening'], ['dong', 'closing'],
  ['bat dau', 'starting'], ['ket thuc', 'ending'], ['yeu', 'love'], ['ghet', 'hate'], ['vui', 'happy'],
  ['buon', 'sad'], ['tuc gian', 'angry'], ['met', 'tired'], ['khoe', 'healthy'], ['nhanh', 'fast'],
  ['cham', 'slow'], ['cao', 'tall'], ['thap', 'short'], ['to', 'big'], ['nho', 'small'], ['dep', 'beautiful'],
  ['xau', 'ugly'], ['nong', 'hot'], ['lanh', 'cold'], ['nang', 'sunny'], ['gio', 'wind'], ['mua', 'rain'],
  ['bien', 'sea'], ['song', 'wave'], ['nui lua', 'volcano'], ['sa mac', 'desert'], ['rung', 'forest'],
  ['ho', 'lake'], ['cau', 'bridge'], ['duong', 'road'], ['pho', 'street'], ['cua hang', 'shop'],
  ['thi truong', 'market'], ['van phong', 'office'], ['cong viec', 'job'], ['du an', 'project'],
  ['su kien', 'event'], ['buoi hop', 'meeting'], ['hop dong', 'contract'], ['luat', 'law'],
  ['toa an', 'court'], ['canh sat', 'police'], ['toi pham', 'criminal'], ['nan nhan', 'victim'],
  ['chinh tri', 'politics'], ['kinh te', 'economy'], ['giao duc', 'education'], ['suc khoe', 'health'],
  ['the thao', 'sports'], ['am nhac', 'music'], ['nghe thuat', 'art'], ['cong nghe', 'technology'],
  ['khoa hoc', 'science'], ['lich su', 'history'], ['van hoa', 'culture'], ['ton giao', 'religion'],
  ['thoi tiet', 'weather'], ['khi hau', 'climate'], ['moi truong', 'environment'], ['nang luong', 'energy'],
  ['dien', 'electricity'], ['pin', 'battery'], ['may tinh', 'computer'], ['dien thoai', 'phone'],
  ['internet', 'internet'], ['du lieu', 'data'], ['phan mem', 'software'], ['mang', 'network'],
  ['an toan', 'safety'], ['nguy hiem', 'danger'], ['khan cap', 'emergency'], ['benh', 'disease'],
  ['thuoc', 'medicine'], ['dieu tri', 'treatment'], ['phau thuat', 'surgery'], ['tai nan', 'accident'],
  ['chay', 'fire'], ['lu lut', 'flood'], ['dong dat', 'earthquake'], ['bao', 'storm'], ['chien tranh', 'war'],
  ['hoa binh', 'peace'], ['tu do', 'freedom'], ['cong bang', 'justice'], ['binh dang', 'equality'],
  ['tinh yeu', 'love'], ['tinh ban', 'friendship'], ['gia dinh', 'family'], ['tre em', 'child'],
  ['phu nu', 'woman'], ['dan ong', 'man'], ['nguoi gia', 'elderly'], ['co gai', 'girl'], ['co dau', 'bride'],
];

/** Longest phrases first so "bờ sông" is not split into unrelated single words. */
const VI_EN_SORTED = [...VI_EN].sort((left, right) => right[0].length - left[0].length);

function translateVietnamese(meaning: string): string[] {
  const normalized = normalizeText(meaning);
  if (!normalized) return [];
  const terms: string[] = [];
  let remaining = ` ${normalized} `;
  for (const [vi, en] of VI_EN_SORTED) {
    const needle = ` ${vi} `;
    if (!remaining.includes(needle)) continue;
    terms.push(en);
    remaining = remaining.split(needle).join(' ');
    if (terms.length >= 3) break;
  }
  return [...new Set(terms)];
}

function pickMeanings(card: SemanticCard): { vi: string; en: string } {
  const back = (card.back ?? '').trim();
  const translation = (card.translation ?? '').trim();
  const backVi = looksVietnamese(back);
  const translationVi = looksVietnamese(translation);
  if (translationVi && translation) return { vi: translation, en: backVi ? '' : back };
  if (backVi && back) return { vi: back, en: '' };
  return { vi: '', en: back || translation };
}

function inferPartOfSpeech(term: string, meaningVi: string, meaningEn: string, example: string): PartOfSpeech {
  if (term.split(' ').length >= 3) return 'idiom';
  if (term.split(' ').length === 2) return 'phrase';
  if (/^to\s+/i.test(meaningEn)) return 'verb';
  if (/^(a|an)\s+/i.test(meaningEn)) return 'noun';
  if (/\b(adjective|adj)\b/i.test(meaningEn) || /^having\s+/i.test(meaningEn) || /\bable to\b/i.test(meaningEn)) return 'adjective';
  if (/^in a .+ way$/i.test(meaningEn)) return 'adverb';
  const vi = normalizeText(meaningVi);
  if (/^(su|viec|cai|con|nguoi|nhung|cuoc|chiec|niem|noi|khai niem)\b/.test(vi)) return 'noun';
  if (/^(rat|qua|kha|hoi)\b/.test(vi)) return 'adjective';
  if (/\b(dang|da|bi|se)\b/.test(vi)) return 'verb';
  if (/\b(sat|is|are|was|were)\b/.test(normalizeText(example))) return 'unknown';
  return 'unknown';
}

function matchSense(term: string, meaningVi: string, meaningEn: string, example: string): SenseEntry | null {
  const entries = SENSES[term];
  if (!entries?.length) return null;
  const vi = normalizeText(meaningVi);
  const en = normalizeText(meaningEn);
  const ex = normalizeText(example);
  const scored = entries.map(entry => {
    let score = 0;
    for (const pattern of entry.match) {
      const normalized = normalizeText(pattern);
      if (!normalized) continue;
      if (vi.includes(normalized)) score = Math.max(score, 100 + normalized.length);
      else if (en.includes(normalized)) score = Math.max(score, 50 + normalized.length);
      else if (!vi && !en && ex.includes(normalized)) score = Math.max(score, 20 + normalized.length);
    }
    return { entry, score };
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score);
  return scored[0]?.entry ?? null;
}

/** English→English synonyms used only when the normal queries found nothing. */
const SYNONYMS: Record<string, string[]> = {
  fast: ['quick', 'rapid', 'speedy'], quick: ['fast'], slow: ['sluggish'], big: ['large'], small: ['tiny', 'little'],
  happy: ['joyful', 'cheerful'], sad: ['unhappy', 'sorrowful'], beautiful: ['pretty', 'gorgeous'], ugly: ['unattractive'],
  smart: ['clever', 'intelligent'], angry: ['mad', 'furious'], scared: ['afraid', 'frightened'], tired: ['exhausted', 'sleepy'],
  hungry: ['starving'], rich: ['wealthy'], poor: ['penniless'], easy: ['simple'], hard: ['difficult'], strong: ['powerful'],
  weak: ['feeble'], buy: ['purchase', 'shopping'], sell: ['selling', 'vendor'], swim: ['swimming', 'swimmer'], run: ['running', 'runner'],
  eat: ['eating', 'meal'], drink: ['drinking', 'beverage'], sleep: ['sleeping', 'bed'], walk: ['walking', 'stroll'],
  speak: ['speaking', 'talk'], write: ['writing', 'pen'], read: ['reading', 'book'], sing: ['singing', 'singer'],
  dance: ['dancing', 'dancer'], teacher: ['teaching', 'classroom'], doctor: ['medical', 'hospital'], house: ['home', 'building'],
  car: ['automobile', 'vehicle'], airplane: ['plane', 'aircraft'], river: ['stream', 'waterway'], mountain: ['peak', 'summit'],
  tree: ['forest', 'plant'], book: ['reading', 'library'], apple: ['fruit'], dog: ['puppy'], cat: ['kitten'],
  love: ['romance', 'heart'], freedom: ['liberty'], justice: ['law', 'court'], success: ['achievement', 'trophy'],
  office: ['workplace'], job: ['work'], money: ['cash'], food: ['meal'], water: ['liquid'],
  music: ['song'], game: ['sport'], phone: ['smartphone'], computer: ['laptop'], travel: ['journey'], health: ['healthy'],
};

function dedupeQueries(queries: Array<string | null | undefined>, max = 5): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const query of queries) {
    const normalized = normalizeQuery(query ?? '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= max) break;
  }
  return result;
}

function normalizePartOfSpeech(value?: string | null): PartOfSpeech | null {
  const normalized = normalizeText(value ?? '').trim();
  if (!normalized) return null;
  if (/\b(idiom|thanh ngu)\b/.test(normalized)) return 'idiom';
  if (/\b(phrasal|phrase|cum dong tu)\b/.test(normalized)) return 'phrase';
  if (/\b(adverb|adv|trang tu)\b/.test(normalized)) return 'adverb';
  if (/\b(adjective|adj|tinh tu)\b/.test(normalized)) return 'adjective';
  if (/\b(verb|v|dong tu)\b/.test(normalized)) return 'verb';
  if (/\b(noun|n|danh tu)\b/.test(normalized)) return 'noun';
  return null;
}

/**
 * Resolves a card to an ordered list of English queries. Vietnamese meaning wins;
 * the example only adds disambiguating context; the bare headword is a last resort
 * with low confidence (the job refuses to auto-attach it).
 */
export function resolveImageSense(card: SemanticCard): SenseResolution {
  const term = normalizeTerm(card.front ?? '').slice(0, 80);
  const { vi: meaningVi, en: meaningEn } = pickMeanings(card);
  const example = (card.example ?? '').trim();
  const notes = (card.notes ?? '').trim();
  const contextText = `${example} ${notes}`.trim();
  const providedPos = normalizePartOfSpeech(card.partOfSpeech);
  const sense = matchSense(term, meaningVi, meaningEn, contextText);
  if (sense) {
    const contextTerms = contentWords(contextText, 4).filter(token => !sense.required.includes(token) && token !== term.split(' ')[0]).slice(0, 2);
    const variants = sense.variants ?? SENSE_VARIANTS[sense.id] ?? [];
    const queries = dedupeQueries([sense.query, ...variants, contextTerms.length ? `${sense.query} ${contextTerms.join(' ')}` : null]);
    const confidence = meaningVi ? 0.95 : (meaningEn ? 0.85 : 0.8);
    return {
      term,
      meaningVi,
      meaningEn,
      senseKey: `${term}|${normalizeText(meaningVi)}|${sense.id}`,
      partOfSpeech: sense.partOfSpeech,
      concept: sense.concept,
      queries,
      requiredTerms: sense.required,
      contextTerms,
      confidence,
      source: 'sense-lexicon',
    };
  }

  const translated = translateVietnamese(meaningVi);
  const contextTerms = contentWords(contextText, 4).filter(token => !translated.join(' ').includes(token) && token !== term.split(' ')[0]).slice(0, 2);
  const inferredPos = providedPos ?? inferPartOfSpeech(term, meaningVi, meaningEn, contextText);
  const posVariants = (core: string): string[] => inferredPos === 'verb' ? [`${core} action`] : inferredPos === 'adjective' ? [`${core} concept`] : [];
  if (translated.length) {
    const core = translated.join(' ');
    return {
      term,
      meaningVi,
      meaningEn,
      senseKey: `${term}|${normalizeText(meaningVi)}|translation`,
      partOfSpeech: inferredPos,
      concept: meaningVi,
      queries: dedupeQueries([core, contextTerms.length ? `${core} ${contextTerms.join(' ')}` : null, ...posVariants(core)]),
      requiredTerms: [...new Set(translated)].slice(0, 4),
      contextTerms,
      confidence: 0.75,
      source: 'translation-lexicon',
    };
  }

  const definitionTerms = contentWords(meaningEn, 3);
  if (definitionTerms.length) {
    const core = definitionTerms.join(' ');
    return {
      term,
      meaningVi,
      meaningEn,
      senseKey: `${term}|${normalizeText(meaningEn)}|definition`,
      partOfSpeech: inferredPos,
      concept: meaningEn,
      queries: dedupeQueries([core, contextTerms.length ? `${core} ${contextTerms.join(' ')}` : null, ...posVariants(core)]),
      requiredTerms: [...new Set(definitionTerms)].slice(0, 4),
      contextTerms,
      confidence: 0.65,
      source: 'definition',
    };
  }

  const exampleTerms = contentWords(contextText, 3).filter(token => token !== term.split(' ')[0]);
  if (exampleTerms.length) {
    return {
      term,
      meaningVi,
      meaningEn,
      senseKey: `${term}|example`,
      partOfSpeech: inferredPos,
      concept: contextText,
      queries: dedupeQueries([`${exampleTerms.slice(0, 2).join(' ')} ${term}`.trim()]),
      requiredTerms: [...new Set([...exampleTerms, term])].slice(0, 3),
      contextTerms: exampleTerms,
      confidence: 0.5,
      source: 'example-context',
    };
  }

  // Last resort: the bare headword. Confidence is deliberately low so the job
  // reports "not found" instead of attaching an arbitrary image.
  return {
    term,
    meaningVi,
    meaningEn,
    senseKey: `${term}|front`,
    partOfSpeech: inferredPos,
    concept: card.front,
    queries: term ? [term] : [],
    requiredTerms: term ? [term] : [],
    contextTerms: [],
    confidence: 0.25,
    source: 'front-fallback',
  };
}

/**
 * Retry-time query expansion: the normal sense queries plus English synonyms,
 * the Vietnamese meaning translated into English, the definition, and the
 * example context. Used by the automatic retry worker and explicit "find more"
 * actions, never as the first pass (so the primary meaning-query stays dominant).
 */
export function expandImageQueries(card: SemanticCard, sense: SenseResolution): string[] {
  const translated = translateVietnamese(sense.meaningVi);
  const roots = [sense.term, ...translated];
  const synonyms = [...new Set(roots.flatMap(root => SYNONYMS[root] ?? []))];
  const definition = contentWords(sense.meaningEn, 3);
  const example = contentWords(`${card.example ?? ''} ${card.notes ?? ''}`, 3);
  const extras: Array<string | null | undefined> = [
    ...synonyms,
    ...synonyms.map(synonym => definition[0] ? `${synonym} ${definition[0]}` : null),
    definition.length ? definition.join(' ') : null,
    example.length ? example.join(' ') : null,
  ];
  return dedupeQueries([...sense.queries, ...extras], 10);
}

