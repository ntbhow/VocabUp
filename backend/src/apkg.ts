import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export interface ApkgCard { front: string; back: string; pronunciation: string; translation: string; example: string | null; intervalDays: number; repetitions: number; easeFactor: number; dueAt: string | null }
export interface ApkgParseResult { cards: ApkgCard[]; skipped: number }

export class ApkgImportError extends Error {
  constructor(message: string) { super(message); this.name = 'ApkgImportError'; }
}

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_DATABASE_BYTES = 150 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_NOTES = 5_000;
const decoder = new TextDecoder('utf-8', { fatal: true });

interface ZipEntry { method: number; flags: number; compressedSize: number; expandedSize: number; localOffset: number }

function zipEntries(archive: Buffer): Map<string, ZipEntry> {
  if (archive.length > MAX_ARCHIVE_BYTES) throw new ApkgImportError('File APKG vượt giới hạn 50 MB.');
  const min = Math.max(0, archive.length - 65_557);
  let eocd = -1;
  for (let i = archive.length - 22; i >= min; i--) if (archive.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ApkgImportError('Không tìm thấy cấu trúc ZIP hợp lệ trong file APKG.');
  const count = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES || centralOffset + centralSize > eocd) throw new ApkgImportError('Cấu trúc ZIP không hợp lệ hoặc có quá nhiều file.');

  const entries = new Map<string, ZipEntry>();
  let offset = centralOffset;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) throw new ApkgImportError('Danh mục file trong APKG bị lỗi.');
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const expandedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    if ([compressedSize, expandedSize, localOffset].includes(0xffffffff)) throw new ApkgImportError('APKG kiểu ZIP64 chưa được hỗ trợ.');
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > archive.length) throw new ApkgImportError('Danh mục file trong APKG bị cắt cụt.');
    const nameBytes = archive.subarray(offset + 46, offset + 46 + nameLength);
    let name: string;
    try { name = flags & 0x800 ? decoder.decode(nameBytes) : nameBytes.toString('latin1'); }
    catch { throw new ApkgImportError('Tên file trong APKG không hợp lệ.'); }
    if (entries.has(name)) throw new ApkgImportError('APKG có tên file bị trùng.');
    entries.set(name, { method, flags, compressedSize, expandedSize, localOffset });
    offset = next;
  }
  return entries;
}

function extractEntry(archive: Buffer, name: string, entry: ZipEntry): Buffer {
  if (entry.flags & 1) throw new ApkgImportError('APKG được mã hóa; hãy xuất lại mà không đặt mật khẩu.');
  if (entry.expandedSize > MAX_DATABASE_BYTES || entry.compressedSize > archive.length) throw new ApkgImportError('Cơ sở dữ liệu trong APKG vượt giới hạn cho phép.');
  const start = entry.localOffset;
  if (start + 30 > archive.length || archive.readUInt32LE(start) !== 0x04034b50) throw new ApkgImportError('Dữ liệu file trong APKG không hợp lệ.');
  const nameLength = archive.readUInt16LE(start + 26);
  const extraLength = archive.readUInt16LE(start + 28);
  const dataStart = start + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > archive.length) throw new ApkgImportError('Dữ liệu file trong APKG bị cắt cụt.');
  const compressed = archive.subarray(dataStart, dataEnd);
  let data: Buffer;
  if (entry.method === 0) data = Buffer.from(compressed);
  else if (entry.method === 8) {
    try { data = requireInflateRaw(compressed, Math.min(MAX_DATABASE_BYTES, entry.expandedSize + 1)); }
    catch { throw new ApkgImportError(`Không thể giải nén ${name} trong APKG.`); }
  } else throw new ApkgImportError(`APKG dùng kiểu nén không được hỗ trợ (${entry.method}).`);
  if (data.length !== entry.expandedSize) throw new ApkgImportError(`Kích thước ${name} không khớp với danh mục APKG.`);
  return data;
}

function requireInflateRaw(data: Buffer, maxOutputLength: number): Buffer {
  return inflateRawSync(data, { maxOutputLength });
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
  if (!back && !vietnamese) return null;
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

export async function parseApkg(archive: Buffer): Promise<ApkgParseResult> {
  const entries = zipEntries(archive);
  const databaseName = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find(name => entries.has(name));
  if (!databaseName) throw new ApkgImportError('APKG không có collection.anki2/anki21 database.');
  let databaseBytes = extractEntry(archive, databaseName, entries.get(databaseName)!);
  if (databaseName.endsWith('.anki21b')) {
    const zlib = await import('node:zlib');
    if (!('zstdDecompressSync' in zlib)) throw new ApkgImportError('Giải nén APKG v3 cần Node.js 24 trở lên.');
    try { databaseBytes = (zlib as typeof zlib & { zstdDecompressSync: (input: Buffer, options?: { maxOutputLength?: number }) => Buffer }).zstdDecompressSync(databaseBytes, { maxOutputLength: MAX_DATABASE_BYTES }); }
    catch { throw new ApkgImportError('Không thể giải nén collection.anki21b.'); }
  }
  if (databaseBytes.length > MAX_DATABASE_BYTES || databaseBytes.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') throw new ApkgImportError('Database trong APKG không phải SQLite hợp lệ.');

  // Anki registers a custom SQLite collation. Replace its schema-only name with the
  // built-in equivalent in this temporary copy; no media or archive paths are extracted.
  const collation = Buffer.from('unicase');
  for (let i = 0; i <= databaseBytes.length - collation.length; i++) {
    if (databaseBytes.subarray(i, i + collation.length).equals(collation)) { Buffer.from('NOCASE ').copy(databaseBytes, i); i += collation.length - 1; }
  }

  const dir = await mkdtemp(join(tmpdir(), 'vocabup-apkg-'));
  const dbPath = join(dir, 'collection.sqlite');
  try {
    await writeFile(dbPath, databaseBytes, { flag: 'wx' });
    let DatabaseSync: typeof import('node:sqlite').DatabaseSync;
    try { ({ DatabaseSync } = await import('node:sqlite')); }
    catch { throw new ApkgImportError('Đọc APKG cần Node.js 24 trở lên.'); }
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name));
      let fieldsByModel = new Map<number, string[]>();
      if (tables.has('fields')) {
        const rows = db.prepare('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord').all() as Array<{ ntid: number; ord: number; name: string }>;
        for (const row of rows) { const model = fieldsByModel.get(row.ntid) ?? []; model[row.ord] = row.name; fieldsByModel.set(row.ntid, model); }
      } else {
        const collection = db.prepare('SELECT models FROM col').get() as { models?: string } | undefined;
        const models = collection?.models ? JSON.parse(collection.models) as Record<string, { flds?: Array<{ name: string }> }> : {};
        for (const [id, model] of Object.entries(models)) fieldsByModel.set(Number(id), (model.flds ?? []).map(field => field.name));
      }
      const rows = db.prepare('SELECT n.id AS noteId, n.mid AS modelId, n.flds AS fields FROM notes n WHERE EXISTS (SELECT 1 FROM cards c WHERE c.nid = n.id) ORDER BY n.id LIMIT ?').all(MAX_NOTES + 1) as Array<{ noteId: number; modelId: number; fields: string }>;
      if (rows.length > MAX_NOTES) throw new ApkgImportError(`APKG vượt giới hạn ${MAX_NOTES} ghi chú.`);
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
    } finally { db.close(); }
  } catch (error) {
    if (error instanceof ApkgImportError) throw error;
    throw new ApkgImportError('Không thể đọc database của APKG. Hãy xuất lại bộ thẻ bằng Anki mới nhất.');
  } finally { await rm(dir, { recursive: true, force: true }); }
}
