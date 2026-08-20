# Strength-Lab

Selbstgebaute, kostenlose Krafttrainings-App als PWA — inspiriert vom
Funktionsumfang kommerzieller Tracker (Plangenerator, satzweise
Progressions-Empfehlungen, RIR-Autoregulation, Mesozyklen mit Deload),
komplett eigenständig implementiert und ohne Abo.

## Features

- **Plan-Generator**: Trainingsplan nach Ziel (Muskelaufbau/Maximalkraft),
  Frequenz (1–6 Tage/Woche), Equipment (Gym/Homegym/Minimal) und optionalem
  Muskel-Fokus. Splits: Ganzkörper, PPL, Oberkörper/Unterkörper, PPL×2.
- **Progressions-Algorithmus**: Empfiehlt pro Übung Gewicht und
  Wiederholungen für die nächste Einheit — RIR-basierte Autoregulation
  kombiniert mit Double Progression (Details in `js/algorithm.js`).
- **Mesozyklen**: Ziel-RIR rampt über die Wochen von 3 auf 1, ab der
  Zyklushälfte +1 Satz, letzte Woche optional Deload (halbes Volumen, −10% Last).
- **Workout-Logging**: Satz für Satz Gewicht/Wdh./RIR, e1RM-Berechnung
  (Epley, RIR-adjustiert), Pausen-Timer.
- **Fortschritt**: e1RM-Trend pro Übung und Wochen-Tonnage als leichte
  SVG-Charts ohne Fremdbibliothek.
- **Übungs-Bibliothek**: 593 Übungen mit Ausführungsbeschreibung, Suche und
  Muskelgruppen-Filter. Datenbasis:
  [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Public Domain).
- **PWA**: Offline-fähige App-Shell, auf dem Homescreen installierbar.

## Stack

- Vanilla JS/HTML/CSS, kein Build-Step
- [Supabase](https://supabase.com) (Free-Tier): Email/Passwort-Auth +
  Postgres mit Row-Level-Security — jeder Nutzer sieht nur seine eigenen Daten
- Statisches Hosting (GitHub Pages), Fonts lokal (SIL OFL), supabase-js vendored

## Entwicklung

```bash
# Logik-Tests (Algorithmus, Generator, Datenbasis-Konsistenz)
node js/test.js

# Lokal starten
python3 -m http.server 8080
# -> http://localhost:8080
```

## Datenmodell

| Tabelle    | Inhalt                                              |
| ---------- | --------------------------------------------------- |
| `plans`    | Trainingspläne (Struktur als JSONB in `data`)        |
| `workouts` | Absolvierte/laufende Trainingseinheiten              |
| `set_logs` | Einzelne Sätze: Gewicht, Wiederholungen, RIR         |

Die Übungsdatenbank ist statisch (`data/exercises.json`) und wird vom
Service Worker gecacht — sie verursacht keine Datenbank-Last.
