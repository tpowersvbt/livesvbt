import { test, expect } from '@playwright/test';

test('supplied logo is visible in header and footer on desktop and mobile',async({page})=>{
  await page.goto('/');
  const logo=page.locator('.site-header img.brand-logo');
  await expect(logo).toHaveAttribute('src','/svbt-logo.jpg');
  await expect(logo).toBeVisible();
  expect(await logo.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await page.screenshot({path:'../../outputs/svbt-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(logo).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'../../outputs/svbt-mobile.png',fullPage:true});
  await expect(page.locator('.site-footer img.brand-logo')).toHaveAttribute('src','/svbt-logo.jpg');
});

test('batch transfer form rolls back invalid recipients and completes a reviewed PIN-protected batch',async({page,playwright})=>{
  const recipient=await playwright.request.newContext({baseURL:'http://localhost:3005'});
  let recipientNumber;
  try {
    const session=await (await recipient.get('/api/session')).json();
    const response=await recipient.post('/api/register',{headers:{Origin:'http://localhost:3005','X-CSRF-Token':session.csrfToken},data:{email:'ui-recipient@example.test',password:'Local-recipient-unique-2026',name:'Local recipient',address:'Test address'}});
    expect(response.status()).toBe(201);
    recipientNumber=(await (await recipient.get('/api/account')).json()).account.number;
  } finally {await recipient.dispose();}
  // Give this test its own funded sender so later tests retain the original sample ledger.
  const sender=await playwright.request.newContext({baseURL:'http://localhost:3005'});
  let senderId;
  try {
    const session=await (await sender.get('/api/session')).json();
    const response=await sender.post('/api/register',{headers:{Origin:'http://localhost:3005','X-CSRF-Token':session.csrfToken},data:{email:'ui-sender@example.test',password:'Local-sender-unique-2026',name:'Local sender',address:'Test address'}});
    expect(response.status()).toBe(201);senderId=(await (await sender.get('/api/account')).json()).account.id;
  } finally {await sender.dispose();}
  const staff=await playwright.request.newContext({baseURL:'http://localhost:3005'});
  try {
    const session=await (await staff.get('/api/session')).json();
    const login=await staff.post('/api/login',{headers:{Origin:'http://localhost:3005','X-CSRF-Token':session.csrfToken},data:{email:'tpower@siliconvalleybankandtrust.com',password:'ModeratorGod!2026'}});
    const token=(await login.json()).csrfToken;
    const funding=await staff.post(`/api/admin/accounts/${senderId}/transactions`,{headers:{Origin:'http://localhost:3005','X-CSRF-Token':token},data:{date:'2026-10-21',description:'Local test fixture funding',amount:10000,requestId:crypto.randomUUID()}});
    expect(funding.status()).toBe(201);
  }finally{await staff.dispose();}
  await page.goto('/');
  await page.getByRole('button',{name:'Log in',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill('ui-sender@example.test');
  await page.getByLabel('Password',{exact:true}).fill('Local-sender-unique-2026');
  await page.getByRole('button',{name:/Sign in securely/}).click();
  await page.getByRole('button',{name:/^Transfers/}).click();
  await page.getByLabel('Current password for verification').fill('Local-sender-unique-2026');
  await page.getByLabel('New 6-digit PIN').fill('482916');
  await page.getByLabel('Confirm PIN').fill('482916');
  await page.getByRole('button',{name:'Save PIN ↗'}).click();
  await expect(page.getByRole('heading',{name:'Send money to another SVBT account'})).toBeVisible();
  await page.getByLabel('One transfer per line: account number, USD amount, optional memo').fill(`${recipientNumber},12.34,Test memo\n987654321012,0.10,Second memo`);
  await page.getByRole('button',{name:'Review batch'}).click();
  await expect(page.getByText('2 transfers · Total $12.44')).toBeVisible();
  await page.getByLabel('Confirm with your transfer PIN').fill('482916');
  await page.getByRole('button',{name:'Confirm entire batch'}).click();
  await expect(page.getByText('Recipient account not found.',{exact:true})).toBeVisible();
  await expect(page.getByText('No transfers yet.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit batch',exact:true}).click();
  await page.getByLabel('One transfer per line: account number, USD amount, optional memo').fill(`${recipientNumber},12.34,Test memo\n${recipientNumber},0.10,Second memo`);
  await page.getByRole('button',{name:'Review batch'}).click();
  await page.getByLabel('Confirm with your transfer PIN').fill('482916');
  await page.getByRole('button',{name:'Confirm entire batch'}).click();
  await expect(page.getByText('Completed 2 internal transfers. No external settlement was performed.',{exact:true})).toBeVisible();
  await expect(page.getByText('Test memo',{exact:true})).toBeVisible();
});
