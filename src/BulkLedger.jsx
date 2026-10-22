import { useState } from 'react';

export default function BulkLedger({api,accountId,onPosted}) {
  const [rows,setRows]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function post(e) {
    e.preventDefault();setBusy(true);setError('');setNotice('');
    try {
      const result=await api(`/admin/accounts/${accountId}/transactions/bulk`,{method:'POST',body:JSON.stringify({rows})});
      setNotice(`Recorded ${result.length} ledger entries. This records internal account activity; it does not move external funds.`);setRows('');onPosted();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <details className="panel"><summary>Bulk ledger posting</summary><p>Paste 1–2000 CSV rows: date (YYYY-MM-DD), description, signed USD amount. All rows are validated and recorded together. Original entries remain immutable.</p>
    {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <form onSubmit={post}><label>Ledger CSV<textarea rows={5} value={rows} onChange={e=>setRows(e.target.value)} required maxLength={500000}/></label><button className="button" disabled={busy||!accountId}>{busy?'Recording…':'Record ledger rows'}</button></form>
  </details>;
}
