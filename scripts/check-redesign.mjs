import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
await mkdir('artifacts/redesign', { recursive:true });
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','frontend','--host','127.0.0.1','--port','5187','--strictPort'],{windowsHide:true,stdio:'pipe'});
await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(String(d).includes('ready'))resolve()});server.on('exit',reject);setTimeout(()=>reject(Error('Startup timeout')),15000).unref()});
const browser=await chromium.launch({channel:'msedge',headless:true});
const user={id:1,name:'Minh Anh',email:'minhanh@example.test',role:'user'};
const originalDecks=[{id:1,name:'Những điều thường ngày',description:'Từ vựng cho những cuộc trò chuyện nhỏ.',color:'#246650',dailyNewLimit:20,cardCount:24,dueCount:1},{id:2,name:'Đi xa, hiểu nhiều hơn',description:'Du lịch, những thành phố và con người.',color:'#b17c42',dailyNewLimit:20,cardCount:42,dueCount:0},{id:3,name:'Công việc & ý tưởng',description:'Diễn đạt tự tin trong công việc.',color:'#6784a2',dailyNewLimit:20,cardCount:18,dueCount:0}];
const card={id:1,deckId:1,front:'curiosity',back:'A strong desire to learn or know something.',translation:'Sự tò mò',pronunciation:'/ˌkjʊriˈɒsəti/',example:'Curiosity opens new doors.',intervalDays:0,repetitions:0};
let slow=false;
let decks=structuredClone(originalDecks), cards=[card], reviewed=false, reviewRequests=0, failSave=false;
const errors=[];
try {
 const context=await browser.newContext({reducedMotion:'reduce',hasTouch:true});
 const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/api','');const method=route.request().method();let data={};let status=200;
  if(path==='/me'||path==='/users/me'){if(slow)await new Promise(r=>setTimeout(r,900));data=user;}
  else if(path.startsWith('/auth/'))data={user};
  else if(path==='/decks'&&method==='POST'){await new Promise(r=>setTimeout(r,250));if(failSave){status=500;data={error:'Không thể lưu. Vui lòng thử lại.'}}else{data={...JSON.parse(route.request().postData()),id:4,cardCount:0,dueCount:0,dailyNewLimit:20};decks=[...decks,data]}}
  else if(path==='/decks')data=decks;
  else if(/^\/decks\/\d+\/stats$/.test(path))data={deckId:1,name:decks[0]?.name,totalCards:24,learned:12,progress:50,today:{newCount:0,reviewCount:0},last7:{newCount:7,reviewCount:9},last30:{newCount:12,reviewCount:22},last365:{newCount:12,reviewCount:22},reviewsTotal:22};
  else if(path==='/stats')data={deckCount:decks.length,cardCount:84,dueCount:reviewed?0:1,reviewedToday:reviewed?1:0,newToday:0,learnedCount:12,matureCount:3,retentionRate:null,retentionSample:0,streak:4,last7Days:[],studyDate:'2026-11-04',timeZone:'Asia/Ho_Chi_Minh'};
  else if(path==='/images/status')data={configured:false,provider:null};
  else if(path.includes('/cards')){const q=new URL(route.request().url()).searchParams.get('search');data={cards:q?cards.filter(c=>c.front.includes(q)):cards,total:q?cards.filter(c=>c.front.includes(q)).length:cards.length}}
  else if(path==='/study/due')data=reviewed?[]:cards;
  else if(path.includes('/review')){reviewRequests++;await new Promise(r=>setTimeout(r,250));reviewed=true;data={intervalMinutes:5760,repetitions:1}}
  else if(path.includes('/favorite'))data={};
  else if(path==='/upload/limits')data={csvMaxMB:50,apkgMaxMB:200};
  else if(path.startsWith('/stats/')||path.includes('/statistics')||path.includes('/learning')){status=503;data={error:'Thống kê tạm thời chưa sẵn sàng. Vui lòng thử lại.'}}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 const shot=async(name)=>{await page.screenshot({path:`artifacts/redesign/${name}.png`,fullPage:true});const width=await page.evaluate(()=>document.documentElement.scrollWidth);expect(width,`overflow ${name}`).toBeLessThanOrEqual(page.viewportSize().width)};
 for(const [name,width,height] of [['desktop',1440,1000],['tablet',820,1180],['mobile',390,844]]){
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:5187/dashboard');await expect(page.getByRole('heading',{name:'Chào Minh'})).toBeVisible().catch(async e=>{console.log(await page.locator('body').innerText());throw e});await shot(`${name}-dashboard`);
  await page.getByRole('button',{name:'Những điều thường ngày',exact:true}).click();await expect(page).toHaveURL(/\/decks\/1\/cards$/);await expect(page.getByText('curiosity',{exact:true})).toBeVisible();await shot(`${name}-library`);await page.locator('.deck-learning summary').click();await expect(page.getByText('TỪ MỚI HÔM NAY',{exact:true})).toBeVisible();await page.locator('.deck-learning summary').click();
  await page.goto('http://127.0.0.1:5187/decks');await page.getByLabel('Tìm bộ từ').fill('không tồn tại');await expect(page.getByText('Không tìm thấy bộ từ',{exact:true})).toBeVisible();await shot(`${name}-search-empty`);
  await page.getByRole('button',{name:'Xóa tìm kiếm'}).click();await expect(page.getByRole('button',{name:'Những điều thường ngày',exact:true})).toBeVisible();
 }
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:5187/dashboard');
 await page.getByRole('button',{name:'Bắt đầu ôn tập'}).click();await expect(page.getByLabel('Lật thẻ để xem đáp án')).toBeVisible();await shot('desktop-study-front');
 await page.locator('body').click({position:{x:1100,y:90}});await page.keyboard.press('Space');await expect(page.getByRole('button',{name:/Nhớ được/})).toBeVisible();await shot('desktop-study-answer');
 await page.getByRole('button',{name:/Dễ/}).dblclick();await expect(page.getByRole('heading',{name:'Tuyệt vời, Minh!'})).toBeVisible();expect(reviewRequests).toBe(1);await shot('desktop-study-complete');
 await page.goto('http://127.0.0.1:5187/decks');await page.getByRole('button',{name:'Tạo bộ từ',exact:true}).last().click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await shot('desktop-create');await dialog.getByRole('button',{name:'Tạo bộ từ',exact:true}).focus();await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 await dialog.locator('input').first().fill('Một bộ từ với tên dài và tiếng Việt có dấu — 学习 — café');
 failSave=true;await dialog.getByRole('button',{name:'Tạo bộ từ',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Không thể lưu');await expect(dialog).toBeVisible();
 failSave=false;await dialog.getByRole('button',{name:'Tạo bộ từ',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('status')).toContainText('Đã tạo');
 await page.goto('http://127.0.0.1:5187/statistics');await expect(page.getByText('Thống kê tạm thời chưa sẵn sàng. Vui lòng thử lại.').first()).toBeVisible();await shot('desktop-statistics-error');
 decks=[];await page.goto('http://127.0.0.1:5187/dashboard');await expect(page.getByRole('button',{name:'Tạo bộ từ đầu tiên'})).toBeVisible();await shot('desktop-first-use');
 decks=originalDecks;await page.goto('http://127.0.0.1:5187/dashboard');await page.evaluate(()=>document.documentElement.dataset.theme='dark');await shot('desktop-dark');
 await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:5187/dashboard');await page.getByLabel('Mở menu').tap();await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);await page.getByRole('button',{name:'Bộ từ của tôi',exact:true}).click();await expect(page.locator('.sidebar')).not.toHaveClass(/mobile-open/);
 await page.screenshot({path:'artifacts/redesign/mobile-final-library-index.png',fullPage:true});await page.goto('http://127.0.0.1:5187/user');await expect(page.locator('.profile-surface')).toBeVisible();await shot('mobile-profile');
 await page.goto('http://127.0.0.1:5187/login');await page.getByLabel('Email',{exact:true}).fill('invalid');await page.getByLabel('Mật khẩu',{exact:true}).fill('test');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();expect(await page.getByLabel('Email',{exact:true}).evaluate(el=>el.validity.valid)).toBe(false);
 await page.getByLabel('Email',{exact:true}).fill('minhanh@example.test');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await expect(page).toHaveURL(/dashboard$/);
 slow=true;await page.goto('http://127.0.0.1:5187/dashboard');await expect(page.getByText('Đang tải không gian học tập…')).toBeVisible();await shot('mobile-loading');await expect(page.getByRole('heading',{name:'Chào Minh'})).toBeVisible();slow=false;
 decks=[{...originalDecks[0],name:'Một bộ từ rất dài với tiếng Việt có dấu — 学习 — café — '+ 'A'.repeat(80),description:'Một mô tả dài để kiểm tra khả năng xuống dòng. '.repeat(8)}];await page.goto('http://127.0.0.1:5187/decks');await expect(page.locator('.deck-name')).toBeVisible();await shot('mobile-long-content');
 expect(errors).toEqual([]);console.log('PASS: responsive dashboard/library/search, study reveal/rating/completion, duplicate review guard, create failure/retry, first use, dark theme, mobile navigation; no runtime errors.');
} finally {await browser.close();server.kill()}

