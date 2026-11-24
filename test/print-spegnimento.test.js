/**
 * Lo spegnimento mite (oc:9011, R6).
 *
 * Il container della stampa viene riciclato ogni sei ore e il riciclo non deve
 * troncare un rendering in volo. Prima di questo giro di correzioni il solo
 * `stop_grace_period` di compose non faceva niente: nessun gestore di SIGTERM
 * c'era (`grep -rn SIGTERM src/` dava zero), quindi Node moriva all'istante e
 * `docker stop -t 20` tornava in zero secondi.
 *
 * Qui si verifica il gestore, non il segnale: che il segnale arrivi fino a Node
 * dipende dall'albero dei processi del container e si misura con `docker stop`
 * (Dockerfile.print, `print-entrypoint`).
 */
import {createServer} from 'node:http';
import {describe, expect, it} from 'vitest';
import {spegnimentoMite} from '../src/server.js';

/** Un server vero in ascolto su una porta a caso, cosi' `close()` e' quello vero. */
function inAscolto() {
  const server = createServer((_req, res) => res.end('ok'));
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

const nessunLog = () => {};

describe('spegnimentoMite', () => {
  it('senza il router di stampa esce subito con 0', async () => {
    const server = await inAscolto();
    const uscita = new Promise(ok => spegnimentoMite(server, {locals: {}}, 'SIGTERM',
      {esci: ok, log: nessunLog}));
    expect(await uscita).toBe(0);
    expect(server.listening).toBe(false);
  });

  it('aspetta che i rendering in volo rientrino, poi esce con 0', async () => {
    const server = await inAscolto();
    let inFlight = 2;
    const app = {locals: {printLimits: {inFlight: () => inFlight}}};
    let uscito = false;
    const uscita = new Promise(ok => spegnimentoMite(server, app, 'SIGTERM',
      {esci: c => { uscito = true; ok(c); }, log: nessunLog}));
    // mentre un rendering e' in volo NON esce, anche se l'ascolto e' gia' chiuso
    await new Promise(r => setTimeout(r, 700));
    expect(uscito).toBe(false);
    expect(server.listening).toBe(false);
    inFlight = 0;
    expect(await uscita).toBe(0);
  }, 10000);

  it('smette di accettare richieste nuove prima di aspettare', async () => {
    const server = await inAscolto();
    const porta = server.address().port;
    let inFlight = 1;
    const app = {locals: {printLimits: {inFlight: () => inFlight}}};
    spegnimentoMite(server, app, 'SIGTERM', {esci: nessunLog, log: nessunLog});
    await expect(fetch(`http://127.0.0.1:${porta}/`)).rejects.toThrow();
    inFlight = 0; // cosi' l'attesa finisce e non resta un timer appeso
  });
});
