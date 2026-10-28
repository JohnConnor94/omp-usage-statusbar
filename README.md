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
```

Se `bun install` fallisce per un registry privato in `.npmrc`, usa `bun install --registry=https://registry.npmjs.org`.

Registra il plugin (un symlink al repository, abilitato di default) e avvia OMP senza altri argomenti:

```sh
omp plugin link .
omp
```

Le righe compaiono una volta sola. Alternativa senza collegamento: `omp --extension ./`. Usa una sola delle due modalità: combinarle non ha prodotto righe doppie nella prova fatta, ma non è una configurazione supportata.

## Uso

Con `label: full` (predefinito) ogni riga ha la forma `<provider>/<account> <finestra> <residuo>% · …`, ordinata per provider, account e finestra; le modalità `provider` e `none` accorciano il prefisso (vedi `Configurazione`). Le finestre senza dato risolvibile sono omesse.

Messaggi di stato:

- `Usage: loading`: primo caricamento in corso.
- `Usage: no quota data`: nessun abbonamento con dati di quota.
- `Usage: unavailable`: il recupero è fallito prima di avere dati. Se fallisce dopo, restano le ultime righe valide.

## Configurazione

Le impostazioni si leggono da due file JSON, scritti dal comando `/usage-statusbar` o modificabili a mano:

- globale: `~/.omp/agent/usage-statusbar.json`, valori predefiniti per tutti i progetti;
- progetto: `<progetto>/.omp/usage-statusbar.json`, sovrascrive il globale.

```json
{ "enabled": true, "label": "provider", "hidden": ["github-copilot/octocat"] }
```

- `enabled`: `true` mostra le righe, `false` le nasconde.
- `label`: nome dell'account nella riga.
  - `full` (predefinito): `anthropic/user@example.com (Org) Claude 5 Hour 69% · Claude 7 Day 73%`
  - `provider`: `anthropic Claude 5 Hour 69% · Claude 7 Day 73%`
  - `none`: `Claude 5 Hour 69% · Claude 7 Day 73%` (solo le finestre).
- `hidden`: abbonamenti da nascondere, identificati dalla parte `<provider>/<account>` della modalità `full`.

Precedenza per chiave: predefiniti < globale < progetto. `hidden` del progetto sostituisce l'intera lista globale, non la unisce. Un file illegibile o non valido viene ignorato con un avviso. Le modifiche ai file fatte a mano si applicano al riavvio di OMP.

### Comando `/usage-statusbar`

Modifica i file senza toccarli a mano e applica subito il cambiamento al footer (rilegge i dati già caricati, senza nuovo fetch, salvo riattivazione). Esc torna indietro.

1. Scegli lo scope: `Global` (default per tutti i progetti) o `Project` (sovrascrive il globale nella cartella corrente).
2. Nel menu:
   - `Enabled: on|off`: attiva o disattiva le righe.
   - `Account label`: `Full`, `Provider only` o `None — windows only`. Nello scope `Project` i valori non scritti nel file di progetto sono marcati `(inherited)`.
   - `Subscriptions…`: sceglie gli abbonamenti visibili (vedi sotto).
   - `Reset project overrides` (solo `Project`): cancella `<progetto>/.omp/usage-statusbar.json`.
   - `Done`: esce.

Il menu `Subscriptions…` elenca gli abbonamenti caricati: `[x]` visibile, `[ ]` nascosto; selezionane uno per invertirlo. Le chiavi nascoste che non compaiono più nei report restano in lista con `(not reported)`. Ogni modifica scrive l'intera lista `hidden` nel file dello scope, quindi in `Project` salva una copia completa della lista effettiva. Se non ci sono ancora dati, il menu avvisa di attendere il primo aggiornamento.

## Attivare e disattivare

Dal vivo, senza riavviare: `/usage-statusbar` → scope → `Enabled`. Con `off` le righe spariscono e i fetch si fermano; con `on` compare `Usage: loading` e poi le righe. Il valore `enabled` è salvato nel file dello scope scelto.

Da plugin (se installato con `omp plugin link .`):

```
/plugins disable omp-usage-statusbar
/plugins enable omp-usage-statusbar
```

Il cambio **non è immediato**: le righe restano finché non riavvii `omp`. Dopo il riavvio con il plugin disattivato non compaiono righe e `/usage-statusbar` non esiste più (il testo viene inviato al modello come messaggio normale). Dopo `/plugins enable` e un riavvio le righe tornano. Per un on/off senza riavvio usa `Enabled`.

## Disinstallazione

Se hai installato il plugin con `omp plugin link .`:

```sh
omp plugin uninstall omp-usage-statusbar
```

Rimuove solo il collegamento: la cartella del repository resta intatta. Se invece lo caricavi con `omp --extension ./`, smetti di passare `--extension ./`.

Facoltativo: cancella le impostazioni, cioè `~/.omp/agent/usage-statusbar.json` e il file `.omp/usage-statusbar.json` di ogni progetto.

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
