/* SVBT EXTERNAL TRANSFERS — customer button + moderator review.
 * Self-contained: only React + the `api` helper the Portal already has.
 */
import { useEffect, useState } from 'react';
import { Modal } from './App.jsx';

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((value || 0) / 100);

// 9-digit ABA routing checksum, mirrored from server/external.js so typos are
// caught before the request even leaves the browser.
export function routeValid(value) {
  if (!/^\d{9}$/.test(String(value))) return false;
  const d = [...String(value)].map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

function cents(value) {
  if (!/^-?\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Enter a USD amount with no more than two decimal places.');
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result)) throw new Error('Amount is outside the supported range.');
  return result;
}

function requestId() {
  return 'ext-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const statusClass = status => status === 'settled' ? 'positive' : status === 'returned' || status === 'failed' ? 'error' : 'muted';

export function ExternalTransfers({ api, busy, perform, setError, setNotice }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ bankName: '', nickname: '', accountNumber: '', routingNumber: '', amount: '', memo: '', pin: '' });
  const [idempotency] = useState(requestId);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api('/external').then(v => active && setState(v)).catch(e => active && setError(e.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [api, setError]);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const routingOk = form.routingNumber.length === 9 ? routeValid(form.routingNumber) : null;

  async function submit(e) {
    e.preventDefault();
    const values = form;
    await perform(async () => {
      const sent = await api('/external/transfer', {
        method: 'POST',
        body: JSON.stringify({
          pin: values.pin,
          amount: cents(values.amount),
          description: values.memo,
          requestId: idempotency,
          bank: {
            name: values.bankName,
            nickname: values.nickname,
            accountNumber: values.accountNumber,
            routingNumber: values.routingNumber,
          },
        }),
      });
      setOpen(false);
      setState(await api('/external'));
      return sent;
    }, `Sent ${money(cents(values.amount))} to ${values.bankName} ....${values.accountNumber.slice(-4)}. Reference issued.`);
  }

  return <>{state && <>
    <div className="toolbar">
      <div>
        <span className="eyebrow">EXTERNAL RAIL / {state.rail.partner.toUpperCase()}</span>
        <p className="fine-print">Routing {state.rail.routingElectronic} · Settlement {state.rail.accountNumber}<br />
          Sent today {money(state.sentToday)} of {money(state.dailyLimit)} daily limit.</p>
      </div>
      <button className="button small" disabled={busy} onClick={() => { setForm({ bankName: '', nickname: '', accountNumber: '', routingNumber: '', amount: '', memo: '', pin: '' }); setOpen(true); }}>Send money out +</button>
    </div>
    <section className="panel">
      <h3>Outbound transfers</h3>
      <p className="fine-print">Funds leave your SVBT account immediately and settle to your external bank over the SVBT ⇄ {state.rail.partner} rail.</p>
      <div className="table-scroll"><table>
        <thead><tr><th>Date</th><th>Bank</th><th>Account</th><th>Reference</th><th className="numeric">Amount</th><th>Status</th></tr></thead>
        <tbody>{state.externalAccounts.length ? state.externalAccounts.map(t => <tr key={t.id}>
          <td className="nowrap">{t.date}</td>
          <td>{t.bankName}<small className="transaction-id">{t.description || t.nickname}</small></td>
          <td className="nowrap">....{t.accountEnding}<small className="transaction-id">Routing {t.routingNumber}</small></td>
          <td className="nowrap">{t.reference}</td>
          <td className="numeric">{money(t.amount)}</td>
          <td><span className={statusClass(t.status)}>{t.status}</span></td>
        </tr>) : <tr><td colSpan={6} className="empty">No outbound transfers yet.</td></tr>}</tbody>
      </table></div>
    </section>
  </>}
    {open && <Modal title="Send money out." onClose={() => !busy && setOpen(false)}>
      <p>Funds are debited from your SVBT account now and settle to your external bank over the {state?.rail.partner} rail.</p>
      <form onSubmit={submit}>
        <label>Bank name<input value={form.bankName} onChange={e => set('bankName', e.target.value)} required maxLength={80} placeholder="Bank of America" /></label>
        <label>Nickname (optional)<input value={form.nickname} onChange={e => set('nickname', e.target.value)} maxLength={60} placeholder="BofA – Payroll" /></label>
        <label>Routing number (9 digits)<input value={form.routingNumber} onChange={e => set('routingNumber', e.target.value.replace(/\D/g, '').slice(0, 9))} inputMode="numeric" required placeholder="026009593" />
          {routingOk === false && <small className="error">Not a valid US routing number.</small>}
          {routingOk === true && <small className="positive">Valid routing number.</small>}</label>
        <label>Account number (4–17 digits)<input value={form.accountNumber} onChange={e => set('accountNumber', e.target.value.replace(/\D/g, '').slice(0, 17))} inputMode="numeric" required /></label>
        <label>Amount – USD<input value={form.amount} onChange={e => set('amount', e.target.value)} inputMode="decimal" required placeholder="250.00" /></label>
        <label>Memo (optional)<input value={form.memo} onChange={e => set('memo', e.target.value)} maxLength={140} placeholder="Invoice 1042" /></label>
        <label>6-digit transfer PIN<input value={form.pin} onChange={e => set('pin', e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" required minLength={6} autoComplete="off" /></label>
        <button className="button" disabled={busy || routingOk === false}>{busy ? 'Sending…' : 'Send external transfer →'}</button>
      </form>
    </Modal>}
  </>;
}

export function ExternalQueue({ api, busy, perform, setError }) {
  const [queue, setQueue] = useState(null);
  useEffect(() => { let a = true; api('/admin/external').then(v => a && setQueue(v)).catch(e => a && setError(e.message)); return () => { a = false; }; }, [api, setError]);
  if (!queue) return null;
  return <section className="panel">
    <div className="panel-heading"><h3>External settlement queue</h3><span>{queue.count} pending → {queue.pending[0]?.routingNumber === '026009593' ? 'BofA' : 'external'}</span></div>
    <p className="fine-print">Release each item in the BofA portal, then mark it settled. A return puts the money back on the customer's account automatically.</p>
    <div className="table-scroll"><table>
      <thead><tr><th>Date</th><th>Ref</th><th>Bank / account</th><th className="numeric">Amount</th><th>Action</th></tr></thead>
      <tbody>{queue.pending.length ? queue.pending.map(t => <tr key={t.id}>
        <td className="nowrap">{t.date}</td><td className="nowrap">{t.reference}</td>
        <td>{t.bankName}<small className="transaction-id">....{t.accountEnding} · routing {t.routingNumber}</small></td>
        <td className="numeric">{money(t.amount)}</td>
        <td>
          <button className="text-button" disabled={busy} onClick={() => perform(async () => { await api(`/admin/external/${t.id}/settle`, { method: 'POST', body: JSON.stringify({ status: 'settled' }) }); setQueue(await api('/admin/external')); }, `Transfer ${t.reference} marked settled.`)}>Settle</button>
          {' · '}
          <button className="text-button" disabled={busy} onClick={() => perform(async () => { await api(`/admin/external/${t.id}/settle`, { method: 'POST', body: JSON.stringify({ status: 'returned' }) }); setQueue(await api('/admin/external')); }, `Transfer ${t.reference} returned – funds restored.`)}>Return</button>
        </td>
      </tr>) : <tr><td colSpan={5} className="empty">Nothing pending.</td></tr>}</tbody>
    </table></div>
  </section>;
}
