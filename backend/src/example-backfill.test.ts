import { describe, expect, it } from 'vitest';
import { CURATED_EXAMPLES, exampleFor, resolveHeadword, type BackfillCard } from './example-backfill.js';

const card = (front: string, back: string, translation: string | null = null): BackfillCard => ({ id: 1, front, back, translation });

describe('example backfill', () => {
  it('resolves a plain word card', () => {
    expect(resolveHeadword(card('Mango', 'a tropical fruit'))).toBe('mango');
  });

  it('resolves a reversed card whose back is "word /ipa/"', () => {
    expect(resolveHeadword(card('the solid surface of the earth\n\nMặt đất', 'ground /ɡraʊnd/'))).toBe('ground');
  });

  it('resolves a pronunciation prompt ending in the word', () => {
    expect(resolveHeadword(card('Từ này đọc thế nào?\n\nISLAND', '/ˈaɪlənd/'))).toBe('island');
    expect(resolveHeadword(card('How do you make these two words sound differently?\n\nSYLLABUS and SYLLABLE', '/ˈsɪləbəs/'))).toBe('syllabus+syllable');
  });

  it('never touches injected or junk card content', () => {
    expect(resolveHeadword(card('world', 'trái đất\n; sleep 15.0;'))).toBeNull();
    expect(resolveHeadword(card('<scrIpt>alert(1);</scRipt>', 'trái đất'))).toBeNull();
    expect(resolveHeadword(card('lemon', "eat ' UNION ALL select NULL --"))).toBeNull();
    expect(resolveHeadword(card('http://www.google.com', 'trái đất'))).toBeNull();
    expect(resolveHeadword(card('world', "c:/Windows/system.ini"))).toBeNull();
    expect(resolveHeadword(card('hello gay', 'chao gay'))).toBeNull();
  });

  it('builds an English sentence plus its Vietnamese translation', () => {
    const example = exampleFor('mango');
    expect(example).toContain(CURATED_EXAMPLES.mango!.en);
    expect(example).toContain(CURATED_EXAMPLES.mango!.vi);
    expect(exampleFor('syllabus+syllable')).toContain(CURATED_EXAMPLES.syllabus!.en);
    expect(exampleFor('syllabus+syllable')).toContain(CURATED_EXAMPLES.syllable!.vi);
  });

  it('uses the word (or its plural) in the sentence', () => {
    const stem = (word: string) => word.replace(/(es|s)$/, '');
    for (const [word, { en }] of Object.entries(CURATED_EXAMPLES)) {
      expect(en.toLowerCase(), word).toContain(stem(word.split(' ')[0]!));
    }
  });
});
