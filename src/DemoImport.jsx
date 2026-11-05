import { useState } from 'react';
import { Modal } from './App.jsx';

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((value || 0) / 100);

// Owner-only: flag an account as a demo, and import a cash-book CSV into it after a preview that
// must reconcile to the sheet's running cash. Statements for demo accounts are stamped as samples.
export default function DemoImport({ api, account, onChanged }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const base = `/admin/accounts/${account.id}`;

  async function run(task) { setBusy(true); setError(''); setNotice(''); try { await task(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  const toggle = () => run(async () => { await api(`${base}/demo`, { method: 'PUT', body: JSON.stringify({ demo: !account.demo }) }); onChanged(); });
  async function choose(e) { const file = e.target.files[0]; setPreview(null); setError(''); if (!file) return; setName(file.name); setCsv(await file.text()); }
  const check = () => run(async () => setPreview(await api(`${base}/import/preview`, { method: 'POST', body: JSON.stringify({ csv, year: year || undefined }) })));
  const post = () => run(async () => { const result = await api(`${base}/import`, { method: 'POST', body: JSON.stringify({ csv, year: year || undefined, fileHash: preview.fileHash }) }); setPreview(null); setCsv(''); setName(''); setOpen(false); setNotice(`Imported ${result.rows} entries. Closing balance ${money(result.closing)}.`); onChanged(); });

  return <section className="panel">
    <div className="panel-heading"><h3>Demo account {account.demo ? <span className="role-badge">DEMO</span> : null}</h3><span className="eyebrow">OWNER ONLY</span></div>
    <p className="fine-print">Demo accounts hold demonstration figures. Every statement PDF for a demo account is stamped "SAMPLE · NOT A BANK STATEMENT" on each page. An account that has received an import stays a demo account.</p>
    {error && !open && <div className="error" role="alert">{error}</div>}{notice && <div className="success" role="status">{notice}</div>}
    <div className="toolbar"><button className="text-button" disabled={busy} onClick={toggle}>{account.demo ? 'Remove demo flag' : 'Mark as demo account'}</button>{account.demo ? <button className="button small" disabled={busy} onClick={() => { setOpen(true); setError(''); }}>Import cash-book CSV +</button> : null}</div>
    {open && <Modal wide title="Import a cash-book CSV." onClose={() => !busy && setOpen(false)}>
      <p>Columns: Date, Payee, Description, Category, In / (out), Running cash. "Month YYYY" headings set the year; the first section uses the first heading's year unless you choose one. Every row must match the sheet's running cash, starting from this account's current balance of the ledger.</p>
      <label>CSV file<input type="file" accept=".csv,text/csv" onChange={choose} disabled={busy} /></label>
      <label>Year for rows before the first heading (optional)<input type="number" min="1900" max="9999" value={year} onChange={e => { setYear(e.target.value); setPreview(null); }} disabled={busy} /></label>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="button small" disabled={busy || !csv} onClick={check}>{busy && !preview ? 'Checking…' : `Preview ${name || 'file'}`}</button>
      {preview && <>
        <div className="stat-grid">{['opening', 'deposits', 'debits', 'closing'].map(k => <div key={k}><span>{k}</span><strong>{money(preview[k])}</strong></div>)}</div>
        <p>{preview.rows.length} entries from {preview.rows[0]?.date || '—'} to {preview.rows.at(-1)?.date || '—'}.</p>
        {preview.errors.length ? <div className="error" role="alert"><strong>{preview.errors.length} problem(s). Nothing will be imported until these are fixed.</strong><ul>{preview.errors.slice(0, 20).map(e => <li key={e.line + e.error}>Line {e.line}: {e.error}</li>)}</ul></div> : <p className="positive">Every row matches the sheet's running cash.</p>}
        <div className="table-scroll"><table><thead><tr><th>Line</th><th>Date</th><th>Description</th><th>Amount</th><th>Running</th></tr></thead><tbody>{preview.rows.map(r => <tr key={r.line}><td>{r.line}</td><td>{r.date}</td><td>{r.description}</td><td>{money(r.amount)}</td><td>{money(r.running)}</td></tr>)}</tbody></table></div>
        <button className="button" disabled={busy || preview.errors.length > 0 || !preview.rows.length} onClick={post}>{busy ? 'Importing…' : `Import ${preview.rows.length} entries ↗`}</button>
      </>}
    </Modal>}
  </section>;
}
