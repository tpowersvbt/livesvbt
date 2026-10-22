export const copyDefaults = {
  physicalAddress: '3003 Tasman Drive, Santa Clara, CA',
  "heroEyebrow": "A NEW PERSPECTIVE ON BUSINESS BANKING",
  "heroTitle": "Built for what comes next.",
  "heroText": "Ambitious ideas deserve a thoughtful financial foundation. Explore a banking experience shaped around the people building tomorrow.",
  "focusTitle": "Where ambition meets opportunity.",
  "focusText": "From a first idea to the infrastructure that makes it real. Four sectors. One disciplined perspective.",
  "sectorDisclosure": "Not investment advice, a financing commitment or an offer of securities. Investment involves risk.",
  "approachTitle": "Progress, with principle.",
  "approachText": "The future moves quickly. Your foundation should hold steady.",
  "ctaTitle": "See the bigger picture. Start with clarity.",
  "ctaNote": "Contact our team to discuss your account and investment needs.",
  "footerTagline": "A perspective for the next economy.",
  "disclosures": "Contact Silicon Valley Bank and Trust for information about available services, eligibility and applicable disclosures.",
  "depositDisclosure": "Silicon Valley Bank and Trust is not yet a chartered bank. Accounts and balances on this site are not FDIC-insured deposits.",
  "privacyTitle": "Privacy policy",
  "privacyText": "Our privacy policy is being finalized with legal counsel and will be published here before accounts open to the public. Questions about how we handle your information: contact Silicon Valley Bank and Trust.",
  "termsTitle": "Terms of use",
  "termsText": "Our terms of use are being finalized with legal counsel and will be published here before accounts open to the public. Questions: contact Silicon Valley Bank and Trust.",
  "forgotPasswordLink": "Forgot your password?",
  "forgotTitle": "Reset your password.",
  "forgotText": "Enter the email address for your account. If it has an account, we'll email a link to choose a new password.",
  "resetTitle": "Choose a new password.",
  "principle1Title": "Clarity at every step",
  "principle1Text": "A ledger-led workspace connects every transaction to the balance it creates. No hidden calculations. No invented performance.",
  "principle2Title": "Discipline by design",
  "principle2Text": "Recorded corrections preserve history. Issued statement revisions remain distinct from the live ledger.",
  "principle3Title": "People before process",
  "principle3Text": "A focused experience for founders, business owners and the operators behind the next economy.",
  "announcement": ""
};

export const interfaceDefaults = {
  bankName: 'Silicon Valley Bank and Trust', navProjects: 'Projects', navFocus: 'Our focus', navApproach: 'Our approach', navLeadership: 'Leadership', menu: 'Menu', loginButton: 'Log in', staffLoginButton: 'Staff login', registerButton: 'Create workspace', workspaceButton: 'Your workspace', heroButton: 'Explore your workspace', focusButton: 'Discover our focus', heroNote1: 'Human perspective.', heroNote2: 'Digital precision.', stripHeading: 'THE NEXT ECONOMY,', stripSubheading: 'FOUR CONNECTED PERSPECTIVES.', stripStartups: 'Startup technologies', stripData: 'Data centers', stripReits: 'Real estate', stripHomes: 'New home builders', focusEyebrow: '01 / OUR FOCUS', sectorButton: 'Explore sector', approachEyebrow: '02 / THE SVBT PERSPECTIVE', approachButton: 'Access your workspace', ctaEyebrow: 'YOUR NEXT CHAPTER / SVBT', ctaButton: 'Open your workspace', staffAccessButton: 'Staff access', footerOperations: 'Operations and account workspace', dialogEyebrow: 'SVBT / ACCOUNT ACCESS', registerTitle: 'A new beginning.', staffTitle: 'Operations access.', loginTitle: 'Welcome back.', registerText: 'Create your account workspace.', loginText: 'Sign in to your workspace.', businessNameLabel: 'Business / account name', addressLabel: 'Account address', emailLabel: 'Email', passwordLabel: 'Password', confirmPasswordLabel: 'Confirm password', passwordHelp: 'Use at least 12 characters and a unique password.', submitLoginButton: 'Sign in securely', authSwitchLogin: 'Already have an account? Log in', authSwitchRegister: 'New here? Create a workspace', sectorStaffNote: 'Investment records are available to authorized staff.', sectorWorkspaceButton: 'Explore workspace', projectsEyebrow: 'PROJECT DIRECTORY', projectsTitle: 'Projects & initiatives.', projectsText: 'Explore the projects selected for public listing.', projectsEmpty: 'No projects have been published yet.', projectsDisclosure: 'Project descriptions are supplied by the site operator. Listings are informational and do not constitute an offer of securities, a financing commitment, or a guarantee of returns.', projectCardEyebrow: 'PROJECT', projectDetailsButton: 'Read project details', leadershipEyebrow: 'ABOUT US / LEADERSHIP', logoutButton: 'Log out', postButton: 'Post transaction', reverseButton: 'Reverse', issueButton: 'Issue statement revision', previewButton: 'Calculate preview', originalPdfButton: 'Original PDF', brandedPdfButton: 'Download branded PDF', integrityButton: 'Check integrity', statementTitle: 'Statement preparation', archiveTitle: 'Issued statement archive', statementNotesTitle: 'Statement notes', transactionDetailsButton: 'Edit details', statementNotesLabel: 'Notes to include in the statement', statementNotesSave: 'Save statement notes', transactionReferenceLabel: 'Transaction reference ID', transactionTimeLabel: 'Transaction date and time', transactionNotesLabel: 'Transaction notes', transactionDetailsSave: 'Save transaction details'
};
Object.assign(copyDefaults, interfaceDefaults);
export const themeDefaults = {
  'theme.buttonBackground': '#ce9c79', 'theme.buttonText': '#101822', 'theme.buttonHover': '#e1b898', 'theme.buttonHoverText': '#07111e', 'theme.accent': '#ce9c79', 'theme.background': '#07111e', 'theme.panel': '#0d1b2a', 'theme.text': '#e8f0f3', 'theme.muted': '#95a7b8', 'theme.border': '#304353', 'theme.inputBackground': '#091522', 'theme.inputText': '#dfecf3', 'theme.focus': '#b7dfe9', 'theme.linkText': '#d2dde3'
};
export const themeVariables = {
  'theme.buttonBackground': '--button-background', 'theme.buttonText': '--button-text', 'theme.buttonHover': '--button-hover', 'theme.buttonHoverText': '--button-hover-text', 'theme.accent': '--copper', 'theme.background': '--navy', 'theme.panel': '--panel', 'theme.text': '--text', 'theme.muted': '--muted', 'theme.border': '--border', 'theme.inputBackground': '--input-background', 'theme.inputText': '--input-text', 'theme.focus': '--ice', 'theme.linkText': '--link-text'
};

export const statementDefaults = {'statement.address':'3003 Tasman Drive, Santa Clara, CA','statement.bankName':'Silicon Valley Bank and Trust','statement.heading':'BUSINESS CHECKING STATEMENT','statement.notice':'ACCOUNT RECORD - No real funds','statement.notesHeading':'STATEMENT NOTES'};
Object.assign(copyDefaults, statementDefaults);
for (const tab of ['Overview','Transactions','Statements','Projects','Leadership bio','Investments','Design & wording','Customer details','Users & permissions','Audit','Profile','Account details','Transfers']) copyDefaults['tab.'+tab.replaceAll(' ','_').replace('&','and')] = tab;
Object.assign(copyDefaults,{workspaceTitle:'Your financial perspective.',operationsLabel:'OPERATIONS CONSOLE',businessLabel:'BUSINESS WORKSPACE'});
