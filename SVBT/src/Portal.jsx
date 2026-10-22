import { StatementNotes, TransactionDetails } from './StatementDetails.jsx';
import { copyDefaults } from './site-copy.js';
import { SiteEditor, UserManager, AccountEditor } from './Administration.jsx';
import { useEffect, useMemo, useState } from 'react';

import { Modal } from './App.jsx';
import ProjectManager from './Projects.jsx';
import LeadershipManager from './Leadership.jsx';
import DemoImport from './DemoImport.jsx';
import Transfers from './Transfers.jsx';



const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((value || 0) / 100);

const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };

function cents(value) {

  if (!/^-?\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Enter a USD amount with no more than two decimal places.');

  const result = Math.round(Number(value) * 100);

  if (!Number.isSafeInteger(result)) throw new Error('Amount is outside the supported range.');

  return result;

}

function Field({ label, ...props }) { return <label>{label}<input {...props} /></label>; }

function Transactions({ rows, reverse, details, copy = key=>copyDefaults[key], all = rows, running = false }) {

  return <div className="table-scroll"><table><thead><tr><th>Date</th><th>Description / transaction details</th><th className="numeric">Amount</th>{running && <th className="numeric">Running balance</th>}{reverse && <th>Correction</th>}</tr></thead><tbody>{rows.length ? rows.map(t => <tr key={t.id}><td className="nowrap">{t.date}</td><td>{t.description}<small className="transaction-id">Entry #{t.id}{t.reversalOf ? ` · Reverses #${t.reversalOf}` : all.some(r => r.reversalOf === t.id) ? ' · Reversed' : ''}</small>{t.referenceId&&<small className="transaction-id">Transaction ID: {t.referenceId}</small>}{t.occurredAt&&<small className="transaction-id">Transaction time: {new Date(t.occurredAt).toLocaleString()}</small>}<small className="transaction-id">Recorded: {new Date(t.createdAt).toLocaleString()}</small>{t.notes&&<p className="statement-note-text">{t.notes}</p>}{details&&<button className="text-button" onClick={()=>details(t)}>{copy('transactionDetailsButton')}</button>}</td><td className={`numeric ${t.amount > 0 ? 'positive' : ''}`}>{money(t.amount)}</td>{running && <td className="numeric">{money(t.runningBalance)}</td>}{reverse && <td>{!t.reversalOf && !all.some(r => r.reversalOf === t.id) ? <button className="text-button" onClick={() => reverse(t)}>{copy('reverseButton')}</button> : <span className="muted">Recorded</span>}</td>}</tr>) : <tr><td colSpan={5} className="empty">No transactions match this view.</td></tr>}</tbody></table></div>;

}

function Chart({ transactions }) {

  const series = useMemo(() => { let balance = 0; return [{ date: 'Opening', balance: 0 }, ...transactions.map(t => ({ date: t.date, balance: balance += t.amount }))]; }, [transactions]);

  const low = Math.min(...series.map(p => p.balance)), high = Math.max(...series.map(p => p.balance));

  const range = high - low || 1;

  const points = series.map((p, i) => `${36 + i / Math.max(series.length - 1, 1) * 828},${180 - (p.balance - low) / range * 145}`).join(' ');

  return <div className="ledger-chart"><div className="chart-labels"><span>{money(high)}</span><span>Running balance · actual ledger entries</span></div><svg viewBox="0 0 900 210" role="img" aria-label={`Ledger running balance across ${transactions.length} transactions. Highest balance ${money(high)}, lowest ${money(low)}.`}><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9cdeed" stopOpacity=".25" /><stop offset="100%" stopColor="#9cdeed" stopOpacity="0" /></linearGradient></defs>{[35, 83, 131, 180].map(y => <line key={y} x1="36" x2="864" y1={y} y2={y} stroke="#263544" strokeDasharray="4 6" />)}<polygon points={`36,190 ${points} 864,190`} fill="url(#chartFill)" /><polyline points={points} fill="none" stroke="#a5e3f0" strokeWidth="2.5" />{series.map((p, i) => <circle key={i} cx={36 + i / Math.max(series.length - 1, 1) * 828} cy={180 - (p.balance - low) / range * 145} r="3" fill="#c99573"><title>{p.date}: {money(p.balance)}</title></circle>)}</svg><div className="chart-labels"><span>{transactions[0]?.date || 'Zero opening balance'}</span><span>{transactions.at(-1)?.date || 'No activity yet'}</span></div></div>;

}



export default function Portal({ user, api, onLogout, onUser, copy = key=>copyDefaults[key] }) {

  const admin = ['moderator','admin','owner'].includes(user.role);
  const editor = ['admin','owner'].includes(user.role);

  const [tab, setTab] = useState('Overview');

  const [accounts, setAccounts] = useState([]);

  const [accountId, setAccountId] = useState('');

  const [data, setData] = useState(null);

  const [profile, setProfile] = useState(null);

  const [investments, setInvestments] = useState([]);

  const [audit, setAudit] = useState([]);

  const [archive, setArchive] = useState([]);

  const [preview, setPreview] = useState(null);

  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const [filterMonth, setFilterMonth] = useState('');

  const [search, setSearch] = useState('');

  const [error, setError] = useState('');

  const [notice, setNotice] = useState('');

  const [loading, setLoading] = useState(true);

  const [busy, setBusy] = useState(false);

  const [edit, setEdit] = useState(null);
  const [details,setDetails]=useState(null);
  const [notesDirty,setNotesDirty]=useState(false);

  const [integrity, setIntegrity] = useState({});

  const [refresh, setRefresh] = useState(0);

  const base = `/admin/accounts/${accountId}`;

  useEffect(() => {

    let active = true;

    Promise.all([api('/profile'), ...(admin ? [api('/admin/accounts')] : [])]).then(([p, list]) => { if (!active) return; setProfile(p); if (list) { setAccounts(list); setAccountId(current => list.some(a => String(a.id) === current) ? current : String(list[0]?.id || '')); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });

    return () => { active = false; };

  }, [admin, refresh, api]);

  useEffect(() => {

    if (admin && !accountId) return;

    let active = true; setLoading(true); setData(null); setPreview(null); setArchive([]); setFilterMonth(''); setNotesDirty(false);

    api(admin ? base : '/account').then(result => { if (active) { setData(result); if (result.monthly.length) setMonth(result.monthly.at(-1).month); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });

    return () => { active = false; };

  }, [admin, accountId, refresh, api, base]);

  useEffect(() => {

    let active = true;

    if (!admin) return;

    const requests = tab === 'Investments' ? [api('/admin/investments').then(v => active && setInvestments(v))] : tab === 'Audit' ? [api('/admin/audit').then(v => active && setAudit(v))] : tab === 'Statements' && accountId ? [api(`${base}/statements`).then(v => active && setArchive(v))] : [];

    Promise.all(requests).catch(e => active && setError(e.message));

    return () => { active = false; };

  }, [tab, admin, accountId, refresh, api, base]);

  async function perform(task, message) {

    setBusy(true); setError(''); setNotice('');

    try { await task(); if (message) setNotice(message); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); }

  }

  async function saveEntry(e) {

    e.preventDefault(); const form = e.currentTarget; const values = Object.fromEntries(new FormData(form));

    await perform(async () => { if (edit.type === 'reverse') await api(`/admin/transactions/${edit.item.id}/reverse`, { method: 'POST', body: JSON.stringify(values) }); else { values.amount = cents(values.amount); values.requestId = edit.requestId; await api(`${base}/transactions`, { method: 'POST', body: JSON.stringify(values) }); } setEdit(null); setRefresh(r => r + 1); }, 'Ledger updated. Live previews have changed; existing issued revisions remain unchanged.');

  }

  async function saveInvestment(e) {

    e.preventDefault(); const values = Object.fromEntries(new FormData(e.currentTarget));

    await perform(async () => { values.targetCapital = cents(values.targetCapital); await api(`/admin/investments${edit.item?.id ? `/${edit.item.id}` : ''}`, { method: edit.item?.id ? 'PUT' : 'POST', body: JSON.stringify(values) }); setEdit(null); setRefresh(r => r + 1); }, 'Investment record saved.');

  }

  async function saveProfile(e) {

    e.preventDefault(); const form = e.currentTarget; const values = Object.fromEntries(new FormData(form));

    await perform(async () => { const result = await api('/profile', { method: 'PATCH', body: JSON.stringify(values) }); setProfile(result); onUser({ id: result.id, name: result.name, email: result.email, role: result.role }); form.elements.password.value = ''; setRefresh(r => r + 1); }, 'Personal details updated after password verification.');

  }

  async function pdf(statement, original = false) {

    await perform(async () => { const response = await fetch(`/api/admin/statements/${statement.id}/${original ? 'pdf' : 'branded-pdf'}`, { credentials: 'same-origin' }); if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'Unable to download statement.'); } const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `business-checking-${statement.month}-r${statement.revision}.pdf`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }, 'Statement PDF downloaded.');

  }

  const rows = (data?.transactions || []).filter(t => (!filterMonth || t.date.startsWith(filterMonth)) && `${t.description} ${t.id} ${t.referenceId||''} ${t.occurredAt||''} ${t.notes||''} ${t.date} ${money(t.amount)}`.toLowerCase().includes(search.toLowerCase())).slice().reverse();

  const tabs = admin ? ['Overview', 'Transactions', 'Statements', 'Projects', 'Leadership bio', 'Investments', ...(editor ? ['Design & wording', 'Customer details'] : []), ...(user.role === 'owner' ? ['Users & permissions'] : []), 'Audit', 'Profile'] : ['Overview', 'Transactions', 'Transfers', 'Account details', 'Profile'];

  return <div className="workspace"><aside className="workspace-sidebar"><img className="workspace-logo" src="/brand/svbt-logo.png" alt="Silicon Valley Bank and Trust" /><span className="eyebrow">{admin ? copy('operationsLabel') : copy('businessLabel')}</span><h3>{user.name}</h3><span className="role-badge">Server-verified {user.role}</span><nav aria-label="Workspace navigation">{tabs.map(t => <button key={t} className={tab === t ? 'active' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => { setTab(t); setError(''); setNotice(''); }}>{copy('tab.'+t.replaceAll(' ','_').replace('&','and'))}<span>↗</span></button>)}</nav><div className="sidebar-bottom"><p>Silicon Valley Bank and Trust</p><button className="text-button" disabled={busy} onClick={() => perform(onLogout)}>{copy('logoutButton')}</button></div></aside><div className="workspace-main"><div className="workspace-heading"><div><span className="eyebrow">SVBT / {admin ? user.role.toUpperCase() : 'CUSTOMER'}</span><h1>{tab === 'Overview' ? copy('workspaceTitle') : copy('tab.'+tab.replaceAll(' ','_').replace('&','and'))}</h1></div><button className="text-button" disabled={busy || loading} onClick={() => { setRefresh(r => r + 1); }}>Refresh ↻</button></div>{admin && !['Projects', 'Leadership bio', 'Site content', 'Users & permissions'].includes(tab) && <label className="account-select">Selected customer account<select value={accountId} onChange={e => { setAccountId(e.target.value); setError(''); setNotice(''); }} disabled={busy}><option value="" disabled>Select an account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.number}{a.demo ? ' · DEMO' : ''}</option>)}</select></label>}{error && <div className="error" role="alert">{error}<button className="text-button" onClick={() => setRefresh(r => r + 1)}>Retry data</button></div>}{notice && <div className="success" role="status">{notice}</div>}{loading && <p role="status">Loading verified account data…</p>}

    {tab === 'Overview' && data && <><div className="balance-grid"><div className="panel balance-card"><span className="eyebrow">ACCOUNT LEDGER / USD</span><h2>{money(data.balance)}</h2><p>{data.account.name}</p><span className="muted">Account {data.account.number}</span></div><div className="panel"><span className="eyebrow">LEDGER ACTIVITY</span><h2>{data.transactions.length}</h2><p>Recorded transactions</p><span className="muted">Opening balance $0.00 · balance derived from ledger</span></div></div><section className="panel"><div className="panel-heading"><h3>Balance over time</h3><span className="eyebrow">ALL RECORDED ACTIVITY</span></div><Chart transactions={data.transactions} /></section><section className="panel"><div className="panel-heading"><h3>Recent activity</h3><button className="text-button" onClick={() => setTab('Transactions')}>View all ↗</button></div><Transactions copy={copy} details={editor?setDetails:undefined} rows={data.transactions.slice(-5).reverse()} all={data.transactions} /></section></>}

    {tab === 'Transactions' && data && <><div className="toolbar"><label>Search ledger<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Description, transaction ID, notes, date or amount" /></label><label>Month<select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}><option value="">All months</option>{data.monthly.map(m => <option key={m.month}>{m.month}</option>)}</select></label>{admin ? <button className="button small" disabled={busy} onClick={() => setEdit({ type: 'post', requestId: crypto.randomUUID() })}>{copy('postButton')}</button> : <button className="text-button" onClick={() => window.print()}>Print history ↗</button>}</div>{user.role === 'owner' && <DemoImport api={api} account={data.account} onChanged={() => setRefresh(r => r + 1)} />}<section className="panel"><div className="panel-heading"><h3>Immutable transaction ledger</h3><span>{rows.length} entries</span></div><p className="fine-print">{admin ? 'Corrections create an opposite signed entry. Original entries cannot be edited or deleted.' : 'Read-only account history. Your balance reflects all entries, including recorded corrections.'}</p><Transactions copy={copy} details={editor?setDetails:undefined} rows={rows} all={data.transactions} reverse={admin ? t => setEdit({ type: 'reverse', item: t }) : null} /></section><section className="panel"><h3>Monthly history</h3><div className="table-scroll"><table><thead><tr><th>Month</th><th>Opening</th><th>Deposits</th><th>Debits</th><th>Closing</th></tr></thead><tbody>{data.monthly.map(m => <tr key={m.month}><td><button className="text-button" onClick={() => setFilterMonth(m.month)}>{m.month}</button></td><td>{money(m.opening)}</td><td>{money(m.deposits)}</td><td>{money(m.debits)}</td><td>{money(m.closing)}</td></tr>)}</tbody></table></div>{!data.monthly.length && <p>No monthly activity yet.</p>}</section></>}

    {!admin && tab === 'Transfers' && data && <Transfers api={api} balance={data.balance} onSent={() => api('/account').then(setData).catch(e => setError(e.message))} />}

    {tab === 'Account details' && data && <section className="panel"><h3>Business checking</h3><dl><dt>Account holder</dt><dd>{data.account.name}</dd><dt>Account number</dt><dd>{data.account.number}</dd><dt>Address</dt><dd>{data.account.address}</dd><dt>Currency</dt><dd>USD · integer cents ledger</dd><dt>Balance</dt><dd>{money(data.balance)}</dd></dl><button className="text-button" onClick={() => window.print()}>Print account details ↗</button><p className="fine-print">Investment records and issued statements are available to authorized staff.</p></section>}

    {tab === 'Profile' && profile && <section className="panel profile-panel"><h3>Personal details</h3><p>Confirm your current login password to update your name and address. This does not change your password.</p><form onSubmit={saveProfile} key={profile.name + profile.address}><Field label="Name" name="name" defaultValue={profile.name} required maxLength={200} autoComplete="name" /><Field label="Address" name="address" defaultValue={profile.address} required maxLength={500} autoComplete="street-address" /><Field label="Email · read only" value={profile.email} readOnly type="email" /><Field label="Current password for verification" name="password" type="password" required autoComplete="current-password" /><button className="button" disabled={busy}>{busy ? 'Verifying…' : 'Verify and save details ↗'}</button></form></section>}

    {admin && tab === 'Statements' && accountId && <><section className="panel"><h3>{copy('statementTitle')}</h3><p>A live calculation, not an issued statement. Backdated entries change this and later months. Issue new revisions for every affected month; existing PDFs stay unchanged.</p><div className="toolbar"><Field label="Statement month" type="month" value={month} onChange={e => { setMonth(e.target.value); setPreview(null); setNotesDirty(false); }} required /><button className="button small" disabled={busy || !month} onClick={() => perform(async () => setPreview(await api(`${base}/preview?month=${encodeURIComponent(month)}`)))}>{copy('previewButton')}</button></div>{editor&&<StatementNotes key={base+month} api={api} base={base} month={month} copy={copy} onDirty={setNotesDirty} onSaved={async()=>{if(preview)setPreview(await api(`${base}/preview?month=${encodeURIComponent(month)}`));}}/>}{preview && <><div className="preview-account"><strong>{preview.account.name}</strong><span>{preview.account.number} · {preview.account.address}</span></div><div className="stat-grid">{['opening', 'deposits', 'debits', 'closing'].map(k => <div key={k}><span>{k}</span><strong>{money(preview[k])}</strong></div>)}</div>{preview.statementNotes&&<div className="statement-note-text"><h4>{copy('statementNotesTitle')}</h4><p>{preview.statementNotes}</p></div>}<Transactions copy={copy} details={editor?setDetails:undefined} rows={preview.transactions} running /><button className="button" disabled={busy || notesDirty || preview.month !== month} onClick={() => perform(async () => { await api(`${base}/statements`, { method: 'POST', body: JSON.stringify({ month }) }); setArchive(await api(`${base}/statements`)); }, 'Immutable statement revision issued.')}>{busy ? 'Issuing…' : `${copy('issueButton')} · ${month} ↗`}</button></>}</section><section className="panel"><h3>{copy('archiveTitle')}</h3><p className="fine-print">Download a branded copy of any issued snapshot, or its archived original. Both use the same issued figures. Integrity checks validate the original archive.</p>{archive.length ? archive.map(s => <article className="archive-row" key={s.id}><div><h4>{s.month} <span className="role-badge">Revision {s.revision}</span></h4><p>{money(s.closing)} closing · Issued {new Date(s.issuedAt).toLocaleString()}</p><details><summary>Snapshot hash</summary><code>{s.hash}</code></details>{integrity[s.id] && <p className={integrity[s.id].valid ? 'positive' : 'error'} role="status">{integrity[s.id].valid ? 'Integrity verified' : 'Integrity failed — do not rely on this revision'}</p>}</div><div className="archive-actions"><button className="text-button" disabled={busy} onClick={() => pdf(s, true)}>{copy('originalPdfButton')}</button><button className="text-button" disabled={busy} onClick={() => pdf(s)}>{copy('brandedPdfButton')}</button><button className="text-button" disabled={busy} onClick={() => perform(async () => { const result = await api(`/admin/statements/${s.id}/integrity`); setIntegrity(i => ({ ...i, [s.id]: result })); })}>{copy('integrityButton')}</button></div></article>) : <p>No issued statements for this account.</p>}</section></>}

    {admin && tab === 'Projects' && <ProjectManager api={api} />}
    {admin && tab === 'Leadership bio' && <LeadershipManager api={api} />}
    {admin && tab === 'Investments' && <section className="panel"><div className="panel-heading"><h3>Investment records</h3><button className="button small" disabled={busy} onClick={() => setEdit({ type: 'investment' })}>Create record +</button></div><p className="fine-print">Manage investment information and strategy.</p><div className="investment-grid">{investments.map(i => <article className="investment-card" key={i.id}><span className="role-badge">{i.status}</span><h3>{i.sector}</h3><h4>{money(i.targetCapital)}</h4><span className="eyebrow">TARGET CAPITAL</span><p><strong>Risk:</strong> {i.risk}</p><p>{i.strategy}</p><button className="link-arrow" onClick={() => setEdit({ type: 'investment', item: i })}>Edit record ↗</button></article>)}</div>{!investments.length && <p>No investment records. Create a record to begin.</p>}</section>}

    {admin && tab === 'Audit' && <section className="panel"><h3>Operation audit trail</h3><div className="table-scroll"><table><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th></tr></thead><tbody>{audit.map(a => <tr key={a.id}><td>{a.createdAt || a.at || a.timestamp}</td><td>{a.action}</td><td>{a.actorId ?? 'Anonymous'}</td><td>{a.entity ?? a.targetId ?? a.target}</td><td><details><summary>View payload</summary><pre>{JSON.stringify(a.details, null, 2)}</pre></details></td></tr>)}</tbody></table></div>{!audit.length && <p>No audit records available.</p>}</section>}

    {editor && tab === 'Design & wording' && <SiteEditor api={api} />}
    {user.role === 'owner' && tab === 'Users & permissions' && <UserManager api={api} user={user} />}
    {editor && tab === 'Customer details' && data && <AccountEditor api={api} account={data.account} onSaved={()=>setRefresh(r=>r+1)} />}
    </div>{details&&<TransactionDetails api={api} transaction={details} copy={copy} onClose={()=>setDetails(null)} onSaved={async()=>{setData(await api(base));if(preview)setPreview(await api(`${base}/preview?month=${encodeURIComponent(month)}`));setNotice('Transaction details saved. Issue a new statement revision to include them.');}}/>}{edit && <Modal title={edit.type === 'post' ? 'Post a ledger entry.' : edit.type === 'reverse' ? `Reverse entry #${edit.item.id}.` : edit.item ? 'Edit investment record.' : 'Create investment record.'} onClose={() => !busy && setEdit(null)}>{error && <div className="error" role="alert">{error}</div>}{edit.type === 'investment' ? <form onSubmit={saveInvestment}><Field label="Sector" name="sector" defaultValue={edit.item?.sector || ''} required maxLength={100} list="investment-sectors" /><datalist id="investment-sectors">{['Startup technologies', 'Small data centers', 'REITs', 'New home builders'].map(v => <option key={v} value={v} />)}</datalist><Field label="Status" name="status" defaultValue={edit.item?.status || 'Review'} required maxLength={100} /><Field label="Target capital · USD" name="targetCapital" type="number" step="0.01" min="0" max="1000000000" defaultValue={edit.item ? edit.item.targetCapital / 100 : ''} required /><Field label="Risk" name="risk" defaultValue={edit.item?.risk || ''} required maxLength={200} /><label>Strategy<textarea name="strategy" defaultValue={edit.item?.strategy || ''} required maxLength={2000} rows={5} /></label><button className="button" disabled={busy}>{busy ? 'Saving…' : 'Save investment record ↗'}</button></form> : <form onSubmit={saveEntry}><p>{edit.type === 'reverse' ? `${edit.item.description} · ${money(edit.item.amount)}. A correction of ${money(-edit.item.amount)} will be recorded; the original remains unchanged.` : `Selected account: ${data?.account.name}. Positive amounts credit the account; negative amounts debit it.`}</p><Field label="Ledger date" name="date" type="date" defaultValue={today()} min={edit.type === 'reverse' ? edit.item.date : '1900-01-01'} required />{edit.type === 'reverse' ? <Field label="Reason for reversal" name="reason" required maxLength={250} /> : <><Field label="Description" name="description" required maxLength={300} /><Field label="Signed amount · USD" name="amount" type="number" step="0.01" required max="1000000000" min="-1000000000" /></>}<button className="button" disabled={busy}>{busy ? 'Recording…' : edit.type === 'reverse' ? 'Record reversal ↗' : 'Post transaction ↗'}</button></form>}</Modal>}</div>;

}


