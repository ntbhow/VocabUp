import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, open, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { createInflateRaw } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  APKG_MAX_BYTES,
  APKG_MAX_COMPRESSION_RATIO,
  APKG_MAX_DATABASE_BYTES,
  APKG_MAX_ENTRIES,
  APKG_MAX_NOTES,
  UPLOAD_TMP_DIR,
} from './config.js';

export interface ApkgCard { front: string; back: string; pronunciation: string; translation: string; example: string | null; intervalDays: number; repetitions: number; easeFactor: number; dueAt: string | null }
export interface ApkgParseResult { cards: ApkgCard[]; skipped: number }

export class ApkgImportError extends Error {
  constructor(message: string) { super(message); this.name = 'ApkgImportError'; }
}

interface ApkgLimits { maxArchiveBytes: number; maxDatabaseBytes: number; maxEntries: number; maxNotes: number }
interface ZipEntry { name: string; method: number; flags: number; compressedSize: number; expandedSize: number; localOffset: number }

const decoder = new TextDecoder('utf-8', { fatal: true });

function resolveLimits(options: Partial<ApkgLimits> = {}): ApkgLimits {
  return {
    maxArchiveBytes: options.maxArchiveBytes ?? APKG_MAX_BYTES,
    maxDatabaseBytes: options.maxDatabaseBytes ?? APKG_MAX_DATABASE_BYTES,
    maxEntries: options.maxEntries ?? APKG_MAX_ENTRIES,
    maxNotes: options.maxNotes ?? APKG_MAX_NOTES,
  };
}

function limitMB(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

async function readAt(handle: FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

/** Reads only the ZIP end-of-central-directory and central directory from disk. */
async function zipEntriesFromFile(archivePath: string, limits: ApkgLimits): Promise<Map<string, ZipEntry>> {
  const info = await stat(archivePath).catch(() => null);
  if (!info || info.size === 0) throw new ApkgImportError('File APKG bị trống hoặc không hợp lệ.');
  if (info.size > limits.maxArchiveBytes) throw new ApkgImportError(`File APKG vượt quá giới hạn ${limitMB(limits.maxArchiveBytes)} MB.`);
  const handle = await open(archivePath, 'r');
  try {
    const head = await readAt(handle, 4, 0);
    if (head.length < 4 || (head.readUInt32LE(0) !== 0x04034b50 && head.readUInt32LE(0) !== 0x06054b50)) {
      throw new ApkgImportError('File không phải APKG/ZIP hợp lệ.');
    }
    const tailLength = Math.min(info.size, 65_557);
    if (tailLength < 22) throw new ApkgImportError('File APKG quá nhỏ để có cấu trúc ZIP.');
    const tail = await readAt(handle, tailLength, info.size - tailLength);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index--) {
      if (tail.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
    }
    if (eocd < 0) throw new ApkgImportError('Không tìm thấy cấu trúc ZIP hợp lệ trong file APKG.');
    const count = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (count > limits.maxEntries) throw new ApkgImportError(`APKG có quá nhiều file (tối đa ${limits.maxEntries}).`);
    if (centralOffset + centralSize > info.size || centralSize > 16 * 1024 * 1024) {
      throw new ApkgImportError('Cấu trúc ZIP không hợp lệ hoặc danh mục file quá lớn.');
    }
    const central = await readAt(handle, centralSize, centralOffset);
    const entries = new Map<string, ZipEntry>();
    let offset = 0;
    for (let index = 0; index < count; index++) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) {
        throw new ApkgImportError('Danh mục file trong APKG bị lỗi.');
      }
      const flags = central.readUInt16LE(offset + 8);
      const method = central.readUInt16LE(offset + 10);
      const compressedSize = central.readUInt32LE(offset + 20);
      const expandedSize = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32);
      const localOffset = central.readUInt32LE(offset + 42);
      if ([compressedSize, expandedSize, localOffset].includes(0xffffffff)) throw new ApkgImportError('APKG kiểu ZIP64 chưa được hỗ trợ.');
      const next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > central.length) throw new ApkgImportError('Danh mục file trong APKG bị cắt cụt.');
      const nameBytes = central.subarray(offset + 46, offset + 46 + nameLength);
      let name: string;
      try { name = flags & 0x800 ? decoder.decode(nameBytes) : nameBytes.toString('latin1'); }
      catch { throw new ApkgImportError('Tên file trong APKG không hợp lệ.'); }
      if (entries.has(name)) throw new ApkgImportError('APKG có tên file bị trùng.');
      entries.set(name, { name, method, flags, compressedSize, expandedSize, localOffset });
      offset = next;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/** Streams one ZIP entry to disk, never inflating more than the configured database cap. */
async function extractEntryToFile(archivePath: string, entry: ZipEntry, targetPath: string, limits: ApkgLimits): Promise<void> {
  if (entry.flags & 1) throw new ApkgImportError('APKG được mã hóa; hãy xuất lại mà không đặt mật khẩu.');
  if (entry.expandedSize > limits.maxDatabaseBytes) {
    throw new ApkgImportError(`Cơ sở dữ liệu trong APKG vượt giới hạn ${limitMB(limits.maxDatabaseBytes)} MB.`);
  }
  if (entry.compressedSize > 0 && entry.expandedSize / entry.compressedSize > APKG_MAX_COMPRESSION_RATIO) {
    throw new ApkgImportError('APKG có tỷ lệ nén bất thường (có thể là zip bomb).');
  }
  if (entry.method !== 0 && entry.method !== 8) throw new ApkgImportError(`APKG dùng kiểu nén không được hỗ trợ (${entry.method}).`);
  const info = await stat(archivePath);
  const handle = await open(archivePath, 'r');
  try {
    const local = await readAt(handle, 30, entry.localOffset);
    if (local.length < 30 || local.readUInt32LE(0) !== 0x04034b50) throw new ApkgImportError('Dữ liệu file trong APKG không hợp lệ.');
    const nameLength = local.readUInt16LE(26);
    const extraLength = local.readUInt16LE(28);
    const dataStart = entry.localOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataStart < 0 || dataEnd > info.size || dataEnd <= dataStart) throw new ApkgImportError('Dữ liệu file trong APKG bị cắt cụt.');

    let bytes = 0;
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > limits.maxDatabaseBytes) { callback(new ApkgImportError('Cơ sở dữ liệu trong APKG vượt giới hạn cho phép.')); return; }
        callback(null, chunk);
      },
    });
    const source = createReadStream(archivePath, { start: dataStart, end: dataEnd - 1 });
    const sink = createWriteStream(targetPath, { flags: 'wx' });
    if (entry.method === 0) await pipeline(source, sizeGuard, sink);
    else await pipeline(source, createInflateRaw(), sizeGuard, sink);
    const written = await stat(targetPath);
    if (entry.expandedSize > 0 && written.size !== entry.expandedSize) throw new ApkgImportError(`Kích thước ${entry.name} không khớp với danh mục APKG.`);
  } finally {
    await handle.close();
  }
}

/**
 * Anki's schema references a custom `unicase` collation. Replace it in place with
 * the built-in `NOCASE` in fixed-size chunks, so a 200 MB SQLite file is never
 * loaded into a single Buffer.
 */
async function replaceCollationInFile(filePath: string): Promise<void> {
  const needle = Buffer.from('unicase');
  const replacement = Buffer.from('NOCASE ');
  const handle = await open(filePath, 'r+');
  try {
    const info = await handle.stat();
    const chunkSize = 4 * 1024 * 1024;
    let position = 0;
    let overlap = Buffer.alloc(0);
    while (position < info.size) {
      const buffer = Buffer.alloc(Math.min(chunkSize, info.size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      const data = Buffer.concat([overlap, buffer.subarray(0, bytesRead)]);
      const base = position - overlap.length;
      let index = data.indexOf(needle);
      while (index !== -1) {
        await handle.write(replacement, 0, replacement.length, base + index);
        index = data.indexOf(needle, index + needle.length);
      }
      overlap = data.subarray(Math.max(0, data.length - (needle.length - 1)));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
}

async function decompressZstdToFile(sourcePath: string, targetPath: string, maxBytes: number): Promise<void> {
  const zlib = await import('node:zlib') as typeof import('node:zlib') & { createZstdDecompress?: () => NodeJS.ReadWriteStream };
  if (typeof zlib.createZstdDecompress !== 'function') throw new ApkgImportError('Giải nén APKG v3 cần Node.js 24 trở lên.');
  let bytes = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) { callback(new ApkgImportError('Cơ sở dữ liệu trong APKG vượt giới hạn cho phép.')); return; }
      callback(null, chunk);
    },
  });
  await pipeline(createReadStream(sourcePath), zlib.createZstdDecompress() as unknown as Transform, guard, createWriteStream(targetPath, { flags: 'wx' }));
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/\[sound:[^\]]*\]/gi, ' ')
    .replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCodePoint(Math.min(0x10ffff, Number(digits))))
    .replace(/&#x([\da-f]+);/gi, (_match, digits: string) => String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(digits, 16))))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function mapNote(fields: Record<string, string>, ordered: string[]): ApkgCard | null {
  const find = (...names: string[]) => {
    for (const name of names) {
      const key = Object.keys(fields).find(candidate => candidate.toLowerCase().trim() === name);
      const value = key ? stripHtml(fields[key] ?? '') : '';
      if (value) return value;
    }
    return '';
  };
  const front = find('front', 'word', 'term', 'vocabulary', 'idiom', 'expression', 'phrase', 'question', 'text') || stripHtml(ordered[0] ?? '');
  if (!front) return null;
  const english = find('english meaning', 'definition', 'english definition', 'back', 'meaning', 'answer', 'back extra', 'comments');
  const vietnamese = find('vietnamese meaning', 'translation', 'translated meaning');
  const phonetic = find('phonetic symbol', 'phonetic', 'ipa', 'pronunciation');
  const back = english || stripHtml(ordered[1] ?? '');
  const example = find('example', 'example sentence', 'extra information', 'sentence', 'usage');
  if (!back) return null;
  return { front: front.slice(0, 500), back: back.slice(0, 5000), pronunciation: phonetic ? `/${phonetic.replace(/^\/(.*)\/$/, '$1')}/`.slice(0, 500) : '', translation: vietnamese.slice(0, 5000), example: example ? example.slice(0, 5000) : null, intervalDays: 0, repetitions: 0, easeFactor: 2.5, dueAt: null };
}

export interface AnkiSchedule { queue: number; type: number; due: number; interval: number; factor: number; repetitions: number }
export function mapAnkiSchedule(row: AnkiSchedule, collectionCreatedAt: number): Omit<ApkgCard, 'front'|'back'|'pronunciation'|'translation'|'example'> {
  const studied = row.repetitions > 0 || row.type > 0 || row.queue !== 0;
  if (!studied) return { intervalDays: 0, repetitions: 0, easeFactor: 2.5, dueAt: null };

  let dueMs = Date.now();
  if (row.queue === 1) dueMs = row.due * 1000; // Anki learning queue stores a Unix timestamp in seconds.
  else if (row.queue === 2 || row.queue === 3) dueMs = (collectionCreatedAt + row.due * 86_400) * 1000; // Anki review due dates are collection-relative days.
  else if (row.queue < 0) dueMs = Date.UTC(9999, 0, 1); // Preserve suspended/buried cards without making them immediately studyable.
  if (!Number.isFinite(dueMs) || dueMs < 0 || dueMs > Date.UTC(9999, 0, 1)) dueMs = Date.now();
  const dueAt = new Date(dueMs).toISOString().slice(0, 19).replace('T', ' ');
  return {
    intervalDays: Math.max(0, Number.isFinite(row.interval) ? row.interval : 0),
    // A learning/review card with zero completed Anki reviews is still not a new card.
    repetitions: Math.max(1, Number.isFinite(row.repetitions) ? row.repetitions : 0),
    easeFactor: row.factor > 0 ? Math.min(99, Math.max(1.3, row.factor / 1000)) : 2.5,
    dueAt,
  };
}

async function readCardsFromDatabase(dbPath: string, maxNotes: number): Promise<ApkgParseResult> {
  let DatabaseSync: typeof import('node:sqlite').DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { throw new ApkgImportError('Đọc APKG cần Node.js 24 trở lên.'); }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name));
    const fieldsByModel = new Map<number, string[]>();
    if (tables.has('fields')) {
      const rows = db.prepare('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord').all() as Array<{ ntid: number; ord: number; name: string }>;
      for (const row of rows) { const model = fieldsByModel.get(row.ntid) ?? []; model[row.ord] = row.name; fieldsByModel.set(row.ntid, model); }
    } else {
      const collection = db.prepare('SELECT models FROM col').get() as { models?: string } | undefined;
      const models = collection?.models ? JSON.parse(collection.models) as Record<string, { flds?: Array<{ name: string }> }> : {};
      for (const [id, model] of Object.entries(models)) fieldsByModel.set(Number(id), (model.flds ?? []).map(field => field.name));
    }
    const rows = db.prepare('SELECT n.id AS noteId, n.mid AS modelId, n.flds AS fields FROM notes n WHERE EXISTS (SELECT 1 FROM cards c WHERE c.nid = n.id) ORDER BY n.id LIMIT ?').all(maxNotes + 1) as Array<{ noteId: number; modelId: number; fields: string }>;
    if (rows.length > maxNotes) throw new ApkgImportError(`APKG vượt giới hạn ${maxNotes} ghi chú.`);
    if (!rows.length) throw new ApkgImportError('Không tìm thấy ghi chú có nội dung để nhập.');
    const collection = db.prepare('SELECT crt FROM col').get() as { crt?: number } | undefined;
    const collectionCreatedAt = Number(collection?.crt) > 0 ? Number(collection!.crt) : Math.floor(Date.now() / 1000);
    const schedules = db.prepare(`SELECT nid, queue, type, due, ivl AS interval, factor, reps AS repetitions FROM cards WHERE nid IN (${rows.map(() => '?').join(',')}) ORDER BY nid, reps DESC, due`).all(...rows.map(row => row.noteId)) as unknown as Array<AnkiSchedule & { nid: number }>;
    const schedulesByNote = new Map<number, AnkiSchedule>();
    for (const schedule of schedules) if (!schedulesByNote.has(schedule.nid)) schedulesByNote.set(schedule.nid, schedule);
    const cards: ApkgCard[] = [];
    for (const row of rows) {
      const values = String(row.fields ?? '').split('\x1f');
      const names = fieldsByModel.get(row.modelId) ?? [];
      const mapped = mapNote(Object.fromEntries(names.map((name, index) => [name, values[index] ?? ''])), values);
      if (mapped) cards.push({ ...mapped, ...mapAnkiSchedule(schedulesByNote.get(row.noteId) ?? { queue: 0, type: 0, due: 0, interval: 0, factor: 0, repetitions: 0 }, collectionCreatedAt) });
    }
    if (!cards.length) throw new ApkgImportError('Không tìm thấy ghi chú có đủ mặt trước và nội dung trả lời để nhập.');
    return { cards, skipped: rows.length - cards.length };
  } finally {
    db.close();
  }
}

/** Parses an APKG that has already been streamed to a private temp file. */
export async function parseApkgFile(archivePath: string, options: Partial<ApkgLimits> = {}): Promise<ApkgParseResult> {
  const limits = resolveLimits(options);
  const entries = await zipEntriesFromFile(archivePath, limits);
  const databaseName = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find(name => entries.has(name));
  if (!databaseName) throw new ApkgImportError('APKG không có collection.anki2/anki21 database.');
  await mkdir(UPLOAD_TMP_DIR, { recursive: true });
  const dir = await mkdtemp(join(UPLOAD_TMP_DIR, 'vocabup-apkg-'));
  const rawPath = join(dir, 'collection.raw');
  const dbPath = join(dir, 'collection.sqlite');
  try {
    await extractEntryToFile(archivePath, entries.get(databaseName)!, rawPath, limits);
    let sqlitePath = rawPath;
    if (databaseName.endsWith('.anki21b')) {
      await decompressZstdToFile(rawPath, dbPath, limits.maxDatabaseBytes);
      sqlitePath = dbPath;
    }
    const handle = await open(sqlitePath, 'r');
    try {
      const header = Buffer.alloc(16);
      await handle.read(header, 0, 16, 0);
      if (header.toString('binary') !== 'SQLite format 3\0') throw new ApkgImportError('Database trong APKG không phải SQLite hợp lệ.');
    } finally {
      await handle.close();
    }
    await replaceCollationInFile(sqlitePath);
    return await readCardsFromDatabase(sqlitePath, limits.maxNotes);
  } catch (error) {
    if (error instanceof ApkgImportError) throw error;
    throw new ApkgImportError('Không thể đọc database của APKG. Hãy xuất lại bộ thẻ bằng Anki mới nhất.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Backwards-compatible buffer entry point (tests/small callers); streams via a temp file. */
export async function parseApkg(archive: Buffer, options: Partial<ApkgLimits> = {}): Promise<ApkgParseResult> {
  const limits = resolveLimits(options);
  if (archive.length > limits.maxArchiveBytes) throw new ApkgImportError(`File APKG vượt quá giới hạn ${limitMB(limits.maxArchiveBytes)} MB.`);
  await mkdir(UPLOAD_TMP_DIR, { recursive: true });
  const dir = await mkdtemp(join(UPLOAD_TMP_DIR, 'vocabup-apkg-buffer-'));
  const path = join(dir, 'upload.apkg');
  try {
    await writeFile(path, archive, { flag: 'wx' });
    return await parseApkgFile(path, limits);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
