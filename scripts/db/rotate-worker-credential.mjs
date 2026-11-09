#!/usr/bin/env node
// Rota la credencial de un worker del VPS. Se ejecuta en la máquina de Dani:
//
//   node scripts/db/rotate-worker-credential.mjs <cc_results_worker|cc_uci_catalog_worker> [--valid-days 366]
//
// La contraseña se genera en el VPS (prepare-worker-credential.mjs) y no sale de él: a este
// equipo solo llega el verificador SCRAM, que se registra con DATABASE_URL y no se imprime.
// Para los timers del worker y espera a que acaben sus pasadas, porque una pasada con la
// contraseña anterior fallaría al abrir conexiones nuevas. Si la conexión nueva no se puede
// comprobar, conserva el archivo .pending y deja los timers parados.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadEnv, mainCheckoutEnvPath, withUrl } from './env.mjs';
import { roleOfUrl } from './provision-agent-role.mjs';

const VPS = 'root@116.203.47.20';
const DIR = '/etc/calendario-ciclismo';
const CHECK_RESULTS = `const pg=require("pg");const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query("SELECT session_user AS rol")).then(r=>{if(r.rows[0].rol!=="cc_results_worker")throw new Error("rol");console.log("conexión comprobada");return c.end()}).catch(e=>{console.error("conexión fallida",e.code||"");process.exit(1)})`;
const WORKERS = {
  cc_results_worker: {
    archivo: 'results.env', copias: ['uci-results.env'], propietario: 'root:cc-results', modo: '640',
    unidades: ['cc-results', 'cc-cx-results', 'cc-uci-team-ranking'],
    comprobacion: `-p User=cc-results /usr/bin/node -e '${CHECK_RESULTS}'`,
  },
  cc_uci_catalog_worker: {
    archivo: 'uci-catalog.env', copias: [], propietario: 'root:root', modo: '600',
    unidades: ['cc-uci-catalog'],
    comprobacion: '-p User=cc-uci-catalog -p Environment=NODE_EXTRA_CA_CERTS=/etc/cc-uci-catalog/supabase-ca.crt /usr/bin/node scripts/uci-catalog/check-connection.mjs',
  },
};

function remoto(orden, { input, capturar = false } = {}) {
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', VPS, orden], { input, encoding: 'utf8', stdio: ['pipe', capturar ? 'pipe' : 'inherit', 'inherit'] });
  return r.status === 0 ? (r.stdout ?? '') : null;
}

function comprobarEnVps(worker, archivo) {
  return remoto(`systemd-run --quiet --wait --pipe --collect -p WorkingDirectory=/opt/calendario-ciclismo -p EnvironmentFile=${archivo} ${worker.comprobacion}`) !== null;
}

async function main() {
  const [rol, opcion, valor] = process.argv.slice(2);
  const worker = WORKERS[rol];
  if (!worker) throw new Error(`Rol desconocido. Valores: ${Object.keys(WORKERS).join(', ')}.`);
  const validDays = opcion === '--valid-days' ? Number(valor) : 366;
  if (!Number.isInteger(validDays) || validDays < 1 || validDays > 366) throw new Error('--valid-days debe ser un entero entre 1 y 366.');
  loadEnv(mainCheckoutEnvPath());
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl || roleOfUrl(adminUrl) !== 'postgres') throw new Error('DATABASE_URL debe ser la credencial administradora.');
  const ref = decodeURIComponent(new URL(adminUrl).username).split('.')[1] || new URL(adminUrl).hostname.split('.')[1];
  const host = `db.${ref}.supabase.co`;
  const validUntil = new Date(Date.now() + validDays * 86400000).toISOString().slice(0, 10);
  const final = `${DIR}/${worker.archivo}`;
  const pendiente = `${final}.pending`;
  const timers = worker.unidades.map(u => `${u}.timer`).join(' ');
  const servicios = worker.unidades.map(u => `${u}.service`).join(' ');
  const reanudar = () => remoto(`systemctl start ${timers}`);

  const parados = remoto(`systemctl stop ${timers} && for i in $(seq 1 60); do systemctl is-active ${servicios} | grep -qvE '^(inactive|failed)$' || exit 0; sleep 5; done; exit 1`);
  if (parados === null) { reanudar(); throw new Error('Quedan pasadas en curso tras 5 minutos. Timers reanudados; no se ha cambiado nada.'); }

  try {
    const salida = remoto(`node --input-type=module - ${host} ${pendiente}`, { input: readFileSync(new URL('./prepare-worker-credential.mjs', import.meta.url)), capturar: true });
    if (salida === null) throw new Error('No se pudo preparar la credencial en el VPS.');
    let verificador;
    try { verificador = JSON.parse(salida).verifier; } catch { throw new Error('Salida no válida del preparador.'); }
    await withUrl(adminUrl, client => client.query(`ALTER ROLE ${rol} WITH PASSWORD ${client.escapeLiteral(verificador)} VALID UNTIL ${client.escapeLiteral(validUntil)}`));
  } catch (error) {
    reanudar();
    throw new Error(`${error.message} Timers reanudados; revisar si el rol cambió antes de repetir.`);
  }

  if (!comprobarEnVps(worker, pendiente)) throw new Error(`La conexión nueva no se pudo comprobar. Se conserva ${pendiente} y los timers siguen parados: ${timers}.`);
  const copias = worker.copias.map(c => `&& cp -p ${final} ${DIR}/${c}.tmp && mv ${DIR}/${c}.tmp ${DIR}/${c}`).join(' ');
  if (remoto(`chown ${worker.propietario} ${pendiente} && chmod ${worker.modo} ${pendiente} && mv ${pendiente} ${final} ${copias}`) === null) throw new Error(`No se pudo sustituir ${final}. Timers parados: ${timers}.`);
  if (!comprobarEnVps(worker, final)) throw new Error(`El archivo definitivo no conecta. Timers parados: ${timers}.`);
  if (reanudar() === null) throw new Error(`No se pudieron reanudar los timers: ${timers}.`);
  console.log(`${rol} rotado hasta ${validUntil}; ${worker.archivo} actualizado sin mostrar credenciales.`);
}

main().catch(error => { console.error(error.message); process.exit(1); });
