import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { parse as parseStream } from 'csv-parse';
import { parse as parseSync } from 'csv-parse/sync';
import { CSV_MAX_BYTES } from './config.js';
import type { PreviewCard } from './import-preview.js';

export const CSV_MAX_CARDS = 5_000;

export class CsvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvImportError';
  }
}

export interface CsvRecord { front: string; back: string; pronunciation: string; translation: string; example: string }

/** Maps one CSV row to the VocabUp card fields (same aliases as the legacy importer). */
export function normalizeCsvRecord(row: Record<string, string>): CsvRecord {
  return {
    front: row.front ?? row.term ?? '',
    back: row.back ?? row.translation ?? '',
    pronunciation: row.pronunciation ?? row.phonetic ?? '',
    translation: row.back ? (row.translation ?? row.vietnamese ?? '') : (row.vietnamese ?? ''),
    example: row.example ?? '',
  };
}

export function toPreviewCards(records: CsvRecord[], maxCards = CSV_MAX_CARDS): PreviewCard[] {
  if (records.some(record => !record.front || !record.back)) throw new CsvImportError('Mỗi dòng cần có front/back (hoặc term/translation).');
  if (records.length > maxCards) throw new CsvImportError(`CSV vượt giới hạn ${maxCards} từ.`);
  if (records.some(record => record.front.length > 500 || record.back.length > 5000 || record.pronunciation.length > 500 || record.translation.length > 5000 || record.example.length > 5000)) {
    throw new CsvImportError('Dữ liệu CSV vượt giới hạn cho phép.');
  }
  return records.map(record => ({ ...record, example: record.example || null, intervalDays: 0, repetitions: 0, easeFactor: 2.5, dueAt: null }));
}

/** In-memory path used by the legacy JSON import and the small JSON preview fallback. */
export function parseCsvCards(csv: string, maxBytes = CSV_MAX_BYTES, maxCards = CSV_MAX_CARDS): PreviewCard[] {
  if (!csv || csv.length > maxBytes) throw new CsvImportError(`CSV trống hoặc vượt quá ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  let records: Array<Record<string, string>>;
  try {
    records = parseSync(csv.replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Array<Record<string, string>>;
  } catch {
    throw new CsvImportError('Không đọc được nội dung CSV. Kiểm tra định dạng và tiêu đề cột.');
  }
  if (!records.length) throw new CsvImportError('CSV cần có tiêu đề front, back và các dòng dữ liệu.');
  return toPreviewCards(records.map(normalizeCsvRecord), maxCards);
}

/**
 * Streams a CSV file from disk (no full-file string in RAM), enforces the byte and
 * row caps, rejects binary payloads and returns the same normalised cards as the
 * JSON path. The caller owns the temp file and must remove it.
 */
export async function parseCsvFile(filePath: string, options: { maxBytes?: number; maxCards?: number } = {}): Promise<PreviewCard[]> {
  const maxBytes = options.maxBytes ?? CSV_MAX_BYTES;
  const maxCards = options.maxCards ?? CSV_MAX_CARDS;
  const info = await stat(filePath).catch(() => null);
  if (!info || !info.size) throw new CsvImportError('File CSV bị trống.');
  if (info.size > maxBytes) throw new CsvImportError(`File CSV vượt quá giới hạn ${Math.round(maxBytes / 1024 / 1024)} MB.`);

  const handle = await open(filePath, 'r');
  try {
    const head = Buffer.alloc(Math.min(4096, info.size));
    await handle.read(head, 0, head.length, 0);
    if (head.includes(0)) throw new CsvImportError('File không phải CSV văn bản hợp lệ.');
  } finally {
    await handle.close();
  }

  const records: CsvRecord[] = [];
  const parser = createReadStream(filePath).pipe(parseStream({ columns: true, skip_empty_lines: true, trim: true, bom: true }));
  try {
    for await (const row of parser) {
      records.push(normalizeCsvRecord(row as Record<string, string>));
      if (records.length > maxCards) throw new CsvImportError(`CSV vượt giới hạn ${maxCards} từ.`);
    }
  } catch (error) {
    if (error instanceof CsvImportError) throw error;
    throw new CsvImportError('Không đọc được nội dung CSV. Kiểm tra định dạng và tiêu đề cột.');
  } finally {
    parser.destroy();
  }
  if (!records.length) throw new CsvImportError('CSV cần có tiêu đề front, back và các dòng dữ liệu.');
  return toPreviewCards(records, maxCards);
}
