import { ThemeSelect } from './Theme';
import { useEffect, useRef, useState } from 'react';
import { LogOut, Settings, UserRound, Upload, Trash2 } from 'lucide-react';
import { request, type User } from './api';

export function Avatar({ user }: { user: User }) {
  return <span className="avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.name.trim().slice(0, 1).toUpperCase()}</span>;
}
export function AccountMenu({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="account-menu" ref={ref} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} className="account-trigger" aria-label="Tài khoản của bạn" aria-expanded={open} onClick={() => setOpen(!open)}><Avatar user={user} /></button>
    {open && <div className="account-dropdown"><div className="account-summary"><Avatar user={user} /><div><strong>{user.name}</strong><small>{user.email}</small></div></div><div className="account-theme"><span>Giao diện</span><ThemeSelect /></div><a href="/user"><UserRound size={18} />Hồ sơ cá nhân</a><a href="/user?tab=security"><Settings size={18} />Cài đặt tài khoản</a><button onClick={onSignOut}><LogOut size={18} />Đăng xuất</button></div>}
  </div>;
}

export function ProfilePage({ user, onUpdate, onSettings }: { user: User; onUpdate: (user: User) => void; onSettings: () => void }) {
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio ?? '');
  const avatarInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [remove, setRemove] = useState(false);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [security, setSecurity] = useState(new URLSearchParams(location.search).get('tab') === 'security');
  const [loaded, setLoaded] = useState(false);
  const dirty = name.trim() !== user.name || bio.trim() !== (user.bio ?? '') || !!file || remove;
  useEffect(() => { let active = true; void request<User>('/users/me', 'session').then(next => { if (active) { onUpdate(next); setName(next.name); setBio(next.bio ?? ''); setLoaded(true); } }).catch(() => { if (active) { setFailed(true); setMessage('Không tải được hồ sơ. Vui lòng thử tải lại trang.'); } }); return () => { active = false; }; }, []);
  useEffect(() => { if (!file) { setPreview(''); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    const click = (e: MouseEvent) => { const target = (e.target as HTMLElement).closest('.nav-link, .deck-shortcut, .account-dropdown>button'); if (target && !window.confirm('Bạn có thay đổi chưa lưu. Rời trang?')) { e.preventDefault(); e.stopPropagation(); } };
    const pop = (e: PopStateEvent) => { if (!window.confirm('Bạn có thay đổi chưa lưu. Rời trang?')) { history.pushState({}, '', '/user'); e.stopImmediatePropagation(); } };
    window.addEventListener('beforeunload', unload); window.addEventListener('popstate', pop, true); document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('popstate', pop, true); document.removeEventListener('click', click, true); };
  }, [dirty]);
  const reset = () => { setName(user.name); setBio(user.bio ?? ''); setFile(null); setRemove(false); setMessage(''); };
  async function save() {
    setBusy(true); setMessage(''); setFailed(false);
    try {
      let next = await request<User>('/users/me', 'session', { method: 'PATCH', body: JSON.stringify({ name: name.trim(), bio: bio.trim() }) });
      onUpdate(next); setName(next.name); setBio(next.bio ?? '');
      if (file) next = await request<User>('/users/me/avatar', 'session', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      else if (remove) next = await request<User>('/users/me/avatar', 'session', { method: 'DELETE' });
      onUpdate(next); setFile(null); setRemove(false); setMessage('Đã lưu hồ sơ của bạn.');
    } catch (error) { setFailed(true); setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="profile-page"><div className="welcome-row"><div><div className="eyebrow">TÀI KHOẢN CỦA BẠN</div><h1>Hồ sơ cá nhân</h1><p className="muted">Một không gian mang dấu ấn của bạn.</p></div></div>
    <div className="profile-tabs" role="tablist" aria-label="Thông tin tài khoản">{[false, true].map(value => <button key={String(value)} role="tab" aria-selected={security === value} onClick={() => { setSecurity(value); history.replaceState({}, '', value ? '/user?tab=security' : '/user'); }}>{value ? 'Tài khoản & bảo mật' : 'Thông tin cá nhân'}</button>)}</div>
    {message && <p role={failed ? 'alert' : 'status'} className={failed ? 'error-box' : 'profile-success'}>{message}</p>}
    {security ? <div className="profile-surface"><h2>Tài khoản & bảo mật</h2><label>Email đăng nhập<input value={user.email} readOnly /></label><p className="muted">Email chỉ đọc vì VocabUp chưa hỗ trợ xác minh email mới.</p><button className="button secondary" onClick={onSettings}><Settings size={18} />Cài đặt ứng dụng</button></div> : <form className="profile-surface" onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={busy || !loaded}>
        <div className="profile-avatar-editor">
          <Avatar user={{ ...user, avatarUrl: preview || (remove ? null : user.avatarUrl) }} />
          <div className="profile-avatar-controls">
            <strong>Ảnh đại diện</strong>
            <p className="muted">Chọn ảnh để xem trước, sau đó nhấn “Lưu thay đổi”.</p>
            <input ref={avatarInput} className="sr-only" type="file" aria-label="Chọn ảnh đại diện" accept="image/jpeg,image/png,image/webp" onChange={async e => {
              const selected = e.target.files?.[0]; e.target.value = '';
              if (!selected) return;
              if (selected.size > 2 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) {
                setFailed(true); setMessage('Chọn ảnh JPEG, PNG hoặc WebP tối đa 2 MB.'); return;
              }
              try {
                const bitmap = await createImageBitmap(selected); bitmap.close();
                setFile(selected); setRemove(false); setFailed(false); setMessage('');
              } catch { setFailed(true); setMessage('Không đọc được ảnh này. Vui lòng chọn ảnh khác.'); }
            }} />
            <div className="profile-avatar-actions">
              <button type="button" className="button secondary" onClick={() => avatarInput.current?.click()}><Upload size={17} />{file || (user.avatarUrl && !remove) ? 'Đổi ảnh' : 'Chọn ảnh'}</button>
              <button type="button" className="button secondary" disabled={remove || (!file && !user.avatarUrl)} onClick={() => { setFile(null); setRemove(!!user.avatarUrl); setMessage(''); }}><Trash2 size={16} />Gỡ ảnh</button>
              {(file || remove) && <button type="button" className="text-button" onClick={() => { setFile(null); setRemove(false); setMessage(''); }}>Hoàn tác</button>}
            </div>
            <small className="muted">JPEG, PNG hoặc WebP · Tối đa 2 MB</small>
            {(file || remove) && <p className="avatar-pending" role="status">{remove ? 'Ảnh sẽ được gỡ khi bạn lưu thay đổi.' : `Đã chọn: ${file?.name} · Chưa lưu`}</p>}
          </div>
        </div>
      <label>Tên hiển thị<input value={name} maxLength={100} required onChange={e => setName(e.target.value)} autoComplete="name" /></label><label>Email<input value={user.email} readOnly type="email" /></label><p className="muted">Email được dùng để đăng nhập và hiện chưa thể thay đổi.</p><label>Giới thiệu<textarea value={bio} rows={4} maxLength={500} onChange={e => setBio(e.target.value)} placeholder="Đôi điều về bạn và mục tiêu học tập…" /></label><small>{bio.length}/500 ký tự</small></fieldset>
      <div className="profile-actions"><button type="button" className="button secondary" disabled={busy || !dirty} onClick={reset}>Hủy</button><button className="button primary" disabled={busy || !loaded || !dirty || !name.trim()}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button></div>
    </form>}
  </section>;
}
