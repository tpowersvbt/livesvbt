import { copyDefaults } from './site-copy.js';
import { useEffect, useState } from 'react';

function ProjectCard({ project, copy = key => copyDefaults[key] }) {
  return <article className="panel project-card"><span className="eyebrow">{copy('projectCardEyebrow')}</span><h3>{project.title}</h3><p>{project.summary}</p><details><summary>{copy('projectDetailsButton')}</summary><p className="project-description">{project.description}</p></details></article>;
}
export function PublicProjects({copy = key => copyDefaults[key]}) {
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/projects', { signal: controller.signal, cache: 'no-store' }).then(async r => { if (!r.ok) throw new Error('Project listings are temporarily unavailable.'); return r.json(); }).then(setProjects).catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  return <section id="projects" className="section"><div className="section-heading"><div><span className="eyebrow">{copy('projectsEyebrow')}</span><h2>{copy('projectsTitle')}</h2></div><p>{copy('projectsText')}</p></div>{loading ? <p role="status">Loading projects…</p> : error ? <p role="alert">{error}</p> : projects.length ? <div className="project-grid">{projects.map(p => <ProjectCard key={p.id} project={p} copy={copy} />)}</div> : <p>{copy('projectsEmpty')}</p>}<p className="fine-print">{copy('projectsDisclosure')}</p></section>;
}
const empty = { title: '', summary: '', description: '', privateNotes: '' };
export default function ProjectManager({ api }) {
  const [projects, setProjects] = useState([]);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  async function reload() { setProjects(await api('/admin/projects')); }
  useEffect(() => { let active = true; api('/admin/projects').then(rows => { if (active) setProjects(rows); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [api]);
  async function perform(task) { setBusy(true); setError(''); setNotice(''); try { await task(); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  async function save(e) { e.preventDefault(); await perform(async () => { await api(`/admin/projects${editing.id ? `/${editing.id}` : ''}`, { method: editing.id ? 'PUT' : 'POST', body: JSON.stringify({ title: editing.title, summary: editing.summary, description: editing.description, privateNotes: editing.privateNotes, version: editing.version }) }); setEditing(null); await reload(); setNotice('Draft saved. Use Preview & publish to make it public.'); }); }
  async function publish(row, action) { await perform(async () => { await api(`/admin/projects/${row.id}/${action}`, { method: 'POST', body: JSON.stringify({ version: row.version }) }); setPreview(null); await reload(); setNotice(action === 'publish' ? 'Project published in the public directory.' : 'Project unpublished. Its draft is still available here.'); }); }
  return <section className="panel"><div className="panel-heading"><h3>Projects</h3><button className="button small" disabled={busy || !!editing} onClick={() => { setEditing({ ...empty }); setPreview(null); setNotice(''); }}>New project +</button></div><p>Drafts and private notes are visible to all moderators. Publish only the project details you want anyone to read. Saving edits does not change an existing public listing until you publish again.</p>{error && <div role="alert" className="error">{error}<button className="text-button" disabled={busy} onClick={() => perform(reload)}>Reload projects</button></div>}{notice && <p role="status" className="success">{notice}</p>}{editing && <form onSubmit={save} className="project-editor"><h4>{editing.id ? 'Edit project draft' : 'New private draft'}</h4><label>Project title<input required maxLength={120} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></label><label>Public summary<textarea required maxLength={400} rows={3} value={editing.summary} onChange={e => setEditing({ ...editing, summary: e.target.value })} /></label><label>Public description<textarea required maxLength={4000} rows={7} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label><label>Private moderator notes<textarea maxLength={3000} rows={4} value={editing.privateNotes} onChange={e => setEditing({ ...editing, privateNotes: e.target.value })} /></label><div className="toolbar"><button className="button" disabled={busy}>Save private draft</button><button type="button" className="text-button" disabled={busy} onClick={() => setEditing(null)}>Cancel editing</button></div></form>}{preview && <div className="project-preview"><h4>Public listing preview</h4><p>Publishing makes the following information visible to everyone. Private notes are excluded.</p><ProjectCard project={preview} /><div className="toolbar"><button className="button" disabled={busy} onClick={() => publish(preview, 'publish')}>Publish / List publicly</button><button className="text-button" disabled={busy} onClick={() => setPreview(null)}>Cancel preview</button></div></div>}{loading ? <p role="status">Loading projects…</p> : projects.length ? projects.map(row => <article className="archive-row" key={row.id}><div><span className="role-badge">{row.published ? 'Published' : 'Private draft'}</span><h4>{row.title}</h4><p>{row.summary}</p>{row.published && JSON.stringify({ id: row.id, title: row.title, summary: row.summary, description: row.description }) !== row.published && <p>Unpublished changes saved.</p>}</div><div className="archive-actions"><button className="text-button" disabled={busy || !!editing} onClick={() => { setEditing({ ...row }); setPreview(null); }}>Edit draft</button><button className="text-button" disabled={busy || !!editing} onClick={() => setPreview(row)}>Preview &amp; publish</button>{row.published && <button className="text-button" disabled={busy || !!editing} onClick={() => publish(row, 'unpublish')}>Unpublish</button>}</div></article>) : !editing && <p>No projects yet. Choose New project to create a private draft.</p>}</section>;
}

