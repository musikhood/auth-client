# Changelog

Wszystkie istotne zmiany w `@musikhood-dev/auth-client`.

Format luźno wg [Keep a Changelog](https://keepachangelog.com/); wersjonowanie semver.

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
