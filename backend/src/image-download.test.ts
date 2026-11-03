import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({ pool: { execute: vi.fn() } }));
vi.mock('node:fs/promises', () => ({ access: vi.fn(), unlink: vi.fn() }));
vi.mock('./uploads.js', () => ({ MAX_IMAGE_BYTES: 10, UPLOAD_DIR: '.', saveUploadedImage: vi.fn(async (buffer: Buffer) => ({ url: '/uploads/images/test.png', bytes: buffer.length, mime: 'image/png' })) }));
import { downloadCandidateImage, removeStoredImage } from './image-download.js';
import { unlink } from 'node:fs/promises';
import { pool } from './db.js';
import { saveUploadedImage } from './uploads.js';
import type { ImageCandidate } from './image-provider.js';

let id = 0;
function candidate(): ImageCandidate {
  const url = `https://cdn.pixabay.com/test-${++id}.png`;
  return { provider: 'pixabay', url, thumbnailUrl: url, width: 100, height: 100, author: null, sourceUrl: null, tags: [] };
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('bounded provider downloads', () => {
  it('keeps an image still referenced by another card', async () => {
    vi.mocked(pool.execute).mockResolvedValueOnce([[{ id: 2 }], []] as any);
    await removeStoredImage('/uploads/images/shared.png');
    expect(unlink).not.toHaveBeenCalled();
  });
  it('removes an unreferenced image', async () => {
    vi.mocked(pool.execute).mockResolvedValueOnce([[], []] as any);
    await removeStoredImage('/uploads/images/unused.png');
    expect(unlink).toHaveBeenCalledOnce();
  });
  it('keeps files when the database reference check fails', async () => {
    vi.mocked(pool.execute).mockRejectedValueOnce(new Error('Unavailable'));
    await removeStoredImage('/uploads/images/shared.png');
    expect(unlink).not.toHaveBeenCalled();
  });
  it('rejects redirects outside the provider allowlist before requesting them', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(downloadCandidateImage(candidate())).rejects.toThrow(/URL/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(saveUploadedImage).not.toHaveBeenCalled();
  });
  it('follows relative redirects on an allowed host', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/final.png' } })).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetch);
    await expect(downloadCandidateImage(candidate())).resolves.toMatchObject({ bytes: 3 });
    expect(fetch.mock.calls[1]?.[0]).toBe('https://cdn.pixabay.com/final.png');
  });
  it('cancels oversized streams even without Content-Length', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(6)); }, cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    await expect(downloadCandidateImage(candidate())).rejects.toThrow(/dung lượng/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(saveUploadedImage).not.toHaveBeenCalled();
  });
  it('stops redirect loops after a bounded number of requests', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/loop' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(downloadCandidateImage(candidate())).rejects.toThrow(/Chuyển hướng/);
    expect(fetch).toHaveBeenCalledTimes(6);
  });
});
