'use strict';
const NAME = 'Silicon Valley Bank and Trust';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const nav = [
  ['/personal.html', 'Personal'],
  ['/business.html', 'Business'],
  ['/wealth.html', 'Wealth & Trust'],
  ['/security.html', 'Security'],
  ['/about.html', 'About'],
  ['/contact.html', 'Contact']
];

const cards = (items) =>
  `<div class="grid">${items.map(([t, d]) => `<article class="card"><h3>${t}</h3><p>${d}</p></article>`).join('')}</div>`;

const hero = (title, lead, cta = '') =>
  `<section class="hero"><div class="wrap"><h1>${title}</h1><p class="lead">${lead}</p>${cta}</div></section>`;

const section = (title, body, cls = '') => `<section class="section ${cls}"><div class="wrap"><h2>${title}</h2>${body}</section>`.replace('</section>', '</div></section>');

const pages = [
  {
    path: '/', file: 'index.html', title: 'Banking built for what is next',
    body: `<section class="hero hero-img"><div class="wrap">
      <h1>Banking built for what is next.</h1>
      <p class="lead">Personal banking, business lending and trust services from a bank that pairs modern technology with relationship-driven advice.</p>
      <p><a class="btn" href="/personal.html">Open an account</a> <a class="btn btn-ghost" href="/contact.html">Talk to a banker</a></p>
      </div></section>
      <section class="stats"><div class="wrap"><div><b>24/7</b><span>Digital banking</span></div><div><b>256-bit</b><span>Encryption in transit</span></div><div><b>FDIC</b><span>Deposit insurance, up to applicable limits</span></div><div><b>1:1</b><span>Dedicated relationship teams</span></div></div></section>
      ${section('Banking for every stage', cards([
        ['Personal', 'Checking, savings, mortgages and cards designed to be simple and fee-aware. <a href="/personal.html">Explore personal</a>'],
        ['Business', 'Operating accounts, treasury, credit and growth capital for ambitious companies. <a href="/business.html">Explore business</a>'],
        ['Wealth & Trust', 'Investment guidance, estate planning and fiduciary services. <a href="/wealth.html">Explore wealth</a>']
      ]))}
      ${section('Security you can trust', '<p>Multi-factor authentication, continuous fraud monitoring and strict access controls protect your accounts. <a href="/security.html">Learn how we protect you</a>.</p>', 'alt')}`
  },
  {
    path: '/personal.html', file: 'personal.html', title: 'Personal Banking',
    body: hero('Personal Banking', 'Everyday accounts and lending with clear terms and no surprises.') +
      section('Accounts & lending', cards([
        ['Everyday Checking', 'Mobile deposit, bill pay, Zelle-style transfers and fraud alerts included.'],
        ['High-Yield Savings', 'Competitive variable rates with automatic savings goals.'],
        ['Home Loans', 'Purchase and refinance options with local underwriting support.'],
        ['Credit Cards', 'Rewards and low-rate cards with real-time controls.'],
        ['Certificates of Deposit', 'Fixed terms from 3 to 60 months.'],
        ['Digital Banking', 'Manage money securely from any device.']
      ])) + section('Ready to start?', '<p><a class="btn" href="/contact.html?topic=personal">Contact a personal banker</a></p>', 'alt')
  },
  {
    path: '/business.html', file: 'business.html', title: 'Business Banking',
    body: hero('Business Banking', 'Financial infrastructure for startups, growth companies and established enterprises.') +
      section('Solutions', cards([
        ['Operating Accounts', 'Multi-user access, approvals and integrations with major accounting tools.'],
        ['Treasury & Cash Management', 'ACH, wires, sweep accounts and positive pay.'],
        ['Commercial Lending', 'Lines of credit, term loans and equipment finance.'],
        ['Venture & Growth Banking', 'Specialized teams that understand fast-moving companies.'],
        ['Merchant Services', 'Accept payments in person and online.'],
        ['International Services', 'Foreign exchange and cross-border payments.']
      ])) + section('Grow with us', '<p><a class="btn" href="/contact.html?topic=business">Speak with a business banker</a></p>', 'alt')
  },
  {
    path: '/wealth.html', file: 'wealth.html', title: 'Wealth & Trust',
    body: hero('Wealth & Trust', 'Fiduciary guidance to build, protect and transfer wealth across generations.') +
      section('Services', cards([
        ['Investment Management', 'Goals-based portfolios built with a disciplined, transparent process.'],
        ['Trust & Estate Services', 'Trustee, executor and administration services.'],
        ['Financial Planning', 'Retirement, tax-aware and education planning.'],
        ['Private Banking', 'Dedicated advisor and tailored credit solutions.']
      ])) + section('Plan your legacy', '<p>Investment products are not FDIC insured, are not bank guaranteed and may lose value.</p><p><a class="btn" href="/contact.html?topic=wealth">Schedule a consultation</a></p>', 'alt')
  },
  {
    path: '/security.html', file: 'security.html', title: 'Security Center',
    body: hero('Security Center', 'How we protect your money and information, and how you can help.') +
      section('Our commitments', cards([
        ['Encryption', 'Data is encrypted in transit using TLS and protected at rest.'],
        ['Multi-factor authentication', 'Additional verification for sign-in and sensitive actions.'],
        ['Fraud monitoring', 'Continuous monitoring and real-time alerts for unusual activity.'],
        ['Least-privilege access', 'Employees only access the information required for their role.']
      ])) + section('Stay safe', '<ul class="list"><li>We will never ask for your password or one-time codes by phone, text or email.</li><li>Verify the web address before entering credentials.</li><li>Use a unique password and enable multi-factor authentication.</li><li>Report suspicious activity right away via our <a href="/contact.html">contact page</a>.</li></ul>', 'alt')
  },
  {
    path: '/about.html', file: 'about.html', title: 'About Us',
    body: hero('About Silicon Valley Bank and Trust', 'The newest technology bank, built on lasting relationships.') +
      `<section class="section"><div class="wrap split"><div><h2>Our story</h2><p>Silicon Valley Bank and Trust combines modern technology with the personal service of a trusted community bank, serving individuals, innovators and businesses.</p><h2>Our values</h2><ul class="list"><li><b>Integrity</b> in every interaction.</li><li><b>Innovation</b> that makes banking easier.</li><li><b>Partnership</b> with the people we serve.</li></ul></div><img src="/assets/facade.jpg" alt="Silicon Valley Bank and Trust building with bank signage" loading="lazy" width="1920" height="1149"></div></section>`
  },
  {
    path: '/contact.html', file: 'contact.html', title: 'Contact Us',
    body: hero('Contact Us', 'Questions about accounts, lending or wealth services? Send us a message.') +
      `<section class="section"><div class="wrap split"><form id="contact-form" method="post" action="/api/contact" novalidate>
        <p id="form-status" class="status" role="status" aria-live="polite"></p>
        <label>Name<input name="name" required minlength="2" maxlength="100" autocomplete="name"></label>
        <label>Email<input name="email" type="email" required maxlength="200" autocomplete="email"></label>
        <label>Topic<select name="topic"><option value="personal">Personal banking</option><option value="business">Business banking</option><option value="wealth">Wealth &amp; trust</option><option value="other">Other</option></select></label>
        <label>Message<textarea name="message" rows="6" required minlength="10" maxlength="2000"></textarea></label>
        <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
        <p class="note">Do not include account numbers, passwords or other sensitive details.</p>
        <button class="btn" type="submit">Send message</button></form>
        <div><h2>Other ways to reach us</h2><p><b>Support:</b> contact the number on the back of your card for card or account emergencies.</p><p><b>Hours:</b> Monday - Friday, 9am - 5pm Pacific.</p><p><b>Report fraud:</b> contact us immediately through this form or your relationship banker.</p></div></div></section>`
  },
  {
    path: '/sign-in.html', file: 'sign-in.html', title: 'Online Banking',
    body: hero('Online Banking', 'Secure online banking enrollment is opening soon.') +
      '<section class="section"><div class="wrap"><p>To protect your accounts, sign-in is currently available by invitation. To enroll or get help, <a href="/contact.html">contact us</a>.</p></div></section>'
  },
  {
    path: '/404.html', file: '404.html', title: 'Page not found', hidden: true,
    body: hero('Page not found', 'The page you requested does not exist.', '<p><a class="btn" href="/">Return home</a></p>')
  }
];

function render(page) {
  const links = nav.map(([h, l]) => `<a href="${h}"${h === page.path ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title)} | ${NAME}</title>
<meta name="description" content="${NAME}: personal banking, business banking and wealth &amp; trust services.">
<meta name="theme-color" content="#0b2a4a"><link rel="icon" href="/assets/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/styles.css"></head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header"><div class="wrap bar"><a class="brand" href="/"><img src="/assets/logo.svg" alt="" width="36" height="36"><span>SVBT</span></a>
<button class="menu-btn" aria-expanded="false" aria-controls="nav">Menu</button>
<nav id="nav" aria-label="Main">${links}<a class="btn btn-sm" href="/sign-in.html">Online Banking</a></nav></div></header>
<main id="main">${page.body}</main>
<footer class="site-footer"><div class="wrap"><div class="cols"><div><b>${NAME}</b><p>The newest technology bank.</p></div>
<div><b>Banking</b>${nav.slice(0, 3).map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}</div>
<div><b>Company</b>${nav.slice(3).map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}</div></div>
<p class="legal">Deposit products are FDIC insured up to applicable limits. Investment and trust products are not FDIC insured, not bank guaranteed and may lose value. &copy; ${new Date().getFullYear()} ${NAME}. All rights reserved.</p></div></footer>
<script src="/assets/app.js" defer></script></body></html>`;
}

module.exports = { pages, render, nav };
