# World of Houses

Echtzeit-Strategiespiel im Stil von „Die Stämme" — als Top-Down-Pixel-Art mit
„Game of Thrones"-naher Ästhetik. Reines HTML, CSS und JavaScript, kein Build-Schritt,
keine externen Abhängigkeiten. Per Doppelklick auf `index.html` startbar.

## Start

`index.html` im Browser öffnen. Im Startmenü Schwierigkeit wählen und eine neue Welt
erschaffen oder einen vorhandenen Spielstand fortsetzen. Der Spielstand liegt in der
IndexedDB des Browsers (Fallback: localStorage) und wird automatisch im Intervall
gesichert — nicht-blockierend, sodass das Spiel beim Neuladen oder Browser-Neustart
fortgesetzt werden kann. Beim Fortsetzen wird der Aufbau für die Offline-Zeit
(gedeckelt auf 2 Stunden) nachsimuliert.

## Spielprinzip

Eine prozedural erzeugte Karte (Value-Noise) mit zufällig platzierten Dörfern. Jedes
Dorf gehört zu genau einem Haus mit eigenständigem Namen, Wappen und Motto. Der Spieler
übernimmt ein Haus; alle übrigen werden von einer regelbasierten KI in drei Stufen
gesteuert (Knappe / Ritter / Kriegsherr).

Jedes Dorf produziert Nahrung, Holz, Stein und Eisen auf Grundniveau. Die Umgebung auf
der Karte (Wald, Gebirge, Felder, Wasser) erzeugt Standortboni — manche Dörfer sind in
einem Rohstoff deutlich stärker. Das macht Handel und Eroberung lohnend.

## Gebäude

Halle, Holzfäller, Steinbruch, Eisenmine, Bauernhof, Lager, Kaserne, Schießplatz,
Palisade und Wachturm. Höhere Stufen erhöhen Produktion, Kapazität, Bevölkerung,
Ausbildungstempo oder Verteidigung. Voraussetzungen und steigende Kosten steuern die
Ausbaureihenfolge.

## Einheiten & Kampf

| Einheit       | Rolle      | Angriff | Vert. | Tempo | Kurzprofil |
|---------------|-----------|---------|-------|-------|------------|
| Speerträger   | Defensiv  | 10      | 25    | schnell | günstiger Allrounder |
| Schwertkämpfer| Defensiv  | 25      | 50    | langsam | harter Standverteidiger |
| Axtkämpfer    | Offensiv  | 45      | 10    | schnell | reine Angriffseinheit |
| Bogenschütze  | Defensiv  | 15      | 50    | mittel | sehr stark hinter Mauern/Türmen |

Die Kampfauflösung folgt der bewährten „Die-Stämme"-Mechanik: Angriffskraft (modifiziert
durch Glück ±25 % und Moral) gegen die gewichtete Verteidigung (Einheiten + Palisade +
Grundverteidigung, Turm verstärkt Bogenschützen). Die Verluste folgen einer Potenzkurve.
Gewonnene Angriffe erbeuten Rohstoffe und senken die Treue des Ziels; bei 0 % Treue wird
das Dorf erobert.

Armeen brauchen Reisezeit (Distanz × langsamste Einheit). Eingehende Angriffe auf eigene
Dörfer sind mit Herkunft und Ankunftszeit sichtbar.

## Projektstruktur

```
index.html            Einstieg, lädt Skripte in Abhängigkeitsreihenfolge
css/style.css         Oberflächen-Styling
js/config.js          Balancing & Konstanten (zentral anpassbar)
js/rng.js             Deterministischer Zufall (seed-basiert)
js/houses.js          Hausnamen-, Wappen- und Motto-Generator
js/mapgen.js          Prozedurale Karte, Dorfplatzierung, Standortboni
js/atlas.js           Tile-Atlas (Laufzeit, generiert aus assets/tiles.json)
js/sprites.js         Grafik: lädt /assets-Spritesheets, rendert Gelände,
                      Küsten-Autotiling, Siedlungen und Ressourcen-Icons
assets/               Pixel-Art-Sheets (tileset, tileset2, mountains, water)
assets/tiles.json     Tile-Manifest (Kachelkoordinaten + Katalog)
assets/reference/     Beschriftete Referenzbilder zur Tile-Identifikation
js/village.js         Gebäude-, Produktions- und Bevölkerungslogik
js/combat.js          Kampfauflösung, Tragkapazität, Reisegeschwindigkeit
js/game.js            Zentraler Spielzustand, Tick-Verarbeitung, Bewegungen
js/ai.js              KI-Gegner (Wirtschaft, Ausbildung, Angriff)
js/persistence.js     Speichern/Laden via IndexedDB (Fallback localStorage)
js/ui.js              Karten- & Dorfansicht, HUD, Truppenversand, Chronik
js/main.js            Startmenü, Spielschleife, Auto-Save
```

## Mobile & PWA

Das Spiel ist auf Phone, iPad und Desktop spielbar.

- **Touch-Eingabe:** Karte mit einem Finger verschieben, mit zwei Fingern zoomen (Pinch).
  Burgen und Strukturen werden per Tap ausgewählt; ein langer Tap (≥ 500 ms) öffnet
  die Detail-Ansicht. Auf der Karte ist Doppel-Tap = Doppelklick (Burgansicht öffnen).
- **HUD-Popups:** Tap auf einen HUD-Wert (Holz, Stein, Eisen, Nahrung, Pop) öffnet
  das Info-Popup; Tap außerhalb oder erneut auf den Wert schließt es.
- **Seitenleiste:** Auf Phone und iPad-Portrait ist die Seitenleiste eine Slide-In-Sheet,
  aufrufbar über das Burger-Symbol oben rechts. Escape oder Tap auf den Hintergrund schließt.
- **Burgansicht:** Auf Phone und iPad-Portrait sind Gebäude, Kaserne, Verteidigung und Boni
  als Tabs organisiert; auf iPad-Landscape und Desktop bleibt das Mehrspalten-Layout.
- **Orientierung:** Sowohl Portrait als auch Landscape werden unterstützt.
- **Speicherstände:** Werden pro Gerät in IndexedDB des Browsers gehalten. Es findet kein
  Cloud-Sync statt — wer auf einem anderen Gerät weiterspielen möchte, sollte den
  Speicherstand manuell exportieren (geplant).

### Als App installieren

- **Android (Chrome):** Browser-Menü → „Zum Startbildschirm hinzufügen".
- **iOS/iPadOS (Safari):** Teilen-Menü → „Zum Home-Bildschirm". Das Symbol ist
  die skalierte Burg auf dunklem Hintergrund mit goldenem Rand.
- **Desktop (Chrome/Edge):** In der Adressleiste erscheint ein Installations-Icon
  (oder via Menü → „Installieren").

Nach der Installation läuft das Spiel als Standalone-Fenster ohne Browser-Chrome.
Der Service Worker (`sw.js`) cached alle statischen Assets, sodass das Spiel
auch offline gestartet werden kann.

## Deployment via GitHub Pages

1. Repository auf GitHub anlegen und Code pushen.
2. In den Repo-Settings unter **Pages** als Quelle den Branch (z. B. `main`) und
   Verzeichnis `/ (root)` wählen.
3. Nach kurzer Bauzeit ist das Spiel unter `https://<user>.github.io/<repo>/`
   erreichbar. Die Datei `.nojekyll` im Root-Verzeichnis stellt sicher, dass
   GitHub Pages den Inhalt unverändert ausliefert.
4. Bei jedem Asset-/Code-Update sollte `CACHE_VERSION` in `sw.js` inkrementiert
   werden, damit Clients beim nächsten Aufruf die neuen Dateien ziehen.

## Balancing anpassen

Alle Spielwerte (Produktion, Gebäudekosten, Einheiten-Stats, Kampfparameter,
Schwierigkeitsstufen, Zeit-Skalierung) sind in `js/config.js` gebündelt und ohne
Eingriff in die Logik veränderbar.

## Geplante Erweiterungen (v2)

Weitere Rohstoffe und Gütertypen, aktives Handelssystem zwischen Dörfern, Kavallerie-
und Belagerungseinheiten, Spähen/Aufklärung, Forschung, Mehr-Dorf-Verwaltung und
detaillierte Kampfberichte.
