// Lanza el servidor estático, ejecuta todas las suites de navegador y lo apaga.
// Así `npm run test:e2e` no depende de que haya un servidor levantado a mano.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

const PORT = process.env.PORT || 8899;
const URL = `http://127.0.0.1:${PORT}/index.html`;

const esperar = async () => {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(URL)).ok) return true; } catch { /* aún no */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
};

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
process.on('exit', () => srv.kill());
process.on('SIGINT', () => { srv.kill(); process.exit(130); });

if (!await esperar()) { console.error('No se pudo levantar el servidor'); srv.kill(); process.exit(1); }

const suites = readdirSync('test')
  .filter(f => f.startsWith('e2e') && f.endsWith('.mjs'))
  .sort();

let fallos = 0, total = 0;
for (const s of suites) {
  const r = spawn('node', [`test/${s}`], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, APP_URL: URL },
  });
  let salida = '';
  r.stdout.on('data', d => { salida += d; });
  const code = await new Promise(res => r.on('close', res));
  const n = (salida.match(/^\s+ok\s+/gm) || []).length;
  total += n;
  if (code === 0) {
    console.log(`  ok  ${s.padEnd(28)} ${String(n).padStart(3)} comprobaciones`);
  } else {
    fallos++;
    console.log(`FALLA ${s}`);
    console.log(salida.split('\n').filter(l => /^FAIL|PROBLEMAS| - /.test(l)).join('\n'));
  }
}

srv.kill();
console.log(`\n${total} comprobaciones de navegador · ${fallos ? fallos + ' SUITES FALLIDAS' : 'todas pasan'}`);
process.exit(fallos ? 1 : 0);
