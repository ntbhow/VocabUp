import { describe, expect, it } from 'vitest';
import { expandImageQueries, looksVietnamese, resolveImageSense, type SemanticCard } from './image-semantics.js';

interface Case {
  name: string;
  card: SemanticCard;
  query: string;
  partOfSpeech: string;
  required: string[];
  forbidden?: string;
}

const CASES: Case[] = [
  { name: 'Bank – Ngân hàng', card: { front: 'Bank', translation: 'Ngân hàng', example: 'I need to go to the bank to deposit money.' }, query: 'bank building finance money', partOfSpeech: 'noun', required: ['bank', 'money'], forbidden: 'river' },
  { name: 'Bank – Bờ sông', card: { front: 'Bank', translation: 'Bờ sông', example: 'He sat on the river bank.' }, query: 'river bank landscape water', partOfSpeech: 'noun', required: ['river', 'bank'], forbidden: 'finance' },
  { name: 'Bat – Con dơi', card: { front: 'Bat', translation: 'Con dơi', example: 'A bat flew out of the cave.' }, query: 'bat animal flying night', partOfSpeech: 'noun', required: ['bat', 'animal'], forbidden: 'baseball' },
  { name: 'Bat – Gậy bóng chày', card: { front: 'Bat', translation: 'Gậy bóng chày', example: 'He swung the baseball bat.' }, query: 'baseball bat player sport', partOfSpeech: 'noun', required: ['baseball', 'bat'], forbidden: 'animal' },
  { name: 'Light – Ánh sáng', card: { front: 'Light', translation: 'Ánh sáng', example: 'The light from the lamp filled the room.' }, query: 'light bulb illumination bright', partOfSpeech: 'noun', required: ['light', 'bulb'], forbidden: 'lightweight' },
  { name: 'Light – Nhẹ', card: { front: 'Light', translation: 'Nhẹ', example: 'The bag is very light.' }, query: 'lightweight feather balance', partOfSpeech: 'adjective', required: ['lightweight', 'feather'], forbidden: 'bulb' },
  { name: 'Run – Chạy', card: { front: 'Run', translation: 'Chạy', example: 'She likes to run in the park.' }, query: 'person running action sport', partOfSpeech: 'verb', required: ['running', 'person'], forbidden: 'machine' },
  { name: 'Run – Vận hành', card: { front: 'Run', translation: 'Vận hành', example: 'The machine runs smoothly.' }, query: 'machine operating factory engine', partOfSpeech: 'verb', required: ['machine', 'operating'], forbidden: 'person' },
  { name: 'Break down – Xe bị hỏng', card: { front: 'Break down', translation: 'Xe bị hỏng', example: 'The car broke down on the highway.' }, query: 'broken car roadside breakdown', partOfSpeech: 'phrase', required: ['broken', 'car'], forbidden: 'emotional' },
  { name: 'Break down – Suy sụp tinh thần', card: { front: 'Break down', translation: 'Suy sụp tinh thần', example: 'She broke down after the bad news.' }, query: 'emotional breakdown stress crying', partOfSpeech: 'phrase', required: ['emotional', 'breakdown'], forbidden: 'car' },
];

describe('semantic image sense resolution', () => {
  for (const item of CASES) {
    it(`resolves ${item.name} to a meaning-specific query`, () => {
      const sense = resolveImageSense(item.card);
      expect(sense.source).toBe('sense-lexicon');
      expect(sense.queries[0]).toBe(item.query);
      expect(sense.partOfSpeech).toBe(item.partOfSpeech);
      expect(sense.confidence).toBeGreaterThanOrEqual(0.9);
      for (const term of item.required) expect(sense.requiredTerms).toContain(term);
      if (item.forbidden) expect(sense.queries.join(' ')).not.toContain(item.forbidden);
    });
  }

  it('gives different queries to the same headword with different Vietnamese meanings', () => {
    const groups: SemanticCard[][] = [
      [{ front: 'Bank', translation: 'Ngân hàng' }, { front: 'Bank', translation: 'Bờ sông' }],
      [{ front: 'Bat', translation: 'Con dơi' }, { front: 'Bat', translation: 'Gậy bóng chày' }],
      [{ front: 'Light', translation: 'Ánh sáng' }, { front: 'Light', translation: 'Nhẹ' }],
      [{ front: 'Run', translation: 'Chạy' }, { front: 'Run', translation: 'Vận hành' }],
      [{ front: 'Break down', translation: 'Xe bị hỏng' }, { front: 'Break down', translation: 'Suy sụp tinh thần' }],
    ];
    for (const [first, second] of groups) {
      const left = first!;
      const right = second!;
      expect(resolveImageSense(left).queries[0]).not.toBe(resolveImageSense(right).queries[0]);
      expect(resolveImageSense(left).senseKey).not.toBe(resolveImageSense(right).senseKey);
    }
  });

  it('lets the Vietnamese meaning win over a contradictory example', () => {
    const sense = resolveImageSense({ front: 'Bank', translation: 'Ngân hàng', example: 'He sat on the river bank.' });
    expect(sense.queries[0]).toContain('finance');
    expect(sense.queries[0]).not.toContain('river');
  });

  it('uses the example when the meaning is missing, but keeps the sense', () => {
    const sense = resolveImageSense({ front: 'Bank', example: 'He sat on the river bank.' });
    expect(sense.source).toBe('sense-lexicon');
    expect(sense.queries[0]).toBe('river bank landscape water');
    expect(sense.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('keeps the whole phrasal verb / idiom instead of splitting it', () => {
    const phrasal = resolveImageSense({ front: 'Give up', translation: 'Từ bỏ' });
    expect(phrasal.partOfSpeech).toBe('phrase');
    expect(phrasal.queries[0]).toBe('person giving up quit goal');
    const idiom = resolveImageSense({ front: 'Once in a blue moon', translation: 'Rất hiếm khi' });
    expect(idiom.partOfSpeech).toBe('idiom');
    expect(idiom.queries[0]).toBe('rare event surprise');
    expect(idiom.queries.join(' ')).not.toContain('moon');
  });

  it('detects Vietnamese meanings with and without diacritics', () => {
    expect(looksVietnamese('Bờ sông')).toBe(true);
    expect(looksVietnamese('Ngân hàng')).toBe(true);
    expect(looksVietnamese('ngan hang')).toBe(true);
    expect(looksVietnamese('river bank')).toBe(false);
    expect(looksVietnamese('financial institution')).toBe(false);
  });

  it('refuses to auto-attach a bare English headword', () => {
    const sense = resolveImageSense({ front: 'Serendipity' });
    expect(sense.source).toBe('front-fallback');
    expect(sense.confidence).toBeLessThan(0.5);
    expect(sense.queries).toEqual(['serendipity']);
  });

  it('translates a known Vietnamese meaning for a word outside the sense lexicon', () => {
    const sense = resolveImageSense({ front: 'Teacher', translation: 'Giáo viên' });
    expect(sense.source).toBe('translation-lexicon');
    expect(sense.queries[0]).toBe('teacher');
    expect(sense.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('adds example context to the secondary query', () => {
    const sense = resolveImageSense({ front: 'Bank', translation: 'Bờ sông', example: 'The boat moved along the river bank.' });
    expect(sense.queries[0]).toBe('river bank landscape water');
    expect(sense.queries.length).toBeGreaterThan(1);
    expect(sense.queries.some(query => query.includes('boat'))).toBe(true);
  });

  it('offers several phrasings for a polysemous sense, not just the first query', () => {
    const sense = resolveImageSense({ front: 'Bank', translation: 'Bờ sông' });
    expect(sense.queries.length).toBeGreaterThanOrEqual(4);
    expect(sense.queries).toContain('river shoreline');
    expect(sense.queries).toContain('grassy riverbank');
  });

  it('uses notes as extra context for the query', () => {
    const sense = resolveImageSense({ front: 'Bank', translation: 'Bờ sông', notes: 'The muddy bank was slippery.' });
    expect(sense.queries.some(query => query.includes('muddy'))).toBe(true);
  });

  it('accepts an explicit part of speech when the meaning is not in the lexicon', () => {
    const sense = resolveImageSense({ front: 'Serendipity', translation: 'Sự tình cờ', partOfSpeech: 'noun' });
    expect(sense.partOfSpeech).toBe('noun');
  });

  it('translates "con sông" as river, not the unaccented homograph wave', () => {
    const sense = resolveImageSense({ front: 'River', translation: 'Con sông' });
    expect(sense.queries[0]).toBe('river landscape water');
    expect(sense.queries.join(' ')).not.toContain('wave');
  });

  it('keeps the example context separate from the required core for generic words', () => {
    const sense = resolveImageSense({ front: 'Dog', translation: 'Con chó', example: 'The dog wagged its tail.' });
    expect(sense.source).toBe('translation-lexicon');
    expect(sense.requiredTerms).toEqual(['dog']);
    expect(sense.contextTerms).toContain('tail');
    expect(sense.queries[0]).toBe('dog');
  });

  it('matches common curated words through their Vietnamese meaning', () => {
    const cases: Array<[SemanticCard, string]> = [
      [{ front: 'Sing', translation: 'Hát' }, 'person singing microphone'],
      [{ front: 'Eat', translation: 'Ăn' }, 'person eating food'],
      [{ front: 'Buy', translation: 'Mua' }, 'person shopping buying'],
      [{ front: 'Heavy', translation: 'Nặng' }, 'heavy box lifting'],
      [{ front: 'Turn on', translation: 'Bật' }, 'hand switching light switch'],
      [{ front: 'Slow', translation: 'Chậm' }, 'slow turtle'],
      [{ front: 'House', translation: 'Ngôi nhà' }, 'house home exterior'],
      [{ front: 'River', translation: 'Con sông' }, 'river landscape water'],
    ];
    for (const [card, query] of cases) {
      const sense = resolveImageSense(card);
      expect(sense.source).toBe('sense-lexicon');
      expect(sense.queries[0]).toBe(query);
    }
  });

  it('expands retry queries with synonyms, the definition and the example', () => {
    const card: SemanticCard = { front: 'Buy', back: 'to get something by paying money', translation: 'Mua', example: 'They buy fresh fruit at the market.' };
    const sense = resolveImageSense(card);
    const queries = expandImageQueries(card, sense);
    expect(queries.length).toBeGreaterThan(sense.queries.length);
    expect(queries).toContain('purchase');
    expect(queries.some(query => query.includes('fresh fruit'))).toBe(true);
  });

  it('adds synonyms for common retry words such as Fast and Swim', () => {
    const cases: Array<[SemanticCard, string]> = [
      [{ front: 'Fast', translation: 'Nhanh' }, 'quick'],
      [{ front: 'Swim', translation: 'Bơi' }, 'swimming'],
      [{ front: 'Happy', translation: 'Vui vẻ' }, 'joyful'],
    ];
    for (const [card, expected] of cases) {
      const sense = resolveImageSense(card);
      const queries = expandImageQueries(card, sense);
      expect(queries).toContain(expected);
    }
  });
});
