import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdtempSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const roots = ['.env.example', '.gitignore', 'README.md', 'package.json', 'package-lock.json', 'index.html', 'vite.config.js', 'eslint.config.js', 'playwright.config.js', 'src', 'server', 'tests', 'scripts', 'public'];
function files(path) { return statSync(path).isDirectory() ? readdirSync(path).flatMap(name => files(join(path, name))) : [path]; }
const source = roots.flatMap(files);
const contents = source.map(path => `\n${'='.repeat(80)}\nFILE: ${path.replaceAll('\\', '/')}\n${'='.repeat(80)}\n${path.endsWith('.jpg') ? 'BASE64-JPEG\n' + readFileSync(path).toString('base64') : readFileSync(path, 'utf8')}\n`).join('');
writeFileSync('SOURCE.txt', contents);
const stage = mkdtempSync(join(tmpdir(), 'svbt-package-'));
try {
  const outputs = [...source, 'SOURCE.txt', ...(existsSync('dist') ? files('dist') : []), ...(existsSync('monthly/statements') ? files('monthly/statements') : [])];
  for (const path of outputs) { const target = join(stage, path); mkdirSync(dirname(target), { recursive: true }); copyFileSync(path, target); }
  if (process.platform !== 'win32') throw new Error('ZIP packaging currently requires Windows PowerShell; complete source files and SOURCE.txt are available on all platforms.');
  const archive = join(process.cwd(), 'SVBT-complete.zip');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${stage.replaceAll("'", "''")}/*' -DestinationPath '${archive.replaceAll("'", "''")}' -Force`], { stdio: 'inherit' });
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [IO.Compression.ZipFile]::OpenRead('${archive.replaceAll("'", "''")}'); try { if ($zip.Entries.Count -lt ${outputs.length}) { throw 'Incomplete ZIP archive' }; Write-Output ('Verified ZIP entries: ' + $zip.Entries.Count) } finally { $zip.Dispose() }`], { stdio: 'inherit' });
  console.log(`Packaged ${source.length} source files with full contents in SOURCE.txt and ${archive}`);
} finally { rmSync(stage, { recursive: true, force: true }); }
