export const PHONE_DISPLAY = '(844) 842-SVBT';
export const PHONE_HREF = 'tel:+18448427828';
import { copyDefaults, themeDefaults, themeVariables } from './site-copy.js';
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';



import { PublicProjects } from './Projects.jsx';
import { PublicLeadership } from './Leadership.jsx';

const Scene = lazy(() => import('./Scene.jsx'));

const Portal = lazy(() => import('./Portal.jsx'));

export const sectors = [

  { key: 'startups', title: 'Startup technologies', tag: '01 / IDEAS INTO IMPACT', short: 'The first conviction. The next breakthrough.', text: 'Explore the journey from seed-stage ambition to a resilient technology business. Our approach considers runway, milestone-based funding and the operating discipline behind sustainable growth.', points: ['Seed-stage capital planning', 'Runway and milestone visibility', 'Founder-focused operating accounts'], risk: 'Early-stage ventures can lose all invested capital; funding is never guaranteed.' },

  { key: 'data', title: 'Small data centers', tag: '02 / DIGITAL FOUNDATIONS', short: 'Infrastructure for an always-on world.', text: 'A focused view of the physical infrastructure behind the digital economy. Evaluate power availability, utilization, cooling and long-term customer contracts alongside capital needs.', points: ['Infrastructure and capacity planning', 'Power and cooling economics', 'Capital expenditure visibility'], risk: 'Energy costs, technological obsolescence and customer concentration can materially affect outcomes.' },

  { key: 'reits', title: 'Real estate investment trusts', tag: '03 / REAL ASSET PERSPECTIVE', short: 'A stronger foundation for possibility.', text: 'Understand property-backed strategies through portfolio quality, occupancy, leverage and cash-flow resilience. This illustrative sector is not an offering of REIT securities.', points: ['Portfolio and occupancy analysis', 'Cash-flow and leverage discipline', 'Commercial property perspective'], risk: 'Property values and distributions may fall. Interest rates and illiquidity introduce additional risks.' },

  { key: 'homes', title: 'New home builders', tag: '04 / BUILDING TOMORROW', short: 'From open land to new beginnings.', text: 'Follow development from land acquisition through construction and delivery. A thoughtful approach connects budgets, draw schedules, approvals and the realities of local housing demand.', points: ['Land and construction planning', 'Project budgets and draw schedules', 'Commercial construction opportunities'], risk: 'Permitting delays, construction overruns and changing demand can put development capital at risk.' }

];



export function Modal({ title, children, onClose, wide = false, eyebrow = copyDefaults.dialogEyebrow }) {

  const ref = useRef(null);

  const titleId = useId();

  useEffect(() => {

    const prior = document.activeElement;

    const overflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    ref.current.showModal();

    return () => { document.body.style.overflow = overflow; prior?.focus(); };

  }, []);

  return <dialog ref={ref} aria-labelledby={titleId} className={wide ? 'modal wide' : 'modal'} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }}><div className="modal-head"><span className="eyebrow">{eyebrow}</span><button className="icon-button" onClick={onClose} aria-label="Close dialog">×</button></div><h2 id={titleId}>{title}</h2>{children}</dialog>;

}



export function SceneView({ kind = 'brand', label }) {

  const ref = useRef(null);

  const [ready, setReady] = useState(false);

  useEffect(() => {

    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setReady(true); observer.disconnect(); } }, { rootMargin: '160px' });

    observer.observe(ref.current);

    return () => observer.disconnect();

  }, []);

  return <div ref={ref} className={`scene-wrap ${kind === 'brand' ? 'brand-scene' : ''}`}><Suspense fallback={<div className="scene-fallback">SVBT<span>Loading spatial experience</span></div>}>{ready ? <Scene kind={kind} label={label || 'Silicon Valley Bank and Trust logo in a gently rotating 3D display'} /> : <div className="scene-fallback">SVBT<span>Spatial perspectives</span></div>}</Suspense></div>;

}



export default function App() {

  const [content, setContent] = useState({});
  const copy = key => content[key] ?? copyDefaults[key];
  useEffect(() => { const reload=()=>fetch('/api/site-content').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(v=>setContent(v.overrides)).catch(()=>{});reload();window.addEventListener('svbt-content',reload);return()=>window.removeEventListener('svbt-content',reload); }, []);
  useEffect(() => { for (const [key, variable] of Object.entries(themeVariables)) { const value=content[key] ?? themeDefaults[key]; document.documentElement.style.setProperty(variable, /^#[0-9a-f]{6}$/i.test(value) ? value : themeDefaults[key]); } }, [content]);
  const visibleSectors = sectors.map(s=>({...s,...Object.fromEntries(['title','tag','short','text','risk'].map(k=>[k,content[`sector.${s.key}.${k}`] ?? s[k]])), points:s.points.map((p,i)=>content[`sector.${s.key}.point${i+1}`] ?? p)}));
  const [session, setSession] = useState(null);

  const [sessionError, setSessionError] = useState('');

  const [dialog, setDialog] = useState(null);

  const [sector, setSector] = useState(null);

  const [workspace, setWorkspace] = useState(false);

  const [menu, setMenu] = useState(false);

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState('');

  const token = useRef('');

  const [notice, setNotice] = useState('');

  // A reset link lands on /?reset=<token>. Take the token, then drop it from the address bar and history.
  const resetToken = useRef('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search), value = params.get('reset');
    if (!value) return;
    resetToken.current = value; params.delete('reset');
    window.history.replaceState(null, '', window.location.pathname + (params.size ? `?${params}` : '') + window.location.hash);
    setDialog('reset');
  }, []);

  const api = useCallback(async (path, options = {}) => {

    const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': token.current } : {}), ...options.headers } });

    const data = await response.json().catch(() => ({}));

    if (data.csrfToken) token.current = data.csrfToken;

    if (!response.ok) {

      if (response.status === 401 && path !== '/login' && path !== '/profile') { setWorkspace(false); fetch('/api/session', { credentials: 'same-origin' }).then(r => r.json()).then(next => { if (next.csrfToken) token.current = next.csrfToken; setSession(next); }).catch(() => setSession({ user: null })); }

      throw new Error(data.error || `Request failed (${response.status})`);

    }

    return data;

  }, []);

  const loadSession = useCallback(async () => {

    try { setSessionError(''); setSession(await api('/session')); } catch { setSessionError('The service is temporarily unavailable. Please try again shortly.'); }

  }, [api]);

  useEffect(() => { loadSession(); }, [loadSession]);

  function openAuth(mode) { setError(''); setNotice(''); setDialog(mode); setMenu(false); }

  async function authenticate(e) {

    e.preventDefault(); setBusy(true); setError('');

    const values = Object.fromEntries(new FormData(e.currentTarget));

    if (dialog === 'register' && values.password !== values.confirmPassword) { setError('Passwords must match.'); setBusy(false); return; }

    delete values.confirmPassword;

    try { const result = await api(dialog === 'register' ? '/register' : '/login', { method: 'POST', body: JSON.stringify(values) }); setSession(result); setDialog(null); setWorkspace(true); window.scrollTo(0, 0); } catch (err) { setError(err.message); } finally { setBusy(false); }

  }

  async function requestReset(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { const result = await api('/password-reset/request', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) }); setNotice(result.message); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function completeReset(e) {
    e.preventDefault(); setError('');
    const values = Object.fromEntries(new FormData(e.currentTarget));
    if (values.password !== values.confirmPassword) { setError('Passwords must match.'); return; }
    setBusy(true);
    try { const result = await api('/password-reset/complete', { method: 'POST', body: JSON.stringify({ token: resetToken.current, password: values.password }) }); setNotice(result.message); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  function closeReset() { resetToken.current = ''; setNotice(''); setDialog(null); }

  async function logout() { const result = await api('/logout', { method: 'POST', body: '{}' }); setSession(result); setWorkspace(false); }

  return <><a className="skip-link" href="#main">Skip to content</a>{copy('announcement') && <div className="status-bar">{copy('announcement')}</div>}<header className="site-header"><a className="brand" href="#" onClick={() => setWorkspace(false)}><img className="brand-logo" src="/svbt-logo.jpg" alt="Silicon Valley Bank and Trust" /></a><button className="menu-toggle" aria-expanded={menu} onClick={() => setMenu(!menu)}>{copy('menu')} {menu ? '−' : '+'}</button><nav className={menu ? 'open' : ''} aria-label="Main navigation"><a href="#projects" onClick={() => { setWorkspace(false); setMenu(false); }}>{copy('navProjects')}</a><a href="#sectors" onClick={() => { setWorkspace(false); setMenu(false); }}>{copy('navFocus')}</a><a href="#approach" onClick={() => { setWorkspace(false); setMenu(false); }}>{copy('navApproach')}</a><a href="#leadership" onClick={() => { setWorkspace(false); setMenu(false); }}>{copy('navLeadership')}</a>{session?.user ? <button className="button small" onClick={() => { setWorkspace(true); setMenu(false); }}>{copy('workspaceButton')}</button> : <><button className="text-button" onClick={() => openAuth('login')}>{copy('loginButton')}</button><button className="text-button" onClick={() => openAuth('moderator')}>{copy('staffLoginButton')}</button><button className="button small" onClick={() => openAuth('register')}>{copy('registerButton')}</button></>}</nav></header>

    {workspace && session?.user ? <main id="main"><Suspense fallback={<div className="loading panel">Opening your verified workspace…</div>}><Portal user={session.user} api={api} onLogout={logout} copy={copy} onUser={user => setSession(s => ({ ...s, user }))} /></Suspense></main> : <main id="main"><section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="line" /> {copy('heroEyebrow')}</div><h1>{copy('heroTitle')}</h1><p>{copy('heroText')}</p><div className="hero-actions"><button className="button" onClick={() => session?.user ? setWorkspace(true) : openAuth('register')}>{copy('heroButton')}<span>↗</span></button><a className="link-arrow" href="#sectors">{copy('focusButton')}<span>↓</span></a></div><div className="hero-note"><span className="crosshair">+</span><span>{copy('heroNote1')}<br /><strong>{copy('heroNote2')}</strong></span></div></div><div className="hero-visual"><div className="visual-coordinate top">SVBT / SPATIAL IDENTITY 001</div><SceneView /><div className="visual-coordinate bottom">37.3875° N &nbsp; 122.0575° W <span>SILICON VALLEY</span></div></div></section><div className="focus-strip"><span>{copy('stripHeading')}<br /><strong>{copy('stripSubheading')}</strong></span><a href="#sectors">{copy('stripStartups')}</a><a href="#sectors">{copy('stripData')}</a><a href="#sectors">{copy('stripReits')}</a><a href="#sectors">{copy('stripHomes')}</a></div><PublicProjects copy={copy} /><section id="sectors" className="section"><div className="section-heading"><div><span className="eyebrow">{copy('focusEyebrow')}</span><h2>{copy('focusTitle')}</h2></div><p>{copy('focusText')}</p></div><div className="sector-grid">{visibleSectors.map(s => <article className="sector-card" key={s.key}><SceneView kind={s.key} label={`Interactive ${s.title} model`} /><div className="sector-copy"><span className="eyebrow">{s.tag}</span><h3>{s.title}</h3><p>{s.short}</p><button className="link-arrow" onClick={() => setSector(s)}>{copy('sectorButton')}<span>↗</span></button></div></article>)}</div><p className="fine-print">{copy('sectorDisclosure')}</p></section><section id="approach" className="section approach"><div><span className="eyebrow">{copy('approachEyebrow')}</span><h2>{copy('approachTitle')}</h2><p className="lead">{copy('approachText')}</p><button className="link-arrow" onClick={() => openAuth('login')}>{copy('approachButton')}<span>↗</span></button></div><div className="principles">{[['01', copy('principle1Title'), copy('principle1Text')], ['02', copy('principle2Title'), copy('principle2Text')], ['03', copy('principle3Title'), copy('principle3Text')]].map(([n, t, p]) => <article key={n}><span>{n}</span><div><h3>{t}</h3><p>{p}</p></div></article>)}</div></section><PublicLeadership copy={copy} /><section className="cta section"><span className="eyebrow">{copy('ctaEyebrow')}</span><h2>{copy('ctaTitle')}</h2><button className="button" onClick={() => session?.user ? setWorkspace(true) : openAuth('register')}>{copy('ctaButton')}</button><p>{copy('ctaNote')}</p></section></main>}

    <footer className="site-footer"><div className="footer-top"><a href="#" className="brand-mark" onClick={() => setWorkspace(false)}><img className="brand-logo" src="/svbt-logo.jpg" alt="Silicon Valley Bank and Trust" /></a><p>{copy('bankName')}<br /><span>{copy('footerTagline')}</span></p><button className="text-button" onClick={() => openAuth('moderator')}>{copy('staffAccessButton')}</button></div><div className="footer-bottom"><p><strong>{copy('depositDisclosure')}</strong><br />{copy('disclosures')}<br /><button className="text-button" onClick={() => setDialog('privacy')}>{copy('privacyTitle')}</button> · <button className="text-button" onClick={() => setDialog('terms')}>{copy('termsTitle')}</button></p><p>{copy('bankName')}<br />{copy('footerOperations')}<br />{copy('physicalAddress')}</p><a href={PHONE_HREF}>{PHONE_DISPLAY}</a><span>© {new Date().getFullYear()} SVBT</span></div></footer>

    {['login','register','moderator'].includes(dialog) && <Modal eyebrow={copy('dialogEyebrow')} title={dialog === 'register' ? copy('registerTitle') : dialog === 'moderator' ? copy('staffTitle') : copy('loginTitle')} onClose={() => !busy && setDialog(null)}><p>{dialog === 'register' ? copy('registerText') : copy('loginText')}</p>{sessionError && <div className="error" role="alert">{sessionError}<button onClick={loadSession}>Retry connection</button></div>}<form onSubmit={authenticate}>{dialog === 'register' && <><label>{copy('businessNameLabel')}<input name="name" required maxLength={200} autoComplete="organization" /></label><label>{copy('addressLabel')}<input name="address" required maxLength={500} autoComplete="street-address" /></label></>}<label>{copy('emailLabel')}<input name="email" type="email" required autoComplete="username" /></label><label>{copy('passwordLabel')}<input name="password" type="password" required minLength={dialog === 'register' ? 12 : 1} autoComplete={dialog === 'register' ? 'new-password' : 'current-password'} /></label>{dialog === 'register' && <><small>{copy('passwordHelp')}</small><label>{copy('confirmPasswordLabel')}<input name="confirmPassword" type="password" required autoComplete="new-password" /></label></>}{error && <div className="error" role="alert">{error}</div>}<button className="button" disabled={busy || !session}>{busy ? 'Verifying…' : dialog === 'register' ? copy('registerButton') : copy('submitLoginButton')}</button></form><button className="text-button auth-switch" onClick={() => openAuth(dialog === 'register' ? 'login' : 'register')}>{dialog === 'register' ? copy('authSwitchLogin') : copy('authSwitchRegister')}</button>{dialog !== 'register' && <button className="text-button auth-switch" onClick={() => openAuth('forgot')}>{copy('forgotPasswordLink')}</button>}</Modal>}{dialog === 'forgot' && <Modal eyebrow={copy('dialogEyebrow')} title={copy('forgotTitle')} onClose={() => !busy && setDialog(null)}><p>{copy('forgotText')}</p>{notice ? <div className="success" role="status">{notice}</div> : <form onSubmit={requestReset}><label>{copy('emailLabel')}<input name="email" type="email" required autoComplete="username" /></label>{error && <div className="error" role="alert">{error}</div>}<button className="button" disabled={busy || !session}>{busy ? 'Sending…' : 'Email me a reset link'}</button></form>}</Modal>}{dialog === 'reset' && <Modal eyebrow={copy('dialogEyebrow')} title={copy('resetTitle')} onClose={() => !busy && closeReset()}>{notice ? <><div className="success" role="status">{notice}</div><button className="button" onClick={() => { closeReset(); openAuth('login'); }}>{copy('submitLoginButton')}</button></> : <form onSubmit={completeReset}><label>{copy('passwordLabel')}<input name="password" type="password" required minLength={12} autoComplete="new-password" /></label><small>{copy('passwordHelp')}</small><label>{copy('confirmPasswordLabel')}<input name="confirmPassword" type="password" required autoComplete="new-password" /></label>{error && <div className="error" role="alert">{error}</div>}<button className="button" disabled={busy || !session}>{busy ? 'Saving…' : 'Save new password'}</button></form>}</Modal>}{(dialog === 'privacy' || dialog === 'terms') && <Modal eyebrow={copy('bankName')} title={copy(dialog + 'Title')} onClose={() => setDialog(null)}><p className="legal-text">{copy(dialog + 'Text')}</p></Modal>}

    {sector && <Modal wide title={sector.title} onClose={() => setSector(null)}><div className="sector-dialog"><SceneView kind={sector.key} label={`${sector.title} procedural model`} /><div><p>{sector.text}</p><ul>{sector.points.map(p => <li key={p}>{p}</li>)}</ul><p className="risk">{sector.risk}</p><p className="fine-print">{copy('sectorStaffNote')}</p><button className="button" onClick={() => { setSector(null); openAuth('register'); }}>{copy('sectorWorkspaceButton')}</button></div></div></Modal>}

  </>;

}
