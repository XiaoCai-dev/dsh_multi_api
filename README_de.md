![dsh_multi_api — Multi-Kanal-Modellrelais für DSH](docs/banner.jpg)

# dsh_multi_api

[简体中文](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README.md) · [English](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_en.md) · [日本語](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_ja.md) · [Español](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_es.md) · [Français](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_fr.md) · [Deutsch](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_de.md) · [Русский](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_ru.md) · [Português](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_pt.md)

[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2%2B-4B32C3)](https://github.com/deepseek-ai) [![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org) [![JavaScript](https://img.shields.io/badge/JavaScript-ESM%20%C2%B7%20no%20build-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript) ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Web-lightgrey) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Multi-Kanal-Modellrelais für [DeepSeek Harness](https://github.com/deepseek-ai): ein logisches Modell an mehrere OpenAI-kompatible Endpunkte hängen und still umschalten, wenn ein Kanal kein Guthaben mehr hat, ins Rate-Limit läuft, seinen Schlüssel verliert oder upstream scheitert.**

`dsh_multi_api` holt die Schicht „Kanäle + Modellzuordnung + Failover" von new-api in den DSH-Prozess. Es registriert sich als gewöhnlicher `LlmAdapter` hinter einem virtuellen Anbieter `relay`. Konfigurierte Modelle erscheinen in der Modellauswahl der Unterhaltung und verhalten sich wie native Modelle.

- **Multi-Kanal-Routing** — ein logisches Modell an beliebig viele Kanäle binden; sortiert nach Priorität, innerhalb einer Priorität gewichtet, bei Fehlschlag der nächste Kandidat.
- **Automatisches Failover** — erschöpftes Guthaben, ungültige Zugangsdaten, Rate-Limits, `5xx`, Timeouts oder „dieser Endpunkt kennt das Modell nicht" schalten um. Sobald sichtbare Ausgabe läuft, wird nicht mehr umgeschaltet — zwei Antworten werden nie zusammengestückelt.
- **Abklingzeiten mit Erholung** — 30 Minuten bei Guthaben, 12 Stunden bei ungültigem Schlüssel, `Retry-After` bei Rate-Limits, exponentielles Backoff bei wiederholten Fehlern; der Zustand überlebt Neustarts und lässt sich manuell aufheben.
- **Visuelle Verwaltung** — Kanäle anlegen und bearbeiten, Modelle binden, Erreichbarkeit testen, Upstream-Modelllisten holen und sehen, welcher Kanal welchen Aufruf bedient hat und wie viele Umschaltungen nötig waren.
- **Schlüssel bleiben privat** — sie liegen in der Credential-Schicht von DSH, nie in Konfigurationsdateien, Logs oder Fehlermeldungen.

## Installation / Aktualisierung

Erfordert DeepSeek Harness `0.2.0-rc.2` oder neuer (Desktop oder Web).

### Aus DeepSeek Harness heraus

Linke Seitenleiste **Plugins → Add plugin**: das Verzeichnis dieses Repositories wählen oder die Git-URL ins Suchfeld einfügen.

### Mit der `dsh` CLI

```sh
dsh plugin --profile desktop add git+https://github.com/XiaoCai-dev/dsh_multi_api.git
```

Aus einem lokalen Verzeichnis (für die Entwicklung):

```sh
dsh plugin --profile desktop add /path/to/dsh_multi_api
```

Aktualisieren:

```sh
dsh plugin --profile desktop add git+https://github.com/XiaoCai-dev/dsh_multi_api.git
```

Deinstallieren:

```sh
dsh plugin --profile desktop remove dsh_multi_api
```

Danach DSH neu starten; in der linken Seitenleiste erscheint **Channel relay**.

## Verwendung

| Einstieg | Funktion |
| --- | --- |
| **Kanäle** | Kanäle anlegen, bearbeiten, löschen: Base URL, API-Schlüssel, Priorität, Gewicht, Timeout und die Modelle, die dieser Kanal anbietet (`logisch` oder `logisch=upstream`). Inline: Erreichbarkeit testen, Upstream-Modelle holen, Abklingzeit aufheben. |
| **Modellrouten** | Eine Karte pro logischem Modell mit der Failover-Kette (Kanal A → Kanal B) und der echten Modell-ID hinter jedem Kanal; Bindungen lassen sich hier hinzufügen und entfernen. |
| **Aufrufe & Failover** | Die letzten 200 Aufrufe: Ergebnis (Erfolg / umgeschaltet / alle Kanäle gescheitert), Modell, Gesamtdauer, Kanal-Kette; eine Zeile aufklappen zeigt Fehlercode und Dauer jedes Versuchs. |
| **Modellauswahl** | Konfigurierte logische Modelle erscheinen unter der Gruppe `Channel relay`; auswählen und loslegen. Modelle mit mehreren Kanälen tragen ein `×N`-Abzeichen. |

### Schnellstart

1. **Kanäle → Kanal hinzufügen**: Base URL bis `/v1` (etwa `https://api.deepseek.com/v1`), API-Schlüssel eintragen, dann die Modelle des Kanals auflisten.
2. Zum Testen des Failovers **einen zweiten Kanal anlegen**, mit demselben Modellnamen und einer größeren Prioritätszahl (größer = Reserve).
3. In einer Unterhaltung auf den Modellnamen über dem Eingabefeld klicken → **Modell** → aus der Gruppe `Channel relay` wählen.

Mit nur einem Kanal ändert das Plugin nichts und schaltet nie um — Failover braucht mindestens zwei Kanäle für dasselbe logische Modell.

Das Sitzungsprotokoll notiert immer `provider: relay` und zeigt daher nie, welcher Kanal geantwortet hat; Umschaltungen stehen nur im Aufrufprotokoll des Plugins.

### Einen Kanal konfigurieren

![Formular für einen neuen Kanal](docs/setup-channel.png)

Die Base URL geht bis `/v1`. Das Modellfeld akzeptiert `logisch` oder `logisch=upstream`; beim Speichern werden die Bindungen dieses Kanals ersetzt, und das Ergebnis erscheint sofort in der Modellauswahl.

### In einer Unterhaltung nutzen

![Die Gruppe Channel relay in der Modellauswahl](docs/model-picker.png)

Auswählen und es funktioniert wie jedes native Modell. Steht ein logisches Modell auf mehreren Kanälen, trägt der Eintrag ein `×N`-Abzeichen — das ist die Größe des Failover-Pools.

## Failover-Regeln

| Upstream-Signal | Fehlercode | Umschalten | Kanalzustand |
| --- | --- | --- | --- |
| 402 / 403 / 429 mit Guthaben-Text (`quota`, `balance`, `insufficient`) | `QUOTA` | ja | 30 Minuten Abklingzeit |
| 429 Rate-Limit (mit `Retry-After`) | `RATE_LIMIT` | ja | Abklingzeit (laut Header, 45 s Standard) |
| 401 / 403 ungültiger Schlüssel | `INVALID_CREDENTIAL` | ja | 12 Stunden ungültig, keine Auto-Erholung |
| 404 oder „Modell existiert nicht" | `MODEL_UNSUPPORTED` | ja | diese Bindung kühlt 5 Minuten ab |
| 5xx | `SERVER` | ja | wird gezählt; kühlt erst nach wiederholten Fehlern ab |
| Verbindungsfehler / Timeout | `TRANSPORT` / `TIMEOUT` | ja | exponentielles Backoff, maximal 10 min |
| 200 mit leerem Stream | `EMPTY_RESPONSE` | ja (einmal) | keine Abklingzeit |
| 400 ungültige Anfrage, Kontext zu lang | `INVALID_REQUEST` / `CONTEXT_WINDOW_EXCEEDED` | nein | keine Abklingzeit |
| Vom Nutzer abgebrochen | `aborted` | nein | keine Abklingzeit |

Ein abkühlender Kanal verschwindet nicht aus den Kandidaten, er rutscht ans Ende. Kühlen alle, wird wenigstens einer versucht.

Hat ein logisches Modell mehrere Kanäle, werden die **vorsichtigsten** Fähigkeiten angegeben: das Kontextfenster ist das kleinste über alle Kanäle, sonst würde ein für den breitesten Kanal bemessener Plan zufällig an einer engeren Reserve scheitern.

## Arbeitsteilung mit `dsh-llm-retry`

- **Dieses Plugin**: wechselt den Kanal — eine Anfrage wandert durch die Kanalliste.
- **`dsh-llm-retry`**: wiederholt kurzzeitige Aussetzer auf demselben Kanal und startet einen Step neu.

Deshalb gibt diese Route `undefined` aus `providerRetryPolicy()` zurück: der Host darf eine Anfrage, die bereits alle Kanäle probiert hat, nicht erneut ausführen.

## Daten und Datenschutz

| Was | Wo |
| --- | --- |
| Kanäle, Modellbindungen, Abklingzustand, Aufrufprotokoll | `$DSH_HOME/storages/channel_relay/` |
| API-Schlüssel | `$DSH_HOME/.credentials.yaml`, Eintrag `dsh-channel-relay/<channel-id>` |

Das Löschen eines Kanals entfernt auch seine Bindungen, seinen Abklingzustand und seinen Schlüssel. Das Aufrufprotokoll behält die letzten 200 Einträge. Fehlermeldungen und Logs werden entschärft: Schlüssel und rohe Upstream-Anfragekörper erscheinen nie.

## Bekannte Einschränkungen

- **Nur Text**: es wird keine Bildfähigkeit angegeben, Bildanfragen laufen über den degradierten Pfad von DSH.
- **Nur OpenAI-kompatibles Protokoll** (`/chat/completions`): Anthropic Messages und OpenAI Responses sind nicht implementiert.
- **Nicht prozessübergreifend**: der Abklingzustand lebt im Prozess; zwei DSH-Instanzen zählen getrennt.
- **Kanalwechsel bleiben im Sitzungsprotokoll unsichtbar**: das ist Absicht; diagnostiziert wird über das Plugin-Protokoll.
- Ein Kanalwechsel verliert die Reasoning-Signatur und den Prompt-Cache des Upstreams — bewusst in Kauf genommen.

## Roadmap

- [ ] RPM-/TPM-Limits und Nebenläufigkeitsgrenzen pro Kanal
- [ ] Lokales weiches Budget: Abschalten nach Geld oder Tokens
- [ ] Aktive Guthabenprüfung für Kanäle mit `/balance`
- [ ] Protokolle Anthropic Messages / OpenAI Responses
- [ ] Etikett „aktueller Kanal" am Eingabefeld
- [ ] Inline-Bearbeitung von Bindungen

## Entwicklung

```sh
node --check index.js    # Host-Hälfte
node --check client.js   # Client-Hälfte
```

- `index.js` — Registrierung des `LlmAdapter`, Routing, SSE → `StreamChunk`-Übersetzung, Abkling-Zustandsmaschine, Storage-Domain und Credentials, 9 RPC-Routen
- `client.js` — Seitenleisten-Symbol und Hauptpanel, spricht über `/api/dsh_multi_api/*` mit dem Host
- `DESIGN.md` — Entwurfsbegründung und Abwägungen (inklusive der DSH-Fähigkeitsprüfung)

## License

[MIT](LICENSE)
