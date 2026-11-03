import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseApkg } from './apkg.js';
import { parseCsvFile } from './csv-import.js';
import { contentLengthExceeds, receiveToTempFile, UploadLimitError } from './upload-stream.js';
import { APKG_MAX_BYTES, UPLOAD_LIMITS } from './config.js';

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipInput { name: string; data: Buffer; method?: 0 | 8; compressedSize?: number; expandedSize?: number }

/** Minimal ZIP writer with overridable sizes for zip-bomb tests. */
function buildZip(entries: ZipInput[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 0;
    const body = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const compressed = entry.compressedSize ?? body.length;
    const expanded = entry.expandedSize ?? entry.data.length;
    const name = Buffer.from(entry.name);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(compressed, 18);
    local.writeUInt32LE(expanded, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    parts.push(local, body);
    const entryCentral = Buffer.alloc(46 + name.length);
    entryCentral.writeUInt32LE(0x02014b50, 0);
    entryCentral.writeUInt16LE(20, 4);
    entryCentral.writeUInt16LE(20, 6);
    entryCentral.writeUInt16LE(method, 10);
    entryCentral.writeUInt32LE(crc32(entry.data), 16);
    entryCentral.writeUInt32LE(compressed, 20);
    entryCentral.writeUInt32LE(expanded, 24);
    entryCentral.writeUInt16LE(name.length, 28);
    entryCentral.writeUInt32LE(offset, 42);
    name.copy(entryCentral, 46);
    central.push(entryCentral);
    offset += local.length + body.length;
  }
  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuffer, eocd]);
}

async function buildApkg(): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'vocabup-test-apkg-'));
  const path = join(dir, 'collection.anki2');
  try {
    const db = new DatabaseSync(path);
    try {
      db.exec('CREATE TABLE col (crt INTEGER, models TEXT); CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT); CREATE TABLE cards (id INTEGER, nid INTEGER, queue INTEGER, type INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER);');
      db.prepare('INSERT INTO col (crt, models) VALUES (?, ?)').run(1_700_000_000, JSON.stringify({ '1': { flds: [{ name: 'Front' }, { name: 'Back' }] } }));
      db.prepare('INSERT INTO notes (id, mid, flds) VALUES (?, ?, ?)').run(1, 1, 'Apple\u001fA fruit');
      db.prepare('INSERT INTO cards (id, nid, queue, type, due, ivl, factor, reps) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(1, 1, 0, 0, 1, 0, 0, 0);
    } finally { db.close(); }
    const sqlite = await readFile(path);
    return buildZip([{ name: 'collection.anki2', data: sqlite }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('upload limits configuration', () => {
  it('uses independent defaults for each file type', () => {
    expect(UPLOAD_LIMITS).toEqual({ apkgMaxMB: 200, csvMaxMB: 50, imageMaxMB: 5 });
    expect(APKG_MAX_BYTES).toBe(200 * 1024 * 1024);
  });

  it('detects an oversized Content-Length before reading the body', () => {
    expect(contentLengthExceeds({ headers: { 'content-length': String(201 * 1024 * 1024) } } as never, APKG_MAX_BYTES)).toBe(true);
    expect(contentLengthExceeds({ headers: { 'content-length': '1024' } } as never, APKG_MAX_BYTES)).toBe(false);
    expect(contentLengthExceeds({ headers: {} } as never, APKG_MAX_BYTES)).toBe(false);
  });
});

describe('streamed upload guard', () => {
  it('aborts a body that exceeds the cap and removes its temp file', async () => {
    const base = await mkdtemp(join(tmpdir(), 'vocabup-upload-test-'));
    try {
      const req = Readable.from([Buffer.alloc(600 * 1024), Buffer.alloc(600 * 1024)]) as never;
      await expect(receiveToTempFile(req, { maxBytes: 1024 * 1024, kind: 'APKG', limitMB: 1, extension: 'apkg', tempDir: base })).rejects.toBeInstanceOf(UploadLimitError);
      expect(await readdir(base)).toEqual([]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe('APKG file parsing', () => {
  it('streams a valid APKG from disk and reads its notes', async () => {
    const apkg = await buildApkg();
    const result = await parseApkg(apkg);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.front).toBe('Apple');
    expect(result.cards[0]?.back).toBe('A fruit');
  });

  it('rejects a non-ZIP payload and a configured archive cap', async () => {
    await expect(parseApkg(Buffer.from('this is not a zip file'))).rejects.toThrow(/APKG\/ZIP hợp lệ/);
    const apkg = await buildApkg();
    await expect(parseApkg(apkg, { maxArchiveBytes: 512 })).rejects.toThrow(/vượt quá giới hạn/);
  });

  it('rejects a zip bomb by compression ratio before inflating it', async () => {
    const bomb = buildZip([{ name: 'collection.anki2', data: Buffer.alloc(1024 * 1024), method: 8, compressedSize: 1024 * 1024, expandedSize: 300 * 1024 * 1024 }]);
    await expect(parseApkg(bomb, { maxDatabaseBytes: 400 * 1024 * 1024 })).rejects.toThrow(/tỷ lệ nén bất thường/);
  });
});

describe('CSV file parsing', () => {
  it('streams a CSV from disk into preview cards', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vocabup-csv-test-'));
    try {
      const path = join(dir, 'deck.csv');
      await writeFile(path, 'front,back,translation\nHello,xin chào,Chào\nWorld,thế giới,Thế giới\n');
      const cards = await parseCsvFile(path);
      expect(cards.map(card => card.front)).toEqual(['Hello', 'World']);
      expect(cards[0]?.translation).toBe('Chào');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects binary payloads and the configured row cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vocabup-csv-test-'));
    try {
      const binary = join(dir, 'binary.csv');
      await writeFile(binary, Buffer.from([0x00, 0x01, 0x02, 0x03]));
      await expect(parseCsvFile(binary)).rejects.toThrow(/CSV văn bản/);
      const many = join(dir, 'many.csv');
      await writeFile(many, 'front,back\na,1\nb,2\nc,3\n');
      await expect(parseCsvFile(many, { maxCards: 2 })).rejects.toThrow(/giới hạn 2 từ/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
