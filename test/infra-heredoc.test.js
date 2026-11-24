import {describe, expect, it} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const INFRA = new URL('../infra/', import.meta.url).pathname;

/**
 * Dentro un heredoc NON quotato (`<<EOF`) bash espande le variabili e, cosa
 * meno ovvia, **esegue i backtick come comandi**. Gli script di `infra/`
 * scrivono con quegli heredoc le unita' systemd e il Caddyfile, e i loro
 * commenti sono in italiano con il codice citato — in Markdown si cita fra
 * backtick, e li' dentro quella e' una command substitution.
 *
 * E' successo il 24 novembre 2026 pubblicando oc:9011: `src/server.js`,
 * `public-url.conf` e `ulimit -c 0` nei commenti sono stati ESEGUITI,
 * l'unita' systemd e' stata scritta con i commenti mutilati e lo script e'
 * morto prima di finire. Nessun errore prima di allora, perche' i commenti
 * senza backtick non avevano mai dato problemi.
 *
 * La regola: in un heredoc non quotato niente backtick. Dove servono le
 * variabili (`$REPO` in un `WorkingDirectory`) l'heredoc resta non quotato e il
 * codice si cita senza backtick; dove non servono, si quota il delimitatore
 * (`<<'EOF'`) e allora i backtick sono innocui.
 */
describe('gli heredoc degli script di infra non eseguono i propri commenti', () => {
  const script = readdirSync(INFRA).filter(f => f.endsWith('.sh'));

  it('ci sono script da controllare', () => {
    expect(script.length).toBeGreaterThan(0);
  });

  for (const nome of script) {
    it(`${nome}: nessun backtick dentro un heredoc non quotato`, () => {
      const righe = readFileSync(join(INFRA, nome), 'utf8').split('\n');
      let aperto = null;
      const colpevoli = [];
      righe.forEach((riga, i) => {
        const m = riga.match(/<<(-?)('?)([A-Za-z_]+)\2/);
        if (m && !aperto) { aperto = {fine: m[3], quotato: m[2] === "'", da: i + 1}; return; }
        if (aperto && riga.trim() === aperto.fine) { aperto = null; return; }
        if (aperto && !aperto.quotato && riga.includes('`')) {
          colpevoli.push(`riga ${i + 1} (heredoc aperto a ${aperto.da}): ${riga.trim()}`);
        }
      });
      expect(colpevoli, `backtick eseguiti come comandi:\n${colpevoli.join('\n')}`).toEqual([]);
    });
  }
});
