import { useEffect, useState } from 'react';
import BatchTransfers from './BatchTransfers.jsx';

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((value || 0) / 100);
function cents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value).trim())) throw new Error('Enter a positive USD amount with no more than two decimal places.');
  const [whole,fraction=''] = String(value).trim().split('.');
  const result = Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('Enter an amount greater than zero.');
  return result;
}

export default function Transfers({ api, balance, onSent }) {
  const [summary, setSummary] = useState(null);
  const [changingPin, setChangingPin] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    api('/transfers').then(v => active && setSummary(v)).catch(e => active && setError(e.message));
    return () => { active = false; };
  }, [api, refresh]);
  async function run(task, message) {
    setBusy(true); setError(''); setNotice('');
    try { setNotice((await task()) || message); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function savePin(e) {
    e.preventDefault(); const form = e.currentTarget, values = Object.fromEntries(new FormData(form));
    run(async () => {
      if (values.pin !== values.confirmPin) throw new Error('The two PINs do not match.');
      setSummary(await api('/transfer-pin', { method: 'PUT', body: JSON.stringify({ password: values.password, pin: values.pin }) }));
      form.reset(); setChangingPin(false);
    }, 'Transfer PIN saved.');
  }
  function send(e) {
    e.preventDefault(); const form = e.currentTarget, values = Object.fromEntries(new FormData(form));
    run(async () => {
      const result = await api('/transfers', { method: 'POST', body: JSON.stringify({ toAccountNumber: values.toAccountNumber.replace(/\D/g, ''), amount: cents(values.amount), description: values.description, pin: values.pin, requestId }) });
      form.reset(); setRequestId(crypto.randomUUID()); setRefresh(r => r + 1); onSent();
      return `Sent ${money(result.amount)} to ${result.counterparty} …${result.counterpartyEnding}.`;
    }, '');
  }
  if (!summary) return <>{error && <div className="error" role="alert">{error}</div>}<p role="status">Loading transfers…</p></>;
  const remaining = Math.max(0, summary.dailyLimit - summary.sentToday);
  return <>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="success" role="status">{notice}</div>}
    {(!summary.pinSet || changingPin) ? <section className="panel profile-panel"><h3>{summary.pinSet ? 'Change transfer PIN' : 'Set a transfer PIN'}</h3><p>Every transfer needs this 6-digit PIN. Confirm your login password to {summary.pinSet ? 'change' : 'set'} it. Repeated digits and straight sequences are not accepted.</p><form onSubmit={savePin}>
      <label>New 6-digit PIN<input name="pin" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="off" /></label>
      <label>Confirm PIN<input name="confirmPin" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="off" /></label>
      <label>Current password for verification<input name="password" type="password" required autoComplete="current-password" /></label>
      <button className="button" disabled={busy}>{busy ? 'Verifying…' : 'Save PIN ↗'}</button>{summary.pinSet && <button type="button" className="text-button" onClick={() => setChangingPin(false)}>Cancel</button>}
    </form></section> : <section className="panel profile-panel"><div className="panel-heading"><h3>Send money to another SVBT account</h3><button className="text-button" onClick={() => setChangingPin(true)}>Change PIN</button></div>
      <p>Available balance {money(balance)}. You can send {money(remaining)} more today (daily limit {money(summary.dailyLimit)}).</p>
      {summary.lockedUntil ? <p className="error" role="alert">Transfers are locked after too many incorrect PINs until {new Date(summary.lockedUntil).toLocaleTimeString()}.</p> : <form onSubmit={send}>
        <label>Recipient account number<input name="toAccountNumber" inputMode="numeric" pattern="[\d\s-]{12,20}" required autoComplete="off" /></label>
        <label>Amount · USD<input name="amount" type="number" step="0.01" min="0.01" required /></label>
        <label>Memo · optional<input name="description" maxLength={140} /></label>
        <label>Transfer PIN<input name="pin" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="off" /></label>
        <button className="button" disabled={busy}>{busy ? 'Sending…' : 'Send transfer ↗'}</button>
      </form>}
    </section>}
    {summary.pinSet && !changingPin && !busy && <BatchTransfers api={api} onSent={() => { setRefresh(r => r + 1); onSent(); }} />}<section className="panel"><h3>Transfer history</h3><div className="table-scroll"><table><thead><tr><th>Date</th><th>Details</th><th className="numeric">Amount</th></tr></thead><tbody>{summary.transfers.length ? summary.transfers.map(t => <tr key={t.id}><td className="nowrap">{t.date}</td><td>{t.direction === 'sent' ? 'To' : 'From'} {t.counterparty} …{t.counterpartyEnding}{t.description && <small className="transaction-id">{t.description}</small>}</td><td className={`numeric ${t.direction === 'received' ? 'positive' : ''}`}>{money(t.direction === 'sent' ? -t.amount : t.amount)}</td></tr>) : <tr><td colSpan={3} className="empty">No transfers yet.</td></tr>}</tbody></table></div></section>
  </>;
}
