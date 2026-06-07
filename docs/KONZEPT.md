# World of Houses — Spielkonzept

Lebendes Designdokument. Dient als Ankerpunkt, um die Entwicklung fortzusetzen
und zu verfeinern. Stand: laufend gepflegt.

## Vision

Echtzeit-Strategie im Stil von „Die Stämme" als Top-Down-Pixel-Art mit
„Game of Thrones"-naher Ästhetik. Eine prozedural generierte Karte mit
Häusern (eigenständige Namen/Wappen). Der Spieler übernimmt ein Haus; alle
anderen werden von einer KI in mehreren Schwierigkeitsstufen gesteuert.
Reines HTML/CSS/JS, per Doppelklick auf `index.html` lauffähig (kein Build,
kein Server). Speicherung in IndexedDB (Auto-Save, nicht-blockierend).

## Technik & Architektur

- Klassische Skripte unter globalem Namespace `WOH` (kein ES-Module, damit
  `file://` ohne Server funktioniert).
- Reihenfolge: config → rng → houses → mapgen → atlas → sprites → village →
  combat → game → ai → persistence → ui → main.
- `WebFetch`/JSON-`fetch` auf `file://` ist blockiert → Tile-Atlas wird als
  JS (`js/atlas.js`, `WOH.Atlas`) geladen, nicht via JSON-fetch.

## Karte

- Prozedural (Value-Noise) → Geländearten: Wiese, Wald, Gebirge, Wasser, Felder.
- Standortboni je nach Umgebung (Wald→Holz, Gebirge→Stein/Eisen, Felder/Wasser→Nahrung).
- **Wasser-Glättung:** jedes Wasserfeld muss Teil eines mind. 2×2-Wasserblocks
  sein; dünne/isolierte/diagonale Einzelfelder werden zu Gras. So ist die
  Küste immer eindeutig darstellbar. (`mapgen.smoothWater`, auch beim Laden.)
- Dörfer werden nie direkt an Wasser oder Gebirge platziert (8er-Nachbarschaft frei).

## Grafik / Tile-Atlas

- Quelle: `assets/tileset2.png` (16×16-Raster) u. a.; Manifest in
  `assets/tiles.json`, Laufzeit in `js/atlas.js`. Beschriftete Referenzbilder
  in `assets/reference/`.
- **Kacheln werden NIE rotiert.** Das Sheet liefert eigene Stücke für jede
  Kante, Außen- und Innenecke.
- **Wasser/Küste** (Wasser-Blob in Gras), nach Land-Nachbarn:
  - open = (3,2) reines Wasser · waves = (4..8,2)
  - edge: N (1,2), S (1,0), W (2,1), E (0,1)
  - outer (zwei orthogonale Landseiten): NW (3,0), NE (4,0), SW (3,1), SE (4,1)
  - inner (Land nur diagonal, Gras-Nase): NE (0,2), NW (2,2), SE (0,0), SW (2,0)
- **Strukturen** — transparente Varianten (gerade Spalten), Index 0/1/2 =
  basic/medium/large (Stadt zusätzlich 3):
  - Holzfäller (0,5–7), Eisenmine (2,5–7), Hof (4,5–7), Schaffarm (6,5–7),
    Burg (8,5–7), Hafen (10,5–7), Stadt (12,5–8)
  - Ungerade Spalte = „mit Hintergrund" → NICHT für die Karte verwenden
    (Ausnahme denkbar: Holzfäller im Wald mit Hintergrund, s. u.).
- **Ressourcen-Icons:** Nahrung Heu (3,4), Holz Stämme (0,4), Stein (1,4),
  Eisen Schwert (6,4). Im UI als eingebettete `<canvas>` (kein `toDataURL`,
  da `file://` die Canvas „tainted").

## Rohstoffe & Dorf

- Vier Rohstoffe: Nahrung, Holz, Stein, Eisen. Grundproduktion + Gebäudestufen × Standortbonus.
- Gebäude: Halle, Holzfäller, Steinbruch, Eisenmine, Bauernhof, Lager, Kaserne,
  Schießplatz, Palisade, Wachturm. **Alle max. Stufe 6.** Rohstoffkosten
  verdoppeln sich je Stufe (Kostenfaktor 2,0).
- **Halle (Town Hall):** Start auf Stufe 1, jede weitere Stufe dauert doppelt so
  lange; eine höhere Halle verkürzt die Bauzeit anderer Gebäude leicht.
  Burg-Sprite folgt der Halle: Stufe 1–2 klein, 3–4 mittel, 5–6 groß.
  Voraussetzungen: Kaserne ab Halle 2 · Halle 3 = Kaserne + Lager/Bauernhof/
  Steinbruch/Holzfäller/Eisenmine je 2 · Halle 4 = Kaserne 2 + Palisade ·
  Halle 5 = Kaserne 4 + Turm.
- Dorfansicht als modales Overlay (Doppelklick auf eigenes Dorf).

## Einheiten & Kampf

- Speerträger (def), Schwertkämpfer (def, stark), Axtkämpfer (off), Bogenschütze (def, hinter Mauern stark).
- **Held:** max. 1 pro Dorf, sehr teuer. Verteidigt mit der Kraft von 20 Schwert-
  kämpfern (atk 500 / defI 1000). Ermöglicht die Eroberung eines Dorfes und
  verschwindet dabei. Verliert der Angriff, fällt der Held.
- Kampf à la „Die Stämme": Angriffskraft × Glück (±25 %) × Moral gegen gewichtete
  Verteidigung (Einheiten + Palisade + Grundwert; Turm verstärkt Bogenschützen);
  Verluste über Potenzkurve. Armeen mit Reisezeit; eingehende Angriffe sichtbar.
- **Sieg:** Angreifer raubt Rohstoffe (bis Tragkapazität) und führt sie heim.
- **Eroberung:** nur möglich, wenn ein überlebender Held in der Angriffsarmee ist.
  Dann wechselt das Dorf den Besitzer, der Held wird verbraucht, die übrigen
  Überlebenden besetzen es.
- **Kampfbericht-Overlay:** Bei jeder Schlacht, an der der Spieler beteiligt ist,
  öffnet sich ein Bericht (Angreifer/Verteidiger, Einheiten, Stärken, Verluste,
  Glück/Moral, Beute, Ergebnis).

## KI

- Pro Haus, drei Stufen (Knappe/Ritter/Kriegsherr): Wirtschaft, Ausbildung,
  Angriffe; Aggression/Tempo/Startvorsprung skaliert.
- **Angriffe massiert:** greift erst an, wenn die Angriffskraft ≥ 2× der
  Zielverteidigung ist (klarer Sieg, geringe Verluste), schickt dann die volle
  Axt-Armee. Meidet zu starke Burgen, wählt lohnende/nahe besiegbare Ziele,
  behält Verteidiger daheim. Aggressive Häuser bilden mehr Offensive aus.

---

# Erweitertes Siedlungs-/Strukturkonzept (in Arbeit)

Ziel: mehr Vielfalt und strategische Tiefe durch verschiedene Strukturtypen.

## Strukturtypen

- **Burg (castle):** Haupt-Sitz eines Hauses. Zentrum von Wirtschaft, Militär,
  Einflussbereich. Spieler und KI starten je mit einer Burg.
- **Haus / Hof (farmstead):** kleinere Siedlung, häufiger als Burgen.
- **Stadt (city):** in mehreren Ausprägungen; je größer, desto seltener.
  (Funktion vorerst offen — kommt später.)
- **Hafen (harbor):** nur an Küsten von Seen/Meeren. (Funktion später.)
- **Rohstoff-Strukturen** (neutral, eroberbar): Holzfäller, Eisenmine, Hof,
  Schaffarm. Liefern erheblich mehr Rohstoffe als die Basisproduktion.
  Schaffarm liefert Nahrung.

## Generierungs-Regeln (Karte)

- Weniger Burgen als Häuser am Anfang.
- Städte in unterschiedlichen Größen erzeugen — je größer, desto seltener.
- Zusätzlich wenige Rohstoff-Strukturen verteilen, nach Gelände:
  - **Hof/Farmen** wahrscheinlicher auf größeren freien (offenen) Flächen.
  - **Holzfäller** im Wald — damit kein Baum durchscheint, dort entweder die
    „mit Hintergrund"-Variante nutzen ODER die Bäume an der Stelle entfernen.
  - **Eisenmine** direkt neben Gebirge platzieren.
  - **Hafen** nur an Küsten von Wasserflächen (Seen/Meere).

## Eroberungs-/Einflussmechanik

- Liegt eine Rohstoff-Struktur (Holzfäller, Eisenmine, Hof, Schaffarm) im
  **Einflussbereich** einer Burg, kann sie erobert werden.
- Eroberte Rohstoff-Strukturen erhöhen die Rohstoffzufuhr der besitzenden Burg
  deutlich (Schaffarm → Nahrung, Holzfäller → Holz, Eisenmine → Eisen, Hof → Nahrung/gemischt).
- Einflussbereich = Radius um die Burg (Wert noch festzulegen, ggf. mit Ausbau wachsend).

## Offene Punkte / spätere Schritte

- Städte und Häfen: Funktion/Spielnutzen definieren.
- Quadranten-Autotiling für pixelgenaue Küsten in seltenen Mehrfach-Diagonalfällen.
- Handelssystem zwischen Siedlungen; weitere Güter.
- Kavallerie/Belagerung; Spähen/Aufklärung; Forschung.
- Größenwachstum von Siedlungen visuell an Ausbaustand koppeln (basic/medium/large).

---

# Neutrale Rohstoff-Strukturen (Detailmechanik, in Umsetzung)

Konkretisierte Spezifikation des bislang nur skizzierten Systems aus
„Erweitertes Siedlungs-/Strukturkonzept". Ersetzt die dortigen, weniger
präzisen Aussagen, sobald implementiert.

## Strukturtypen und Produktion

Vier eroberbare Rohstoff-Strukturen, jede liefert genau **einen** Rohstoff:

| Struktur     | Rohstoff   | Platzierung                  |
|--------------|------------|------------------------------|
| Holzfäller   | Holz       | im/am Wald (Bäume entfernt oder Hintergrund-Sprite) |
| Eisenmine    | Eisen      | direkt neben Gebirge         |
| Hof          | Nahrung    | offene Fläche                |
| Schaffarm    | Nahrung    | offene Fläche                |
| Hafen        | (offen)    | nur an Küsten — Funktion später |

Strukturen sind **dauerhaft auf der Karte**. Sie werden nicht aufgesammelt
oder zerstört, sondern wechseln ausschließlich den Besitzer
(neutral → Haus, Haus → anderes Haus).

## Stufen, Produktion, Lager

Strukturen haben drei Ausbaustufen. Produktion läuft pro Spielsekunde
(„Tick" = 1 s, konsistent mit der bestehenden Sekunden-Produktion).

| Stufe | Produktion (Einheiten/Tick) | Eigenes Lager |
|-------|------------------------------|---------------|
| 1     | 10                           | 5.000         |
| 2     | 20                           | 12.500        |
| 3     | 30                           | 20.000        |

Neutrale Strukturen produzieren in ihr **eigenes** Lager (gedeckelt). Sobald
das Lager voll ist, stoppt die Produktion bis Rohstoffe entnommen werden.

## Besitz und Ressourcenfluss

- **Neutrale Strukturen** produzieren in ihr eigenes Lager. Häuser können
  Trupps schicken, um Rohstoffe **abzuholen** (siehe „Sammeln").
- **Eroberte (eigene) Strukturen** produzieren direkt in das Burg-Lager
  des Besitzers, kein manuelles Abholen nötig. Das eigene Lager der
  Struktur entfällt damit als Engpass — übersteigt die Produktion die
  Burg-Lagerkapazität, geht der Überschuss verloren (Standardverhalten
  des bestehenden Burg-Lagers).

## Sammeln (Trupp zu neutraler/fremder Struktur)

- Spieler oder KI entsenden Einheiten zu einer Struktur. Mechanik
  vollständig analog zum bestehenden Angriffs- und Tragkapazitätssystem.
- Reisezeit nach `MOVEMENT`-Regeln (langsamste Einheit × Distanz).
- Am Ziel: Falls die Struktur einen Verteidiger hat, läuft Kampf nach
  bestehender Logik (siehe „Verteidigung"). Bei erfolgreichem Sammeln
  (kein Verteidiger oder Verteidiger besiegt) füllen die Einheiten ihre
  Tragkapazität aus dem Strukturlager und tragen die Beute heim.
- Sammeln ohne Held lässt die Struktur **im bisherigen Besitz** (neutral
  oder fremd). Nur die Rohstoffe wandern zur sammelnden Burg.

## Eroberung (mit Held)

- Ist in der Sammelarmee ein **überlebender Held** dabei, wechselt die
  Struktur nach erfolgreichem Kampf in den Besitz des angreifenden
  Hauses. Der Held wird verbraucht (analog zur Burg-Eroberung).
- Ab dem Eroberungs-Tick produziert die Struktur direkt in das Burg-Lager
  des neuen Besitzers (s. o.).

## Verteidigung (Garnison)

- In einer eigenen Struktur können bis zu **100 Kämpfer dauerhaft
  stationiert** werden (frei wählbare Mischung aus Speer/Schwert/Axt/Bogen;
  Held nicht stationierbar — er bleibt zur Eroberung notwendig).
- Garnison verteidigt nach bestehender Kampflogik (Einheiten-Verteidigung,
  ohne Palisaden- oder Turm-Boni — Strukturen haben keine Mauern).
- Garnison wird beim Stationieren von der Quell-Burg abgezogen und
  belegt dort keine Bevölkerung mehr; Versorgung läuft zentral aus dem
  besitzenden Haus.

## Bevölkerungsbonus durch eroberte Strukturen

- Jede eroberte Struktur erhöht das Bevölkerungslimit (`maxPop`) **einer**
  Burg um einen stufenabhängigen Bonus. Die Bonus-empfangende Burg heißt
  **Heimatburg** der Struktur (`structure.assignedCastleId`).
- Beim Eroberungs-Resolver wird `assignedCastleId` auf die Heimatburg
  des Helden gesetzt, der die Eroberung durchgeführt hat. Damit ist die
  Zuweisung beim Besitzwechsel eindeutig und ohne zusätzliche Spieler-
  interaktion festgelegt.
- Bonus skaliert mit Strukturstufe (Vorschlagswerte; siehe Balancing-
  Begründung im separaten Vorschlag):

| Stufe | Bonus auf `maxPop` der Heimatburg |
|-------|------------------------------------|
| 1     | +20                                |
| 2     | +40                                |
| 3     | +60                                |

- Der Bonus wirkt **nicht** auf die Versorgungskapazität anderer
  Burgen — er ist exklusiv an die zugewiesene Heimatburg gebunden.

### Heimatburg-Verlust und Neuzuweisung

- **Heimatburg wird erobert/vernichtet:** Alle ihr zugewiesenen
  Strukturen werden automatisch der **nächstgelegenen anderen eigenen
  Burg** der Fraktion zugewiesen (`assignedCastleId` neu gesetzt). Der
  Bonus bleibt der Fraktion damit erhalten. Begründung: Der Verlust
  einer Burg ist bereits ein erheblicher Rückschlag; den
  Strukturen-Bonus zusätzlich zu entziehen wäre doppelt bestrafend und
  würde die strategische Tiefe (Strukturen als langfristiges Asset)
  entwerten.
- **Fraktion hat keine Burgen mehr:** Strukturen werden **neutral**
  (Lager bleibt erhalten, Garnison wird aufgelöst — Spiel ist für
  diese Fraktion ohnehin verloren).
- **Manuelle Neuzuweisung:** Im Struktur-Verwaltungs-Overlay gibt es
  einen Button **„Heimatburg ändern"**, der einen Picker aller eigenen
  Burgen öffnet. Der Bonus wechselt sofort zur neuen Burg. Sinnvoll,
  wenn der Spieler den Pop-Bonus strategisch auf eine bestimmte Burg
  konzentrieren möchte (z. B. Frontburg ausbauen).

## Ausbau eroberter Strukturen

- Eroberte Strukturen sind auf Stufe 1 und können auf 2 bzw. 3 ausgebaut
  werden. Kosten werden vom Burg-Lager des Besitzers gezahlt.
- Vorschlag (orientiert an `BUILDINGS.costFactor = 2.0` und am
  Kosten-Niveau von Kaserne/Wachturm; siehe Balancing-Begründung im
  separaten Vorschlag):

| Upgrade | Holz  | Stein | Eisen |
|---------|-------|-------|-------|
| 1 → 2   | 1.800 | 1.500 | 900   |
| 2 → 3   | 3.600 | 3.000 | 1.800 |

- Bauzeit Stufe 1→2: 240 Spielsekunden; 2→3: 480 Spielsekunden (Faktor 2,0).

## Unterstützung anfordern (gilt symmetrisch für Burgen und Strukturen)

- Klick auf eine **eigene** Burg oder Struktur öffnet (zusätzlich zu den
  bisherigen Aktionen) den Button **„Unterstützung anfordern"**.
- Picker analog zum Angriffs-Dialog: Auswahl einer beliebigen anderen
  eigenen Burg oder Struktur als Quelle; Auswahl der zu entsendenden
  Einheiten und/oder Rohstoffe.
- Bewegung läuft als neuer Bewegungstyp **`support`** (entsendet Einheiten
  und/oder Ressourcen, ohne Kampf — am Ziel werden Einheiten der Garnison
  bzw. der Quell-Burg-Truppen hinzugefügt, Ressourcen dem Ziel-Lager).
- Symmetrisch zulässig: Burg → Burg, Burg → Struktur, Struktur → Burg,
  Struktur → Struktur.
- Strukturen können nur senden, was sie haben: ihr eigenes Lager (falls
  neutral-eigen, also vor Übernahme der Direkt-Produktion noch nicht
  zutreffend — nach Eroberung leer, da Produktion direkt in die Burg
  geht) bzw. ihre Garnison (max. 100 Kämpfer).

## Offene Detailpunkte

- Hafen-Produktion (Rohstoff/Funktion) noch offen.
- Differenzierte Upgrade-Kosten je Strukturtyp (Holzfäller braucht
  z. B. weniger Holz, mehr Stein/Eisen) bewusst zunächst zurückgestellt
  zugunsten einer einheitlichen Tabelle. Optional in v2 nachschärfen.
- Einflussbereich-Mechanik aus Abschnitt „Eroberungs-/Einflussmechanik"
  (Radius um Burg) bleibt parallel als zusätzliche Restriktion erhalten
  oder wird verworfen — Entscheidung folgt im Umsetzungsschritt.
