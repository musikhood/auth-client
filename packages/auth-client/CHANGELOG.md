# Changelog

Wszystkie istotne zmiany w `@musikhood-dev/auth-client`.

Format luźno wg [Keep a Changelog](https://keepachangelog.com/); wersjonowanie semver.

## [2.3.1]

Patch, wstecznie zgodny. Poprawki z pilotażu w panelu Vue 3 + shadcn-vue logującym się wprost do auth servera.

### Fixed

- **Globalne dialogi 2FA poza `<AuthBoundary>` nigdy się nie otwierały** (React i Vue). Poza boundary `useAuth()`
  zwracał `isAuthenticated: false` zawsze, więc warunek `isAuthenticated && stage === 'step-up'` (szablony 2.3.0,
  istniejące panele — dialog w `root.tsx` / `App.vue`) był nieosiągalny. Teraz:
  - w stanie `step-up` / `enrollment` `isAuthenticated` jest `true` (w boundary i poza nim) — sesja żyje, także
    gdy usera jeszcze nie znamy (świeża sesja SSO bez drugiego składnika),
  - poza boundary `user` / `isAuthenticated` odzwierciedlają sesję klienta (cache `/me` ze wspólnego QueryClient
    albo ostatnio znany user); `/me` nadal nie jest wołane poza boundary.
    Panele z `isAuthenticated && stage` zaczynają działać po aktualizacji paczki, bez zmian w kodzie.
- Szablony: dialogi otwierają się na podstawie samego `stage` (reset przy logout robi paczka).
- `MfaCodeForm` (wszystkie warianty): przełączenie kod / kod zapasowy chowa błąd poprzedniej próby; Vue ustawia
  focus przez `ref` + `nextTick` (natywny `autofocus` działa tylko przy ładowaniu strony) — także w dialogu
  wymaganej konfiguracji 2FA.
- Wariant bez UI: modal bez wpisanych kolorów (`#fff` / `#111`) — zmienne `--auth-modal-bg` / `--auth-modal-fg`
  z fallbackiem `Canvas` / `CanvasText` (ciemny motyw).

### Added — `init` w istniejącym projekcie

- **Wariant shadcn-vue** (`components.json` + `components/ui/{button,dialog,input,label}/index.ts`): Dialog bez
  możliwości zamknięcia (`@escape-key-down.prevent @pointer-down-outside.prevent @interact-outside.prevent`, ukryty
  X), pole kodu z natywnym `@input` (pasywny `v-model` Input nie odświeża pola), natywny checkbox `accent-primary`.
- Zmienna z adresem API: `--env-var NAZWA` albo wykrywana z `baseUrl` w istniejącym `lib/auth.ts` / plików `.env*`
  (np. `VITE_BACKEND_URL`); `.env.example` nie jest ruszany, gdy klucz już jest w którymś pliku env.
- Toast wg faktycznych importów w kodzie (`sonner`, `vue-sonner`, shadcn `use-toast`) i komponentów
  `components/ui/{sonner,toast}` — paczka tylko w `package.json` się nie liczy (raport mówi, że pominięta).
  Nowy szablon `lib/auth.ts` dla shadcn `use-toast` (`toast({ title, description, variant: 'destructive' })`).
- Istniejąca strona `/login` (vue-router `path: '/login'`, RR7 `route('login', …)`): bez `LoginForm` (i trasy RR7),
  zamiast tego przepis scalenia kroku kodu 2FA.
- Istniejący `lib/auth.ts` bez `reportAuthError`: gotowy fragment do wklejenia (`INLINE_ERRORS`, `reportAuthError`
  z wykrytym toastem, listener `login-error`).
- Kroki ręczne tylko te, których brakuje (`VueQueryPlugin` + `createAuth` w `main.ts` — też ostrzeżenie o złej
  kolejności; `AuthProvider` / `<AuthMfaDialogs />`; `<AuthBoundary>`; wartość zmiennej env).
- Prettier repo (konfiguracja + lokalna instalacja): wygenerowane pliki są formatowane (`--skip-format` wyłącza);
  bez prettier raport mówi, że pliki są w stylu paczki.
- `AI_INTEGRATION.md` w paczce — instrukcja integracji dla agentów AI; `init` wypisuje do niej ścieżkę.

### Docs

- README: Quick start z dwiema ścieżkami (backend z bundlem / wprost do auth servera), instalacja `@^2.3` (`latest` to
  jeszcze 2.1.0), przykład Vue z `ref`-ami, przykłady błędów na `isAuthErrorNamed`, `useAuth()` poza boundary.

## [2.3.0]

Minor, wstecznie zgodny (czysto addytywny — aplikacje na 2.2.1 działają bez zmian).

### Added — `npx @musikhood-dev/auth-client init`

- **CLI `init`** (bin `auth-client`, czysty Node 18+, bez sieci i bez rejestru shadcn — działa z prywatnego
  rejestru npm): wykrywa React Router 7 / Vue 3, katalog aplikacji (`app/` / `src/`), alias importów z
  `tsconfig` (`~/`, `@/`; brak aliasu = ścieżki względne), shadcn/ui (`components.json` + `button`, `dialog`,
  `input`, `label`, `checkbox`) i `sonner` / `vue-sonner`. Generuje:
  - `lib/auth.ts` — `createAuthClient` (`VITE_API_BASE_URL`, `loginPath`, `homePath`, `broadcastSession`) +
    listener `login-error`, który pomija błędy pokazywane inline (2FA, limit prób, wygasła sesja, złe hasło),
    a resztę przekazuje do `reportAuthError` (toast, gdy wykryto `sonner` / `vue-sonner`; inaczej oznaczone
    miejsce do podpięcia),
  - `lib/mfa.ts` — teksty, `formatRetryAfter`, `mfaErrorMessage`, `loginErrorMessage`, `isAuthError(err, 'Name')`
    (typowany guard po nazwie — odporny na zduplikowane klasy błędów między entry),
  - komponenty 2FA: formularz kodu (TOTP / kod zapasowy; kod zapasowy ukrywa „Zapamiętaj to urządzenie” i zawsze
    wysyła `rememberDevice: false`), globalne dialogi step-up i wymaganej konfiguracji 2FA (nie do zamknięcia,
    alternatywa „Wyloguj się”), `AuthMfaDialogs` (oba dialogi jednym komponentem), formularz logowania z krokiem
    kodu; React: wariant shadcn/ui albo czysty HTML, Vue: SFC bez zależności UI,
  - React Router 7: `routes/login/login.tsx` (tylko gdy nie istnieje — nigdy nie nadpisywany),
  - `VITE_API_BASE_URL=` w `.env.example` (bez duplikowania klucza).
- Flagi: `--dry-run`, `--force`, `--cwd`, `--framework react|vue`, `--yes`, `--help`. Istniejące pliki są
  pomijane (bez `--force`); drugie uruchomienie niczego nie zmienia. Na koniec CLI wypisuje 1–2 kroki ręczne
  z gotowym kodem (`AuthProvider` + `<AuthMfaDialogs />` w roocie / `createAuth` + `AuthMfaDialogs.vue`) i ostrzega,
  gdy istniejący `lib/auth.ts` / `lib/mfa.ts` nie ma eksportów, których używają wygenerowane komponenty.
- Szablony są w paczce (`templates/`), wygenerowane pliki są typowane i sprawdzane w testach (`tsc` / `vue-tsc`).
- `isAuthErrorNamed(error, name)` eksportowany z głównego entry.

## [2.2.1]

Patch, wstecznie zgodny.

### Fixed

- Stan 2FA (`getMfaState()` / `useMfa()`: `stage`, `mfaToken`, `enrollmentUrl`) wraca do `idle` przy eventach
  `logout` (także nieudany request logout) i `unauthorized` (refresh fail) — również z innej zakładki
  (`broadcastSession`). Wcześniej globalne dialogi step-up / enrollment zostawały nad stroną logowania do
  odświeżenia (obejście: `mfa.reset()` po logout — można je usunąć). 403 `mfa_step_up` /
  `mfa_enrollment_required` stanu nie resetują.

## [2.2.0]

Minor, wstecznie zgodny. Backend bez pola `code` w błędach = zachowanie jak w 2.1.

### Added — 2FA (TOTP)

- **Błędy:** `MfaRequiredError { mfaToken, methods }` (podklasa `InvalidCredentialsError` — stary kod
  łapiący złe dane nadal działa, fail-closed), `MfaEnrollmentRequiredError { enrollmentUrl }` (podklasa
  `LoginForbiddenError`), `MfaStepUpRequiredError`, `MfaInvalidCodeError`, `MfaTokenExpiredError`,
  `TooManyAttemptsError { retryAfter }`, `MfaAlreadyEnabledError` (409), `DeviceMismatchError`
  (podklasa `SessionExpiredError`).
- **Metody:** `verifyMfa({ mfaToken, code?, recoveryCode?, rememberDevice? })`,
  `stepUpMfa({ code?, recoveryCode?, rememberDevice? })`, `requestMfaEnrollment()` → URL,
  `startMfaEnrollment(url?)`, `getMfaState()`, `isMfaStepUpRequired()`, `resetMfa()`.
- **Eventy:** `mfa-required`, `mfa-step-up-required`, `mfa-enrollment-required { enrollmentUrl }`,
  `mfa-state-changed`.
- `login()` mapuje `code` z body: `mfa_required` (401), `mfa_enrollment_required` (403),
  `too_many_attempts` (429).
- `/me` + interceptor: 403 `mfa_step_up` → event + stan `step-up`, **bez** redirectu na login i bez
  `panel-access-denied`; 403 `mfa_enrollment_required` → event `{ enrollmentUrl: null }` (bramka per request
  nie wydaje linku — UI prosi o hasło i woła `requestMfaEnrollment`). 401 `device_mismatch_recheck`
  → zwykły refresh i retry. Refresh 401 `device_mismatch` → `DeviceMismatchError`.
- **Adaptery:** React `useMfa()` / Vue `useMfa()` — `{ stage, mfaToken, methods, enrollmentUrl, verify,
stepUp, startEnrollment, requestEnrollment(password), reset }`, zintegrowane z `useAuth().login`. `useAuth()`
  zwraca `mfaStepUpRequired` / `mfaEnrollmentRequired`; `AuthBoundary` nie redirectuje i nie zapętla
  `/me` w trakcie step-upu / enrollmentu.
- `confirmMfaEnrollment({ enrollmentToken, code })` → `{ recoveryCodes, returnUrl, session }` (strona
  konfiguracji): wysyła `device`; gdy auth-server od razu loguje usera z 2FA (`session != null`) — event `login`.
- `MfaInvalidCodeError.reason`: `'invalid'` | `'reused'` (401 `mfa_code_reused` — poprawny kod z już użytego
  kroku czasowego). Ta sama klasa, więc istniejący kod łapiący `MfaInvalidCodeError` działa bez zmian.
- `ENDPOINTS.loginMfa`, `ENDPOINTS.sessionMfa`, `ENDPOINTS.mfaEnrollmentRequest`, `ENDPOINTS.mfaEnrollmentConfirm`,
  `AUTH_CODES`, `DEVICE_FP_HEADER`.

### Added — fingerprint urządzenia

- `core/device.ts`: kolektor komponentów (bez zewnętrznych bibliotek, lekki parser UA +
  `navigator.userAgentData`), hash SHA-256 (`crypto.subtle`) z kanonicznego JSON — zgodny bajt w bajt
  z auth serverem (wspólny wektor testowy). SSR-safe, cache na czas życia strony.
- Config `deviceFingerprint?: boolean` (**default `true`**): nagłówek `X-Device-Fp` na każdym requeście,
  `device` w body loginu / refreshu / `verifyMfa` / `stepUpMfa`.

### Fixed

- Adaptery React/Vue rozpoznają błędy klienta po `name` (`isAuthErrorNamed`), nie `instanceof` —
  entry `/react` i `/vue` mają własne kopie klas błędów (tsup `splitting: false`), więc `instanceof`
  na błędzie rzuconym przez klienta z głównego entry był fałszywy (dotyczyło m.in. `retry` w `useMe`
  dla `PanelAccessDeniedError` / `SessionExpiredError`).
- Po udanym step-upie / konfiguracji 2FA `useAuth` nie zwraca chwilowo `user=null` (stary błąd `/me`
  z fazy 2FA traktowany jako ładowanie) — brak mignięcia przekierowania na login.

### Uwaga przy aktualizacji

- Backend (CORS) musi dopuszczać nagłówek **`X-Device-Fp`** (`allow_headers`), a dla
  `TooManyAttemptsError.retryAfter` wystawiać `Retry-After` (`expose_headers`). Konsumenci przez
  auth-client-bundle: CORS własnego backendu. Bez tego ustaw `deviceFingerprint: false`.

## [2.1.0]

### Added

- **`PanelAccessDeniedError`** — nowy terminalny błąd dla **403 z `/me`** (brak
  dostępu do BIEŻĄCEGO panelu). Eksportowany z głównego entry (`@musikhood-dev/auth-client`).
- **`AuthClient.isPanelAccessDenied()`** — sync getter; `true` po 403 z `/me`,
  reset na `false` przy `login()`.
- **Event `'panel-access-denied'`** — emitowany przy 403 z `/me`. Odrębny od
  `unauthorized`/`logout`.

### Changed — kontrakt 401 vs 403

Te same ciasteczka SSO (`BEARER` + `refresh_token`) są ważne na każdym panelu w
domenie (panel-agnostic). `/me` rozróżnia dwa stany:

- **401 → `SessionExpiredError`** (bez zmian): sesja martwa (refresh wygasł/zużyty/
  odwołany, konto disabled). Paczka próbuje refresh; po porażce emituje
  `unauthorized`, czyści cache, redirectuje na `loginPath`. **Globalne wylogowanie.**
- **403 → `PanelAccessDeniedError`** (NOWE): sesja ŻYJE, ale user nie ma dostępu
  do tego panelu. Paczka:
  - **NIE** robi refresh (interceptor i tak ignoruje nie-401),
  - **NIE** emituje `unauthorized`/`logout`, **NIE** rusza `sessionState`,
  - **NIE** czyści `cachedUser` ani ciasteczek, **NIE** broadcastuje do innych zakładek,
  - ustawia terminalny flag, emituje `'panel-access-denied'`, redirectuje na `loginPath`.

  Adaptery React/Vue (`useMe`/`useAuth`): `retry=false` dla `PanelAccessDeniedError`
  i wyłączony polling (`enabled=false`) — koniec pętli 403. Sesja na panelach, do
  których user MA dostęp, zostaje nienaruszona.
