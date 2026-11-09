# Familjeskärm

Skylight-liknande väggskärm för familjen: veckokalender, att göra, recept, matsedel och inköpslista.
Byggd för Galaxy Tab A11+ (liggande, helskärm) och fungerar även i mobilen.

## Köra lokalt
```bash
npm install
npm run dev        # utveckling
npm run build      # produktionsbygge i dist/ (med service worker för offline)
npm run preview
```
Första gången visas **exempeldata** (märkt "Exempeldata" i sidhuvudet). Rensa via ⚙️ > *Rensa all data*.

## Lagring
All dataåtkomst går via `src/data/index.js`. Finns `VITE_SUPABASE_URL` och `VITE_SUPABASE_ANON_KEY` i `.env`
används Supabase (`src/data/supabase.js`, realtidssynk + offline-cache i localStorage för läsning).
Annars används `local.js` (bara lokalt, med exempeldata). Lägg **aldrig** service-role-nyckeln i appen.

Projekt: **familjeskarm** (ref `mzdivscbodljndwbfjmn`, region eu-north-1 Stockholm). Schemat finns i `supabase/schema.sql`
och är redan installerat. Databasen är tom från början.

## Skapa hushållets inloggning (en gång)
1. Gå till supabase.com/dashboard → projektet **familjeskarm**.
2. **Authentication → Users → Add user → Create new user**. Fyll i e-post och ett starkt lösenord,
   kryssa i **Auto Confirm User**, klicka *Create user*.
3. **SQL Editor** → kör (med er e-post):
   ```sql
   insert into public.household_emails(email) values ('er-epost@exempel.se');
   ```
   Bara e-post i den listan kan se eller ändra data – även om någon annan skulle registrera sig.
4. Rekommenderat: **Authentication → Sign In / Providers → Email** (eller *User Signups*) → stäng av
   **Allow new users to sign up**, och spara.
5. Logga in på plattan och i båda telefonerna med samma konto. Inloggningen sparas.

## Publicera (gratis statisk hosting)
Ladda upp `dist/` till t.ex. Netlify (dra-och-släpp), Cloudflare Pages, Vercel eller GitHub Pages. HTTPS krävs för offline/PWA.

## Väggplattan
Öppna sidan i Chrome > meny > *Lägg till på startskärmen* → startar i helskärm.
Lås plattan till appen med *Inställningar > Säkerhet > Fäst appar*. Sätt skärmtid till "aldrig" när den laddas
(t.ex. via Utvecklaralternativ > *Håll skärmen på vid laddning*). Appen går tillbaka till Hem efter 3 min utan touch.

## Live (Cloudflare Workers, gratis)
Adress: https://familjeskarm.rose-and-root-reminders.workers.dev

Publicera om efter ändringar:
```bash
npm run build
node scripts/gen-worker.mjs      # bäddar in dist/ i scripts/worker.generated.js
npx wrangler deploy scripts/worker.generated.js --name familjeskarm --compatibility-date 2026-11-01
```
(Alternativt via Zeffi och Cloudflare-kopplingen.) Okända sökvägar faller tillbaka till index.html.

## iCloud-kalendrar (endast läsning)
1. På iPhone: **Kalender → Kalendrar → (i) bredvid kalendern → slå på Offentlig kalender → Dela länk** (kopiera `webcal://…`).
2. I appen: **⚙️ → Kalendrar** → namn, klistra in länken, välj person → *Lägg till kalender*.
3. Händelserna visas med 🍎 i kalendern och på Hem, och kan inte ändras i appen. De uppdateras var 15:e minut och när appen öppnas.

Länkarna sparas i tabellen `calendar_feeds` (bara hushållet kan läsa dem) och hämtas av Workern via
`/api/ics?id=…`, som kräver inloggning. Bara iCloud-, Google- och Outlook-värdar tillåts.
OBS: en offentlig iCloud-länk kan läsas av alla som har den – dela den inte vidare.
Test av tolkningen: `node test/feeds.test.mjs`.

## Design (v2)
- Typsnitt Inter (självhostat, fungerar offline), SVG-ikoner, ljust och mörkt tema.
- Tema: knappen i sidomenyn växlar Auto → Ljust → Mörkt. Auto = mörkt kl. 21–06.
- Nattklocka: på surfplattan visas en dämpad klocka efter 3 min utan beröring på natten. Tryck för att väcka.
- Mobil: flikrad i botten, plusknapp (FAB) och formulär som "bottom sheets". Surfplatta: centrerade dialoger.
- App-ikoner: icon-192/512, maskable och apple-touch-icon (genereras med `node scripts/icons.mjs`).

## Avgångar från Lackarebäck

Hem använder `/api/departures`, uppdaterat varje minut när sidan är synlig. Worker hämtar en OAuth-token med client credentials och återanvänder den till strax före utgångstiden. Hållplatsområdet slås upp en gång per Worker-instans, och alla lägen inom området ingår. Avgångssvar cachas i Cloudflare i 30 sekunder. Inga avgångar är hårdkodade och ingen gammal avgångslista sparas offline.

1. Registrera ett konto på https://developer.vasttrafik.se/ och skapa en applikation.
2. Prenumerera på **Planera Resa v4** för applikationen.
3. Lägg in **Worker secrets** på `familjeskarm`: `VASTTRAFIK_CLIENT_ID` och `VASTTRAFIK_CLIENT_SECRET`.
4. Valfritt: `VASTTRAFIK_STOP_GID` kan ange hållplatsområdets 16-siffriga GID. Utelämna för automatisk uppslagning av Lackarebäck i Mölndal.

Nycklar ska aldrig anges i Vite-variabler eller klientkoden. Saknas de visas ett vänligt konfigurationsmeddelande. Deploymetadata behåller både `plain_text`- och `secret_text`-bindningar. Utan nycklar kan verkliga avgångar och GID inte verifieras.

## Nattläge per enhet

Inställningar har på/av och start-/sluttid (standard 23–06, Europe/Stockholm). Nattläget är på som standard över 820 px bredd och av på telefon. Inställningarna lagras lokalt som `fs-night`. Klockan visar datum, aktuellt väder och nästa dags första händelse, flyttas långsamt, och kan väckas med tryck i två minuter. Läget avslutas automatiskt på morgonen. Screen Wake Lock begärs där webbläsaren stöder det; Android kan neka vid t.ex. låg batterinivå. Appen kan inte sänka enhetens fysiska skärmljusstyrka.

Kontroller: `node scripts/departures.test.mjs`, `node --test test/feeds.test.mjs`, `node scripts/check.mjs`, `node scripts/verify-night-transit.mjs`. Livekontrollerna använder befintlig `FAMILJESKARM_PASSWORD` utan att skriva ut värdet; den sistnämnda tar skärmbilder och ändrar endast testwebbläsarens klocka.

## Hem – designpass november 2026

Startsidan har tre informationsspalter på väggplattan: dagens kalender, väder med timprognos och sju kommande dygn, samt avgångar och en kompakt uppgiftslista. Middagskortet har tagits bort från Hem; Matsedel och kalenderns matplanering är oförändrade. Forecast hämtar åtta dygn inklusive idag. Vädrets nuläge och prognos hålls i samma kort, och timradens rubrik skiljer sig från dygnsprognosen.

`src/dashboard.css` samlar den nya responsiva designen. Testat utan sidrullning vid 1200×800, 1280×800, 1340×800 och 1920×1200; telefon och mindre plattor rullar vertikalt. Veckokalendern visar en dynamisk +N-knapp när fler händelser finns längre ner. Matsedel har ett separat draghandtag med Pointer Events, pekfångst och automatisk kantrullning för touch, plus befintligt klick- och tangentbordsval.

Designguiden från leonxlnx/taste-skill lästes som visuell inspiration (hierarki, jämna linjer, konsekventa ytor, kontrast och lugn rörelse). Inga av dess skript kördes eller installerades.

Aktuella kontroller:
- `REVIEW_URL=https://familjeskarm.rose-and-root-reminders.workers.dev/ node scripts/design-review.mjs`
- `REVIEW_URL=https://familjeskarm.rose-and-root-reminders.workers.dev/ node scripts/test-dashboard-interactions.mjs` — alla matsedelsskrivningar fångas upp av testet, utan ändringar i databasen.
- `node scripts/verify-final-night.mjs`
- `node scripts/check.mjs`

Västtrafik är nu konfigurerat och riktiga avgångar verifierade. Automatiskt identifierat hållplatsområde: `9021014012140000`, Lackarebäck i Mölndal. Inga hemliga värden dokumenteras här.

## Kalenderflöden – robusthet (nov 2026)
- `/api/ics` skickar realistisk User-Agent/Accept, följer redirects manuellt (bara till tillåtna värdar), 10 s timeout och 3 försök med backoff (0,5 s / 1,5 s) vid nätverksfel, 5xx, 429.
- Personalkollen cachas 20 min, övriga 2 min. Senaste lyckade kopian sparas 7 dygn i Cache API och serveras vid fel (`X-Ics-Cache: stale`, `X-Ics-Fetched-At`).
- Klienten visar en kompakt rad ("… kunde inte uppdateras · Senast hämtade pass visas · Visa detaljer") först när en källa strulat i mer än 30 min, eller direkt om inga pass alls finns att visa.
- Workers Logs är påslaget; fel loggas som `{"ics":"fail",...}` (utan länkar).
