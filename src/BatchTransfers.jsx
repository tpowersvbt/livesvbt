import { useState } from 'react';

const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
export default function BatchTransfers({api,onSent}) {
  const [rows,setRows]=useState(''), [preview,setPreview]=useState(null), [pin,setPin]=useState('');
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID()), [busy,setBusy]=useState(false), [message,setMessage]=useState(''), [error,setError]=useState('');
  function review(e) {
    e.preventDefault(); setError(''); setMessage('');
    try {
      const transfers=rows.trim().split(/\r?\n/).map(line=>{
        const [number,amount,...memo]=line.split(',');
        const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec((amount||'').trim());
        const cents=match?Number(match[1])*100+Number((match[2]||'').padEnd(2,'0')):NaN;
        if(!/^\d{12}$/.test(number.trim())||!Number.isSafeInteger(cents)||cents<=0||cents>100000000000) throw new Error('Use a 12-digit account number and a positive USD amount on each line.');
        const description=memo.join(',').trim();
        if(description.length>140)throw new Error('Each memo must be at most 140 characters.');
        return {toAccountNumber:number.trim(),amount:cents,description};
      });
      if(transfers.length>100)throw new Error('Use at most 100 transfers per batch.');
      setRequestId(crypto.randomUUID()); setPreview(transfers);
    } catch(e){setError(e.message);}
  }
  async function send(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const result=await api('/transfers/batch',{method:'POST',body:JSON.stringify({requestId,pin,transfers:preview})});
      setMessage(`Completed ${result.transfers.length} internal transfers. No external settlement was performed.`);
      setPreview(null);setRows('');setPin('');onSent();
    } catch(e){setError(e.message);} finally{setBusy(false);}
  }
  return <section className="panel"><h3>Batch internal transfers</h3><p>Send 1–100 transfers between accounts here. Every row succeeds together or the entire batch is rolled back. Your daily limit applies to the combined amount.</p>
    {error&&<p className="error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!preview?<form onSubmit={review}><label>One transfer per line: account number, USD amount, optional memo<textarea value={rows} onChange={e=>setRows(e.target.value)} rows={5} required maxLength={24000}/></label><button className="button">Review batch</button></form>:<form onSubmit={send}>
      <p>{preview.length} transfers · Total {money(preview.reduce((n,t)=>n+t.amount,0))}</p>
      <table><thead><tr><th>Recipient</th><th>Amount</th><th>Memo</th></tr></thead><tbody>{preview.map((t,i)=><tr key={i}><td>{t.toAccountNumber}</td><td>{money(t.amount)}</td><td>{t.description}</td></tr>)}</tbody></table>
      <label>Confirm with your transfer PIN<input type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} value={pin} onChange={e=>setPin(e.target.value)} required autoComplete="off"/></label>
      <button className="button" disabled={busy}>{busy?'Sending…':'Confirm entire batch'}</button><button type="button" disabled={busy} onClick={()=>{setPreview(null);setPin('');}}>Edit batch</button>
    </form>}
  </section>;
}
