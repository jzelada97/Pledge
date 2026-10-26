# Desplegar Pledge en una VM

La web (`apps/web`, Next 16) lleva dentro la API (`apps/api`, montada en `/api`): un solo proceso Node sirve las dos. Testnet de Stellar; nada de esto está pensado para mainnet.

## Lo imprescindible: HTTPS con un nombre de dominio

Las cuentas con passkey (WebAuthn) **solo funcionan en `localhost` o bajo HTTPS**, y la passkey queda ligada al nombre del dominio (`rpId = location.hostname`). Así que:

- La VM necesita un dominio (`pledge.tudominio.com`) apuntando a su IP y un proxy con certificado delante de Next. Lo más rápido es **Caddy**, que saca el certificado solo:
  ```
  pledge.tudominio.com {
      reverse_proxy localhost:3000
  }
  ```
- Una cuenta creada en `localhost` no existe en `pledge.tudominio.com`: en la demo desplegada se crean cuentas nuevas.
- Si cambias el dominio, se vuelven a crear.

## Requisitos

- Node 22 y pnpm 10 (`corepack enable`).
- La CLI de Stellar no hace falta en la VM.
- Puertos: 3000 solo local; 80/443 abiertos para Caddy.

## Variables de entorno

Van en `apps/web/.env.local` (Next solo lee ahí; el archivo está en `.gitignore`). Las mismas que en local, con la URL pública en `API_ALLOWED_ORIGINS`:

```
TW_API_KEY=                 # API de Trustless Work (TrustYield)
TREASURY_SECRET=            # S… de la tesorería: firma la creación de escrows
STAFF_SECRET=               # S… del staff: resuelve la reclamación a plazo (#115)
RAMP_FAUCET_SECRET=         # S… del faucet: "banco" simulado (USDC de prueba)
RAMP_ENABLED=true
RELAYER_URL=https://channels.openzeppelin.com/testnet
RELAYER_API_KEY=            # OpenZeppelin Channels (testnet)
FIANZAS_BACKEND=trustless
TW_PLATFORM_FEE_BPS=0
TW_CLAIM_TIMEOUT_SECS=120   # demo: 2 minutos; producción: 2592000 (30 días)
API_ALLOWED_ORIGINS=https://pledge.tudominio.com
```

Las claves `S…` se exportan desde la máquina que tiene las identidades de la CLI: `stellar keys show fianzas-treasury` (y `fianzas-staff`, `fianzas-faucet`). Nunca se suben al repo ni se pegan en issues.

## Pasos

```bash
git clone https://github.com/jzelada97/Pledge.git && cd Pledge
corepack enable && pnpm install --frozen-lockfile
# crear apps/web/.env.local con las variables de arriba
pnpm --filter @fianzas/web build
pnpm --filter @fianzas/web start      # next start --port 3000
```

Para que sobreviva a reinicios, con pm2:

```bash
npm i -g pm2
pm2 start "pnpm --filter @fianzas/web start" --name pledge --cwd /ruta/a/Pledge
pm2 save && pm2 startup
```

## Comprobar

- `curl -s https://pledge.tudominio.com/api/health` → `"backend":"trustless","relayer":true,"ramp":true`.
- `/landlord` → «Entrar con Face ID» → crea la cuenta (el Relayer la despliega; tarda ~15 s).
- El ciclo de la demo: casero `/landlord` → «+» → enlace; inquilino abre el enlace (otro perfil o móvil) → cuenta → dinero → depósito; casero aprueba; inquilino recupera. Para enseñar la reclamación a plazo, crea la fianza con pocos meses y `TW_CLAIM_TIMEOUT_SECS=120` ya basta cuando `endTs` queda en el pasado (el enlace lleva `&e=<unix>`).

## Si algo falla

- `400 SIMULATION_FAILED` al firmar con la passkey: el log del servidor dice la causa (`[relay] SIMULATION_FAILED: …`, con el número de error del contrato).
- `RAMP_DOWN`: el faucet (`GDHIKULV…YDC3`) se ha quedado sin USDC. Recargarlo cambiando XLM por USDC en Soroswap (ver `docs/CONECTAR-FRONT.md`).
- Las listas tardan 5-15 s: Trustless Work valida cada escrow en la cadena; es normal.
- Reiniciar tras cambiar `.env.local`: Next solo lo lee al arrancar.
