# omp-usage-statusbar

Estensione per [OMP](https://github.com/can1357/oh-my-pi) che mostra nel footer la quota residua degli abbonamenti.

## Cosa fa

Mostra nel footer una riga per ogni abbonamento (account di un provider), con la percentuale **rimanente** per ogni finestra di quota. I dati vengono dagli stessi report di `/usage`.

Esempio di riga:

```
anthropic/user@example.com (Org) Claude 5 Hour 69% · Claude 7 Day 73%
```

L'aggiornamento avviene all'avvio della sessione, dopo ogni turno e ogni 60 s. La cache di OMP tiene i dati per circa 5 minuti, quindi i numeri cambiano più lentamente. `/usage` + `r` aggiorna il dashboard, non il footer.

L'estensione è visibile solo nella TUI interattiva (non con `-p` né in RPC) e solo per l'agente principale.

## Requisiti

- OMP `18.13.2`
- [Bun](https://bun.sh)

## Installazione

```sh
git clone <url-del-repository> omp-usage-monitor
cd omp-usage-monitor
bun install
omp --extension ./
```

Se `bun install` fallisce per un registry privato in `.npmrc`, usa `bun install --registry=https://registry.npmjs.org`.

## Uso

Ogni riga ha la forma `<provider>/<account> <finestra> <residuo>% · …`, ordinata per provider, account e finestra. Le finestre senza dato risolvibile sono omesse.

Messaggi di stato:

- `Usage: loading`: primo caricamento in corso.
- `Usage: no quota data`: nessun abbonamento con dati di quota.
- `Usage: unavailable`: il recupero è fallito prima di avere dati. Se fallisce dopo, restano le ultime righe valide.

## Disinstallazione

L'estensione è caricata solo con `omp --extension ./`: smetti di passare `--extension ./`.

## Sviluppo

```sh
bun test
npm exec --yes --package=typescript@5.9.3 -- tsc --noEmit --target ESNext --module preserve --moduleResolution bundler --types bun --skipLibCheck src/index.ts src/usage-summary.ts src/usage-summary.test.ts src/config.ts src/config.test.ts
```

Il type check non deve stampare nulla.

Flusso GitFlow: sviluppo su `feature/*` da `develop`, merge `--no-ff` in `develop`; le release passano da `release/X.Y.0` verso `master` con tag `vX.Y.0`.

Struttura di `src/`:

- `index.ts`: estensione OMP (ciclo di vita, fetch dei report, righe del footer).
- `usage-summary.ts`: formattazione pura dei report in righe di testo (modalità etichetta, abbonamenti nascosti).
- `usage-summary.test.ts`: test del formatter.
- `config.ts`: lettura, merge e scrittura dei file di configurazione.
- `config.test.ts`: test della configurazione.
