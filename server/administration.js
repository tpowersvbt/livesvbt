import { themeDefaults } from '../src/site-copy.js';
import { atomic, audit, hashPassword, newAccount, publicPasswords } from './db.js';
import { fail, text, updateTransactionDetails, statementNotes, saveStatementNotes } from './services.js';

export function initializeAdministration(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS staff_access(userId INTEGER PRIMARY KEY REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('owner','admin')));
    CREATE TABLE IF NOT EXISTS site_content(id INTEGER PRIMARY KEY CHECK(id=1), overrides TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1);`);
  db.prepare('INSERT OR IGNORE INTO site_content(id) VALUES (1)').run();
}

export function effectiveUser(db, user) {
  return user ? { ...user, role: db.prepare('SELECT role FROM staff_access WHERE userId=?').get(user.id)?.role || user.role } : null;
}

export function provisionHandoverOwner(db, email) {
  if (!email || db.prepare("SELECT value FROM metadata WHERE key='owner-handover-v1'").get()) return;
  const user = db.prepare('SELECT id,role FROM users WHERE email=?').get(email.trim().toLowerCase());
  if (!user) return;
  if (user.role !== 'moderator') throw new Error('Handover owner must be an existing staff account.');
  atomic(db, () => {
    db.prepare("INSERT OR REPLACE INTO staff_access(userId,role) VALUES (?,'owner')").run(user.id);
    db.prepare("INSERT INTO metadata(key,value) VALUES ('owner-handover-v1',?)").run(String(user.id));
    audit(db, user.id, 'owner.handover', user.id);
  });
}

export function installAdministration(app, db, authenticate) {
  const owner = (req, res, next) => req.user.role === 'owner' ? next() : next(Object.assign(new Error('Owner permission is required.'), { status: 403 }));
  const editor = (req, res, next) => ['owner','admin'].includes(req.user.role) ? next() : next(Object.assign(new Error('Administrator permission is required.'), { status: 403 }));
  const list = () => db.prepare('SELECT id,email,name,address,role FROM users ORDER BY id').all().map(u => effectiveUser(db,u));
  app.get('/api/admin/users', owner, (req,res) => res.json(list()));
  app.post('/api/admin/users', owner, async (req,res) => {
    const v = req.body, email = text(v.email,'Email',254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'A valid email is required.');
    if (!['customer','moderator','admin','owner'].includes(v.role)) fail(400,'Invalid role.');
    const name=text(v.name,'Name',200), address=text(v.address,'Address',500);
    if (typeof v.password !== 'string' || v.password.length < 12 || v.password.length > 1024) fail(400,'Use a password of 12–1024 characters.');
    if (publicPasswords.has(v.password)) fail(400,'Choose a password that has not been published.');
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409,'This email is already registered.');
    const hash=await authenticate(() => hashPassword(v.password),res);
    const id=atomic(db,()=>{
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409,'This email is already registered.');
      const id=Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(email,name,address,v.role==='customer'?'customer':'moderator',hash).lastInsertRowid);
      if (['admin','owner'].includes(v.role)) db.prepare('INSERT INTO staff_access(userId,role) VALUES (?,?)').run(id,v.role);
      if(v.role==='customer') newAccount(db,id,name,address);
      audit(db,req.user.id,'user.create',id,{role:v.role}); return id;
    });
    res.status(201).json(list().find(u=>u.id===id));
  });
  app.patch('/api/admin/users/:id', owner, (req,res)=>{
    const id=Number(req.params.id),role=req.body.role;
    if(!Number.isSafeInteger(id)||!['customer','moderator','admin','owner'].includes(role)) fail(400,'Invalid user or role.');
    atomic(db,()=>{
      const target=effectiveUser(db,db.prepare('SELECT * FROM users WHERE id=?').get(id));
      if(!target)fail(404,'User not found.');
      if(id===req.user.id && role!=='owner')fail(409,'Another owner must change your access.');
      if(target.role==='owner' && role!=='owner' && db.prepare("SELECT count(*) n FROM staff_access WHERE role='owner'").get().n<=1)fail(409,'At least one owner must remain.');
      db.prepare('UPDATE users SET role=? WHERE id=?').run(role==='customer'?'customer':'moderator',id);
      db.prepare('DELETE FROM staff_access WHERE userId=?').run(id);
      if(['admin','owner'].includes(role))db.prepare('INSERT INTO staff_access(userId,role) VALUES (?,?)').run(id,role);
      if(role==='customer'&&!db.prepare('SELECT id FROM accounts WHERE userId=?').get(id))newAccount(db,id,target.name,target.address);
      db.prepare('DELETE FROM sessions WHERE userId=?').run(id);
      audit(db,req.user.id,'user.role',id,{from:target.role,to:role});
    });
    res.json(list().find(u=>u.id===id));
  });
  app.patch('/api/admin/accounts/:id',editor,(req,res)=>{
    const id=Number(req.params.id), name=text(req.body.name,'Name',200),address=text(req.body.address,'Address',500), number=req.body.number;
    if(!/^\d{12}$/.test(number))fail(400,'Account number must be 12 digits.');
    atomic(db,()=>{
      const row=db.prepare('SELECT * FROM accounts WHERE id=?').get(id);if(!row)fail(404,'Account not found.');
      if(db.prepare('SELECT id FROM accounts WHERE number=? AND id!=?').get(number,id))fail(409,'Account number is already assigned.');
      db.prepare('UPDATE accounts SET name=?,address=?,number=? WHERE id=?').run(name,address,number,id);
      db.prepare('UPDATE users SET name=?,address=? WHERE id=?').run(name,address,row.userId);
      audit(db,req.user.id,'account.update',id);
    });res.json({ok:true});
  });
  app.put('/api/admin/transactions/:id/details',editor,(req,res)=>res.json(updateTransactionDetails(db,Number(req.params.id),req.body,req.user.id)));
  app.get('/api/admin/accounts/:id/statement-notes',editor,(req,res)=>res.json(statementNotes(db,Number(req.params.id),req.query.month)));
  app.put('/api/admin/accounts/:id/statement-notes',editor,(req,res)=>res.json(saveStatementNotes(db,Number(req.params.id),req.body,req.user.id)));
  app.get('/api/admin/site-content',editor,(req,res)=>res.json(siteContent(db)));
  app.put('/api/admin/site-content',editor,(req,res)=>{
    const {overrides,version}=req.body;
    if(!overrides||Array.isArray(overrides)||typeof overrides!=='object'||Object.keys(overrides).length>300)fail(400,'Invalid content.');
    for(const [key,value] of Object.entries(overrides))if(!/^[a-zA-Z0-9_.-]{1,100}$/.test(key)||typeof value!=='string'||value.length>6000)fail(400,'Invalid content field.');
    if(Object.hasOwn(overrides,'depositDisclosure')&&!overrides.depositDisclosure.trim())fail(400,'The deposit disclosure can be reworded but not left blank.');
    for(const [key,value] of Object.entries(overrides)) if(key.startsWith('theme.') && (!(key in themeDefaults)||!/^#[0-9a-f]{6}$/i.test(value))) fail(400,'Choose a valid six-digit color.');
    atomic(db,()=>{
      if(siteContent(db).version!==version)fail(409,'Content changed. Reload before saving.');
      db.prepare('UPDATE site_content SET overrides=?,version=version+1 WHERE id=1').run(JSON.stringify(overrides));
      audit(db,req.user.id,'site.publish',1);
    });res.json(siteContent(db));
  });
}
export function siteContent(db){const row=db.prepare('SELECT * FROM site_content WHERE id=1').get();return {overrides:JSON.parse(row.overrides),version:row.version};}
