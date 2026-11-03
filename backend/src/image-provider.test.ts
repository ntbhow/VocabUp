import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({ pool: { execute: vi.fn().mockResolvedValue([[]]), query: vi.fn() } }));

import {
  imageProviderStatus,
  normalizeQuery,
  parseFlickrPayload,
  parseOpenversePayload,
  parsePexelsPayload,
  parsePixabayPayload,
  parseUnsplashPayload,
  parseWikimediaPayload,
  pickBestCandidate,
  rankCandidates,
  type ImageCandidate,
} from './image-provider.js';

function candidate(overrides: Partial<ImageCandidate>): ImageCandidate {
  return {
    provider: 'pixabay',
    url: 'https://cdn.pixabay.com/photo.jpg',
    thumbnailUrl: 'https://cdn.pixabay.com/photo-thumb.jpg',
    width: 1600,
    height: 1000,
    author: null,
    sourceUrl: null,
    tags: [],
    ...overrides,
  };
}

describe('query normalization', () => {
  it('normalises cache keys', () => {
    expect(normalizeQuery('  Apple   Pie ')).toBe('apple pie');
  });
});

describe('provider status', () => {
  const keyNames = ['PIXABAY_API_KEY', 'UNSPLASH_ACCESS_KEY', 'PEXELS_API_KEY', 'FLICKR_API_KEY', 'IMAGE_DISABLE_WIKIMEDIA', 'IMAGE_DISABLE_OPENVERSE', 'IMAGE_PROVIDERS'] as const;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    saved.clear();
    for (const key of keyNames) { saved.set(key, process.env[key]); delete process.env[key]; }
    process.env.IMAGE_DISABLE_WIKIMEDIA = '1';
    process.env.IMAGE_DISABLE_OPENVERSE = '1';
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    saved.clear();
  });

  it('reports unconfigured without a key and prefers Pixabay when both exist', () => {
    expect(imageProviderStatus()).toEqual({ configured: false, provider: null, providers: [] });
    process.env.UNSPLASH_ACCESS_KEY = 'unsplash-key';
    expect(imageProviderStatus()).toEqual({ configured: true, provider: 'unsplash', providers: ['unsplash'] });
    process.env.PIXABAY_API_KEY = 'pixabay-key';
    expect(imageProviderStatus()).toEqual({ configured: true, provider: 'pixabay', providers: ['pixabay', 'unsplash'] });
  });

  it('never enables providers other than Pixabay and Unsplash', () => {
    expect(imageProviderStatus().configured).toBe(false);
    process.env.IMAGE_PROVIDERS = 'wikimedia,openverse,pexels,flickr';
    expect(imageProviderStatus().providers).toEqual([]);
    delete process.env.IMAGE_PROVIDERS;
  });
});

describe('relevance ranking', () => {
  it('ranks an image whose tags match the word above a random result', () => {
    const ranked = rankCandidates([
      candidate({ url: 'https://cdn.pixabay.com/phone.jpg', tags: ['phone', 'technology'] }),
      candidate({ url: 'https://cdn.pixabay.com/apple.jpg', tags: ['apple', 'fruit', 'red'] }),
    ], 'apple');
    expect(ranked[0]?.url).toContain('apple.jpg');
    expect(pickBestCandidate(ranked, { requireOverlap: true })?.url).toContain('apple.jpg');
  });

  it('rejects every candidate when no tag matches an English query', () => {
    const ranked = rankCandidates([candidate({ tags: ['phone', 'technology'] })], 'apple');
    expect(pickBestCandidate(ranked, { requireOverlap: true })).toBeNull();
  });

  it('matches simple inflections such as abandon → abandoned', () => {
    const ranked = rankCandidates([candidate({ tags: ['abandoned', 'building'] })], 'abandon');
    expect(ranked[0]?.overlap).toBeGreaterThan(0);
    expect(pickBestCandidate(ranked, { requireOverlap: true })).not.toBeNull();
  });
});

describe('provider payload parsing', () => {
  it('normalises Pixabay hits and drops unsafe or oversized URLs', () => {
    const parsed = parsePixabayPayload({
      hits: [
        { largeImageURL: 'https://cdn.pixabay.com/apple.jpg', previewURL: 'https://cdn.pixabay.com/apple-t.jpg', imageWidth: 1200, imageHeight: 800, user: 'Ana', pageURL: 'https://pixabay.com/photos/apple-1/', tags: 'apple, fruit' },
        { largeImageURL: 'javascript:alert(1)', previewURL: 'https://cdn.pixabay.com/x.jpg', imageWidth: 10, imageHeight: 10 },
        { largeImageURL: `https://cdn.pixabay.com/${'x'.repeat(2100)}.jpg`, imageWidth: 10, imageHeight: 10 },
        { largeImageURL: 'http://127.0.0.1:5180/local.png', previewURL: 'http://127.0.0.1:5180/local.png', imageWidth: 800, imageHeight: 600 },
      ],
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ provider: 'pixabay', author: 'Ana', width: 1200, height: 800 });
    expect(parsed[0]?.tags).toEqual(['apple', 'fruit']);
    expect(parsed[1]?.url).toBe('http://127.0.0.1:5180/local.png');
  });

  it('normalises Unsplash results including attribution', () => {
    const parsed = parseUnsplashPayload({
      results: [
        { urls: { regular: 'https://images.unsplash.com/photo-1.jpg', small: 'https://images.unsplash.com/photo-1-s.jpg' }, links: { html: 'https://unsplash.com/photos/1' }, user: { name: 'Binh' }, alt_description: 'a red apple on a table', width: 4000, height: 3000 },
        { urls: { regular: 'data:image/png;base64,abc' }, user: {} },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ provider: 'unsplash', author: 'Binh', sourceUrl: 'https://unsplash.com/photos/1' });
    expect(parsed[0]?.tags).toContain('apple');
  });

  it('returns an empty list for malformed payloads', () => {
    expect(parsePixabayPayload(null)).toEqual([]);
    expect(parsePixabayPayload({ hits: 'nope' })).toEqual([]);
    expect(parseUnsplashPayload({ results: [{ urls: {} }] })).toEqual([]);
  });

  it('normalises Pexels results with the Pexels licence', () => {
    const parsed = parsePexelsPayload({
      photos: [{ id: 1, width: 1200, height: 800, url: 'https://www.pexels.com/photo/1/', photographer: 'Chi', alt: 'red apple on a table', src: { large2x: 'https://images.pexels.com/1.jpg', medium: 'https://images.pexels.com/1-m.jpg' } }],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ provider: 'pexels', author: 'Chi', width: 1200, height: 800, license: 'Pexels License' });
    expect(parsed[0]?.tags).toEqual(['red', 'apple', 'on', 'a', 'table']);
  });

  it('normalises Wikimedia Commons results with the per-file licence and attribution', () => {
    const parsed = parseWikimediaPayload({
      query: { pages: { 1: { title: 'File:River bank.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://upload.wikimedia.org/river.jpg', thumbwidth: 1200, thumbheight: 800, descriptionurl: 'https://commons.wikimedia.org/wiki/File:River_bank.jpg', extmetadata: { Artist: { value: '<a href="#">An</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' }, ImageDescription: { value: 'A river bank at sunset' } } }] } } },
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ provider: 'wikimedia', author: 'An', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' });
    expect(parsed[0]?.tags).toContain('river');
    expect(parsed[0]?.sourceUrl).toContain('commons.wikimedia.org');
  });

  it('normalises Openverse results with a CC label', () => {
    const parsed = parseOpenversePayload({
      results: [{ url: 'https://live.staticflickr.com/1.jpg', thumbnail: 'https://api.openverse.org/v1/images/1/thumb/', width: 1024, height: 768, creator: 'Dung', foreign_landing_url: 'https://www.flickr.com/photos/1', license: 'by-sa', license_version: '4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/', title: 'river bank', tags: [{ name: 'river' }, { name: 'bank' }] }],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ provider: 'openverse', author: 'Dung', license: 'CC BY-SA 4.0', width: 1024, height: 768 });
    expect(parsed[0]?.tags).toContain('river');
  });

  it('normalises Flickr CC photos and drops all-rights-reserved items', () => {
    const parsed = parseFlickrPayload({
      photos: { photo: [
        { id: '1', owner: '1@N1', ownername: 'Em', url_l: 'https://live.staticflickr.com/1_b.jpg', url_m: 'https://live.staticflickr.com/1.jpg', license: '4', title: 'river bank', description: { _content: 'a river bank' }, tags: 'river bank' },
        { id: '2', owner: '2@N2', url_l: 'https://live.staticflickr.com/2_b.jpg', license: '0' },
      ] },
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ provider: 'flickr', author: 'Em', license: 'CC BY 2.0', sourceUrl: 'https://www.flickr.com/photos/1@N1/1' });
  });
});
