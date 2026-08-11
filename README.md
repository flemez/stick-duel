# Stick Duel ⚔️

Ein **Strichmännchen-Fechtduell** im Browser — inspiriert von *Stickman-Fighting* und
[**Nidhogg**](https://de.wikipedia.org/wiki/Nidhogg_(Computerspiel)).
Zwei Spieler duellieren sich lokal an einer Tastatur: ein Treffer entscheidet, und über
mehrere Bildschirme hinweg entsteht ein Tauziehen um das **Momentum**.

Läuft komplett offline in jedem modernen Browser — keine Abhängigkeiten, keine Installation.

## ▶️ Jetzt spielen

**[flemez.github.io/stick-duel](https://flemez.github.io/stick-duel/)** — einfach im Browser öffnen.

## Lokal spielen

Da moderne Browser `file://`-Seiten mit strengen Sicherheitsregeln laden, startest du am
einfachsten einen kleinen lokalen Server im Projektordner:

```bash
python3 -m http.server 8017
```

Dann im Browser öffnen: **http://localhost:8017**

Alternativ genügt es oft, `index.html` direkt per Doppelklick zu öffnen.

## Steuerung

| Aktion            | Spieler 1        | Spieler 2            |
|-------------------|------------------|----------------------|
| Laufen            | `A` / `D`        | `◀` / `▶`            |
| Degen hoch        | `W`              | `▲`                  |
| Ducken / tief     | `S`              | `▼`                  |
| Springen          | `Leertaste`      | `Rechte Umschalt`    |
| Zustechen         | `F`              | `.` (Punkt)          |
| Degen werfen      | `G`              | `/` (Slash)          |

Im Menü wählbar: **2 Spieler** oder **1 Spieler vs. CPU**.

## Spielprinzip

- **Ein Treffer tötet.** Ein sauberer Stich in den Körper entscheidet das Duell sofort.
- **Blocken** = Degen auf **derselben Höhe** halten wie der gegnerische Stich (hoch / mitte / tief)
  und dem Gegner zugewandt sein. Kreuzen sich die Klingen, gibt es Rückstoß.
- **Ausweichen:** Über tiefe Stiche **springen**, unter hohe Stiche **ducken**.
- **Degen werfen:** Ein geworfener Degen tötet auf Distanz — trifft er nicht, liegt er am
  Boden und kann von einem **unbewaffneten** Kämpfer wieder aufgehoben werden.
- **Momentum (Tauziehen):** Wer tötet, gewinnt das Momentum und darf vorrücken. Der Getötete
  respawnt **vor** dem Momentum-Halter, um ihn aufzuhalten. Wer als Momentum-Halter den
  gegnerischen Rand erreicht, **gewinnt**.

## Technik

- Reines **HTML5 Canvas** + Vanilla JavaScript, keine Frameworks.
- `index.html` · `style.css` · `game.js`
- Kleine WebAudio-Soundeffekte (keine externen Dateien).

## Aufbau des Codes (`game.js`)

- **Weltmodell**: 5 aneinandergereihte Bildschirme, Kamera folgt dem Mittelpunkt.
- **Fecht-Geometrie**: Klingenhöhe & Trefferboxen in echten Y-Koordinaten → Blocken,
  Ducken und Springen ergeben sich physikalisch.
- **Momentum-/Respawn-System** nach Nidhogg-Vorbild.
- **Einfache KI** für den CPU-Gegner (annähern, Höhe anpassen, zustechen, werfen, ausweichen).

Viel Spaß beim Fechten! 🤺
