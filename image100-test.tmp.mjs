import { config } from 'dotenv';
config({ path: 'backend/.env' });
﻿const BASE = 'http://127.0.0.1:4100/api';
const suffix = Date.now().toString(36);
const words = [
 ['airplane','máy bay'],['apple','quả táo'],['book','quyển sách'],['car','xe hơi'],['cat','con mèo'],
 ['dog','con chó'],['house','ngôi nhà'],['tree','cái cây'],['river','con sông'],['mountain','ngọn núi'],
 ['doctor','bác sĩ'],['teacher','giáo viên'],['kitchen','nhà bếp'],['garden','khu vườn'],['bicycle','xe đạp'],
 ['chair','cái ghế'],['window','cửa sổ'],['bread','bánh mì'],['coffee','cà phê'],['guitar','đàn guitar'],
 ['camera','máy ảnh'],['umbrella','cái ô'],['ladder','cái thang'],['mirror','gương'],['clock','đồng hồ'],
 ['eat','ăn'],['drink','uống'],['run','chạy'],['swim','bơi'],['write','viết'],
 ['read','đọc'],['sing','hát'],['sleep','ngủ'],['walk','đi bộ'],['speak','nói'],
 ['buy','mua'],['sell','bán'],['build','xây dựng'],['carry','mang'],['open','mở'],
 ['close','đóng'],['jump','nhảy'],['throw','ném'],['catch','bắt'],['cook','nấu ăn'],
 ['happy','vui vẻ'],['sad','buồn'],['heavy','nặng'],['light','nhẹ'],['cold','lạnh'],
 ['hot','nóng'],['fast','nhanh'],['slow','chậm'],['beautiful','đẹp'],['angry','tức giận'],
 ['tired','mệt mỏi'],['hungry','đói'],['quiet','yên tĩnh'],['brave','dũng cảm'],['careful','cẩn thận'],
 ['bank','ngân hàng'],['bank','bờ sông'],['bat','con dơi'],['bat','gậy bóng chày'],['light','ánh sáng'],
 ['light','nhẹ cân'],['run','vận hành'],['run','chạy bộ'],['break down','xe bị hỏng'],['break down','suy sụp tinh thần'],
 ['take off','cất cánh'],['turn on','bật'],['look after','chăm sóc'],['give up','từ bỏ'],['find out','tìm ra'],
 ['put on','mặc vào'],['run out of','hết'],['get along','hòa thuận'],['show up','xuất hiện'],['come back','trở lại'],
 ['hit the hay','đi ngủ'],['piece of cake','dễ như ăn kẹo'],['under the weather','không khỏe'],['once in a blue moon','hiếm khi'],['break a leg','chúc may mắn'],
 ['cost an arm and a leg','rất đắt'],['let the cat out of the bag','tiết lộ bí mật'],['on cloud nine','rất hạnh phúc'],['see eye to eye','đồng ý'],['spill the beans','tiết lộ bí mật'],
 ['freedom','tự do'],['justice','công lý'],['success','thành công'],['love','tình yêu'],['courage','can đảm'],
 ['hope','hy vọng'],['patience','kiên nhẫn'],['wisdom','trí tuệ'],['stethoscope','ống nghe'],['photosynthesis','quang hợp']
];
const api = async (path, opts = {}) => {
  const res = await fetch(BASE + path, { ...opts, headers: { ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(opts.headers || {}) } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.getSetCookie?.() ?? [] };
};
const db = await import('mysql2/promise').then(m => m.default.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME }));
const [oldBefore] = await db.query('SELECT COUNT(*) AS n, SUM(image_url IS NOT NULL) AS withImage FROM cards');
const root = Math.random().toString(36).slice(2, 8) + '100';
const reg = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email: `${root}@example.test`, password: 'Test12345!', name: '100 test' }) });
const cookie = reg.cookie.find(c => c.startsWith('vocabup_session='))?.split(';')[0] ?? '';
const H = { Cookie: cookie };
const deckRes = await api('/decks', { method: 'POST', headers: H, body: JSON.stringify({ name: `100 words ${suffix}` }) });
const deckId = deckRes.body.id;
const csv = 'front,back,translation,example\n' + words.map(w => `${w[0]},${w[1]},${w[1]},I want to learn ${w[0]}.`).join('\n');
const form = new FormData();
form.append('file', new Blob([csv], { type: 'text/csv' }), 'words100.csv');
const previewRes = await api(`/decks/${deckId}/import/preview.csv`, { method: 'POST', headers: H, body: form });
const preview = previewRes.body;
const allIndexes = Array.from({ length: preview.total }, (_, i) => i);
const commitRes = await api(`/decks/${deckId}/import/commit`, { method: 'POST', headers: H, body: JSON.stringify({ token: preview.token, imageIndexes: allIndexes, picks: [] }) });
const commit = commitRes.body;
let job = null;
for (let i = 0; i < 200; i++) {
  const j = await api(`/images/jobs/${commit.jobId}`, { headers: H });
  job = j.body;
  if (job.status === 'done' || job.status === 'failed') break;
  await new Promise(r => setTimeout(r, 2000));
}
const [testCards] = await db.query(`SELECT image_source AS source, COUNT(*) AS n FROM cards c JOIN decks d ON d.id=c.deck_id WHERE d.id=? AND c.image_url IS NOT NULL GROUP BY image_source`, [deckId]);
const [withImage] = await db.query('SELECT COUNT(*) AS n FROM cards WHERE deck_id=? AND image_url IS NOT NULL', [deckId]);
const [notFound] = await db.query('SELECT front FROM cards WHERE deck_id=? AND image_url IS NULL', [deckId]);
const [oldAfter] = await db.query('SELECT COUNT(*) AS n, SUM(image_url IS NOT NULL) AS withImage FROM cards');
const firstCard = (await db.query('SELECT id FROM cards WHERE deck_id=? LIMIT 1', [deckId]))[0][0];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upForm = new FormData();
upForm.append('image', new Blob([png], { type: 'image/png' }), 'manual.png');
const upload = await api(`/cards/${firstCard.id}/image/upload`, { method: 'POST', headers: H, body: upForm });
const [manualRow] = await db.query('SELECT image_is_manual AS manual, image_source AS source, image_url AS url FROM cards WHERE id=?', [firstCard.id]);
const deleteRes = await api(`/cards/${firstCard.id}/image`, { method: 'DELETE', headers: H });
const [afterDelete] = await db.query('SELECT image_url AS url FROM cards WHERE id=?', [firstCard.id]);
const [reload] = await db.query('SELECT COUNT(*) AS n FROM cards WHERE deck_id=? AND image_url IS NOT NULL', [deckId]);
console.log(JSON.stringify({
  registered: reg.status, deck: deckId, previewTotal: preview.total, jobStatus: job?.status, jobTotal: job?.total,
  succeeded: job?.succeeded, notFoundJob: job?.notFound, failed: job?.failed,
  withImage: withImage[0].n, sources: testCards, notFoundWords: notFound.map(r => r.front),
  manualUpload: { status: upload.status, manual: manualRow[0].manual, source: manualRow[0].source, local: /^\/uploads\//.test(manualRow[0].url) },
  delete: { status: deleteRes.status, imageUrl: afterDelete[0].url, reloadWithImage: reload[0].n },
  oldCardsBefore: oldBefore[0], oldCardsAfter: oldAfter[0],
  cacheNote: 'old cards untouched'
}, null, 1));
await db.query('DELETE FROM users WHERE email=?', [`${root}@example.test`]);
await db.end();
