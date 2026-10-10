# auth-client — podpięcie frontu, instrukcja dla agenta AI

Frontowa część instrukcji integracji panelu z auth serverem. Treść kanoniczna (backend,
wariant maszynowy, `security.yaml`, encja User, pełne pułapki) jest w bundlu:
`vendor/musikhood/auth-client-bundle/AI_INTEGRATION.md`
([GitHub](https://github.com/musikhood/auth-client-bundle/blob/main/AI_INTEGRATION.md)). Ludzki opis: [README](./README.md).

Wersja: `@musikhood-dev/auth-client` **^2.3.1** (React Router 7 albo Vue 3; TanStack Query 5).

**Konkretne adresy i dane panelu Twojej organizacji:** dokument integracji w Work HUB
(`project_context_get(doc="AUTH_INTEGRATION.md")` w projekcie auth servera) i baza dostępów (`secret_to_env`).
Adresy w tym pliku (`https://auth.example.com`, `https://api.example.com`) to tylko przykłady.

## Zasady dla agenta

- Sekrety (dane panelu, tokeny) tylko z bazy dostępów Work HUB przez `secret_to_env` — nigdy w kodzie ani rozmowie.
  Front nie potrzebuje żadnego sekretu: tylko adresu API w zmiennej `VITE_*`.
- Bez commitów i deployu bez zgody operatora. Bez zmian w auth serverze i w paczkach — potrzebna zmiana = notatka do
  raportu.
- Polityka 2FA żyje tylko w panelu administracyjnym auth servera. Nie dodawaj przełączników 2FA w kodzie panelu.
- Raport: wariant (a/b), pliki z jednym zdaniem, wynik `vue-tsc`/`tsc` + build, testy ręczne, otwarte punkty.

## Zanim zaczniesz

Od operatora / admina: rekord panelu w panelu administracyjnym auth servera z **originem frontu** (Panele → „Dodaj
panel”), dostęp userów do panelu, a w wariancie (b) origin frontu w konfiguracji CORS auth servera (zmiana po stronie
auth servera).
Brakuje → zatrzymaj się i zapytaj.

## Który wariant

| Wariant                          | Kiedy                       | `baseUrl`                                                                              |
| -------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| (a) backend Symfony z bundlem    | panel z backendem Symfony   | URL backendu panelu, np. `https://api.example.com`                                     |
| (b) bezpośrednio do auth servera | panel bez własnego backendu | URL auth servera, np. `https://auth.example.com` (dev: `https://auth-dev.example.com`) |

Serwis bez UI (X-Api-Token) i backend (a) → instrukcja w bundlu.
**Panel ma już własne komponenty 2FA?** Nie uruchamiaj `init` — tylko `npm i @musikhood-dev/auth-client@^2.3.1`
(naprawia dialogi 2FA poza `<AuthBoundary>`), `tsc` + build, test step-upu.

## Kroki

```bash
npm i @musikhood-dev/auth-client@^2.3.1 @tanstack/vue-query   # React: @tanstack/react-query
npx @musikhood-dev/auth-client init --dry-run                  # przeczytaj cały raport, zapisz plan
npx @musikhood-dev/auth-client init                            # bez --force (nadpisuje — tylko za zgodą)
```

`latest` w npm to 2.1.0 (bez `init` i 2FA) — instaluj z wersją. Opcje: `--env-var NAZWA` (zmienna z adresem API,
gdy wykrycie się myli), `--skip-format` (bez prettier repo), `--framework react|vue`, `--cwd`.

Raport `init` — co sprawdzić:

- `UI:` — shadcn/ui (React), shadcn-vue (Vue: `components.json` + `components/ui/{button,dialog,input,label}`) albo
  wariant bez UI (kolory przez `--auth-modal-bg` / `--auth-modal-fg`).
- `toast:` — toast faktycznie używany w kodzie (`sonner`, `vue-sonner`, shadcn `use-toast`); „nie wykryto” = podepnij
  `reportAuthError` w `lib/auth.ts` ręcznie.
- `API URL:` — zmienna i skąd wykryta (`lib/auth.ts`, `.env*`, domyślna `VITE_API_BASE_URL`). Zła → `--env-var`.
- `logowanie:` — istniejąca strona `/login` → przepis scalenia zamiast `LoginForm`.
- `Uwaga:` — np. istniejący `lib/auth.ts` bez `reportAuthError` + fragment do wklejenia.
- `Dalej ręcznie:` — tylko brakujące kroki (puste = wpięcie kompletne).

Wpięcie (init wypisuje dokładny kod):

- Vue: w `main.ts` `app.use(VueQueryPlugin)` **przed** `app.use(createAuth(...))` (z `navigate` routera);
  `<AuthMfaDialogs />` w `App.vue` (poza `<AuthBoundary>` jest OK).
- React Router 7 (`app/root.tsx`): `<AuthProvider client navigate>` wokół `<Outlet />` i `<AuthMfaDialogs />`.
- Trasy chronione w `<AuthBoundary>`, `/login` w `<AuthBoundary mode="guest">` (redirecty robi paczka — bez
  ręcznego `router.push` po loginie).

**Gotowe, gdy:** `vue-tsc -b` / `tsc` i build przechodzą, raport `init` nie ma ostrzeżeń (albo są obsłużone), testy
ręczne przechodzą na dev.

## Przepisy scalania

- **Istniejący `lib/auth.ts`:** zachowaj `baseUrl` (obecną zmienną env), `loginPath`, `homePath`, `broadcastSession`.
  Wklej fragment z raportu `init` (`INLINE_ERRORS`, `reportAuthError` z toastem aplikacji, listener `login-error`);
  istniejący listener `login-error` zastąp — inaczej błędy pokazywane inline (złe hasło, kod) dostaną też toast.
- **Istniejąca strona logowania:** zostaw wygląd. W `catch` logowania: `isAuthError(e, 'MfaRequiredError')` → return
  (krok kodu renderuje się sam), `MfaEnrollmentRequiredError` → `window.location.assign(e.enrollmentUrl)`, reszta →
  `loginErrorMessage(e)`. W widoku: `stage === 'code'` → `<MfaCodeForm>` zamiast formularza hasła, w tej samej karcie.
  Wzór: `node_modules/@musikhood-dev/auth-client/templates/{vue,vue-shadcn}/components/auth/LoginForm.vue` /
  `templates/react-*/components/auth/login-form.tsx`.
- **Istniejące toasty:** zostaw system toastów aplikacji; `reportAuthError` ma go używać (nie dokładaj drugiego).
- **Styl:** z prettier w repo init formatuje pliki jego konfiguracją; bez — pliki zostają w stylu paczki (popraw
  ręcznie albo zostaw, zanotuj w raporcie).
- Wygenerowane pliki są twoje — można je zmieniać (np. przepisać na komponenty UI aplikacji), logikę zostaw 1:1.

## Pułapki (front)

- **Dialogi 2FA poza `<AuthBoundary>`** działają od 2.3.1 (wcześniej `isAuthenticated` poza boundary = zawsze `false`).
- **CORS:** API / backend musi dopuszczać `X-Device-Fp` (`allow_headers`), `Retry-After` (`expose_headers`) i
  credentials (auth server w wariancie (b), backend z bundlem w (a) — `auth-client:install`). Objaw braku: preflight odrzucony, „logowanie nic nie robi”.
- **Ciasteczka:** HttpOnly, nic w JS / localStorage. Front i API na różnych domenach → `SameSite=None; Secure`;
  na subdomenach tej samej domeny wystarcza `lax` z domeną ciasteczka ustawioną na domenę nadrzędną. Lokalnie
  `localhost` przeciw zdalnemu API = ciasteczka stron trzecich — przy blokadzie 3P logowanie nie przejdzie (front na
  domenie, dla której API ustawia ciasteczka, albo lokalne API).
- **403 panelowe ≠ 2FA:** `panel_access_denied` = brak dostępu (nadaj go w panelu administracyjnym); `mfa_step_up` /
  `mfa_enrollment_required` = dialog 2FA, sesja żyje.
- **Błędy po nazwie:** `isAuthErrorNamed(err, 'Name')` / `isAuthError` z `lib/mfa.ts`, nie `instanceof` (entry
  `/react` i `/vue` mają własne kopie klas).
- **Vue:** natywny `autofocus` nie działa w dialogach montowanych później — szablony ustawiają focus przez `ref` +
  `nextTick`; shadcn-vue `Input` ma pasywny `v-model` — filtrowanie pola kodu przez natywny `@input`.
- Nie wprowadzaj drugiej zmiennej env obok istniejącej (np. `VITE_BACKEND_URL`, `VITE_API_URL`, `VITE_API_BASE_URL`).

## Testy ręczne po wdrożeniu

Na dev (konta testowe od operatora; hasła wpisuje człowiek):

1. Konto bez 2FA: logowanie jak dotąd; złe hasło → komunikat pod formularzem, bez toastu.
2. Konto z 2FA: krok kodu; zły kod → „Nieprawidłowy kod”; ponownie użyty kod → komunikat o następnym kodzie.
3. Kod zapasowy: bez checkboxa „Zapamiętaj urządzenie”; logowanie przechodzi; ten sam kod drugi raz nie działa.
4. „Zapamiętaj urządzenie” → wyloguj → zaloguj: bez kodu.
5. Step-up (sesja bez kodu z innego panelu, polityka `required`): dialog; Esc / klik obok nie zamyka; „Wyloguj się”
   → `/login` bez przeładowania.
6. `required` dla konta bez 2FA: przy logowaniu przekierowanie na konfigurację; w sesji dialog z hasłem.
7. Konto bez dostępu do panelu: toast z komunikatem API, front na `/login`.
8. Limit prób (429): „Spróbuj ponownie za … s”.
9. Dialogi w jasnym i ciemnym motywie; `X-Device-Fp` na requestach (DevTools).
