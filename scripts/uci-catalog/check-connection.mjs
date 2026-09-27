#!/usr/bin/env node
import pg from 'pg';
import { clientConfig, errorCode } from './run.mjs';

// Comprobación de instalación del servicio: solo identidad, TLS y privilegios.
// No captura UCI, no lee fichas y no crea observaciones.
const clients = [];
try {
  for (let i = 0; i < 2; i++) {
    const client = new pg.Client(clientConfig(process.env.UCI_CATALOG_DATABASE_URL));
    clients.push(client); await client.connect();
    const { rows: [state] } = await client.query(`SELECT session_user AS role,
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,
      has_function_privilege(current_user,'private.uci_catalog_begin(text,text)','EXECUTE') AS can_begin,
      has_table_privilege(current_user,'public.riders_men','UPDATE')
        OR has_table_privilege(current_user,'public.riders_women','UPDATE')
        OR has_table_privilege(current_user,'public.rider_team_affiliations','INSERT,UPDATE,DELETE') AS direct_write`);
    if (state.role !== 'cc_uci_catalog_worker' || !state.tls || !state.can_begin || state.direct_write) throw Error('unexpected_worker_privileges');
  }
  console.log(JSON.stringify({ event: 'connection_verified', role: 'cc_uci_catalog_worker', connections: 2,
    tlsVerified: true, directPublicWrites: false }));
} catch (error) {
  console.error(JSON.stringify({ event: 'connection_failed', code: errorCode(error) })); process.exitCode = 1;
} finally { await Promise.allSettled(clients.map(client => client.end())); }
