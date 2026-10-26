# Asset-Map und Grafikanalyse

Stand: 26.10.2026 · Branch `codex/cinematic-topdown`.

Nach dieser Bestandsaufnahme wurde eine Moduswahl ergänzt: **Classic** verwendet
die ursprünglichen Assets, **Cinematic** den hier analysierten Prototyp.
Die folgenden Befunde zur neuen Grafik beziehen sich auf Cinematic. Beide Modi
sind im Startmenü und während des Spiels wählbar; die Bilder selbst wurden für
diese Umschaltung nicht verändert.

**Weiterentwicklung:** Cinematic v2 setzt inzwischen einen neuen Satz von 28
Einzelbildern ein. Die folgenden Befunde bleiben als Analyse des ersten Prototyps
erhalten. Den aktuellen Satz, Varianten und tatsächliche Auflösungen zeigt der
Abschnitt „Cinematic v2“ im visuellen Katalog; technische Details stehen in
`assets/cinematic/v2/README.md`.

Diese Bestandsaufnahme lässt den vorhandenen Grafikstand bestehen. Sie beschreibt
die ursprünglichen Assets, ihre tatsächliche Verwendung und die Anforderungen an
eine spätere Generierung. In diesem Analyseschritt werden keine Bilder generiert
und keine Änderungen am Spielrenderer vorgenommen.

**Visueller Katalog:** [asset-map.html](asset-map.html) ·
**Maschinenlesbare Zuordnung:** [asset-map.json](asset-map.json).
Der Katalog enthält 100 semantische Zuordnungen zu 97 verschiedenen Zellen aus
`tileset2.png`, einschließlich ungenutzter Varianten. Das sind keine 100 neu
benötigten Bilder. Große Motive anderer Sheets werden separat aufgeführt.

## 1. Befund zur aktuellen Grafik

### Orientierung und Perspektive

In `js/cinematic.js`, Funktion `texture()`, wird jede Geländetextur viermal
zusammengesetzt. `scale(-1, 1)` und `scale(1, -1)` spiegeln sie horizontal bzw.
vertikal. Es findet keine eigentliche Rotation statt; die vertikale Spiegelung
kehrt aber die sichtbare Vorder-/Rückseite perspektivischer Bäume und Bergflanken
um. Zugleich wechselt die eingebrannte Lichtrichtung. Die symmetrischen
Wiederholungen erzeugen zusätzlich ein sichtbares Kaleidoskopmuster.

Der Generierungsprompt forderte eine senkrechte Draufsicht. Die gelieferten Motive
enthalten trotzdem erkennbare Seitenansichten, gerichtete Baumkronen und Schatten;
die Burg zeigt besonders deutlich Fassaden. Ein Prompt allein garantiert daher
keine konsistente Projektion. Diese muss vor der Serienproduktion anhand von
Pilotbildern kontrolliert werden.

**Folgerung:** Eine feste Kamera und Lichtquelle für alle erhöhten Motive.
Bäume, Berge und Gebäude weder drehen noch spiegeln. Abwechslung entsteht durch
eigenständige Varianten mit gleicher Orientierung. Für Bodentexturen zunächst
ebenfalls keine Transformationen zulassen; eine Ausnahme wäre erst nach Prüfung
wirklich richtungsloser Materialien sinnvoll.

### Fehlende Ausbaustufen und zusammengelegte Typen

`Cinematic.structure()` wählt seine Atlaszelle nur nach dem Gebäudetyp.
`tier` beeinflusst ausschließlich die gezeichnete Größe: Faktor 1,50 / 1,62 / 1,74.
Die Architektur bleibt gleich. Die ursprüngliche Funktion `drawStructure()` wählte
dagegen ein eigenes Bild pro Stufe.

Zusätzlich werden Stadt/Burg, Hof/Schaffarm und Steinbruch/Eisenmine im neuen Atlas
jeweils zusammengelegt. Beim Steinbruch gab es bereits im Original eine geteilte
Grafik; Hof und Schaffarm waren hingegen eigenständig unterscheidbar. Der Hafen
hat kein Cinematic-Bild und würde bei einem Aufruf auf das Original zurückfallen.

**Folgerung:** Separate, sofort erkennbare Bauzustände und Produktionsarten.
Mehr Türme, Mauerringe, Nebengebäude, Arbeitsflächen oder Tiergehege statt bloßer
Skalierung desselben Motivs.

### Unschärfe beim Zoomen

Die logische Karte ist 40 × 40 Felder zu je 32 Weltpixeln: 1280 × 1280.
Mausrad und Pinch erlauben Zoom 0,4 bis 3,0. Der finale Terraincanvas ist zwar
2560 × 2560 groß, aber Wald, Berge, Felder und Wasser werden vorher in separaten
**1280 × 1280**-Layern gezeichnet. Deren nachträgliches Vergrößern auf den
Terraincanvas erzeugt keine zusätzliche Information. Bei Zoom 3 wird ein solcher
Layerpixel etwa drei CSS-Pixel breit.

Die Wiese wird direkt auf dem größeren Canvas gezeichnet, stammt aber ebenfalls
aus einem bereits heruntergerechneten Wiederholungsmuster. Die vier
Atlasquadranten haben jeweils 627 × 627 Quellpixel. Sie werden für Wald auf
180 Weltpixel, für Berge/Felder auf 256 und für Wiese auf 240 vorverkleinert.
Die Stärke des Detailverlusts unterscheidet sich dadurch zwischen den Flächen.

Die Burg wird dagegen bei jedem Frame direkt aus einer 627 × 627 großen Atlaszelle
in die gezoomte Ansicht gezeichnet. Sie behält deutlich mehr Quellinformation.
`imageSmoothingEnabled` interpoliert die bereits vergrößerten Geländepixel und macht
den Unterschied sichtbar. Der Blur von 5/7 px in `cinematic.js` betrifft die
**Geländemasken bzw. Übergänge**, nicht pauschal die ganze Textur.

Zusätzlich setzt `resizeCanvas()` die Bildschirmauflösung derzeit nach CSS-Größe,
ohne `devicePixelRatio`. Auf hochauflösenden Displays betrifft diese Begrenzung
die ganze Spielansicht. Größere Bilddateien allein beheben diese Renderkette nicht.

**Folgerung:** Gelände und Bauten mit vergleichbarer Texeldichte rendern und
ausreichende Detailauflösung bis zur maximalen Zoomstufe erhalten. Die nächste
Umsetzung muss auch die Zwischenlayer und den Bildschirmcanvas berücksichtigen.

## 2. Quellen und tatsächliche Nutzung

| Datei | Abmessungen | Inhalt und Verwendung |
|---|---:|---|
| `assets/tileset2.png` | 224 × 160 | Hauptatlas, 14 × 10 Zellen zu 16 × 16 px; ursprüngliche Karte und weiterhin aktive Rohstofficons |
| `assets/reference/tileset2_labeled.png` | beschriftete Vergrößerung | Visuelle Hilfe; nicht selbst als Spritequelle verwenden |
| `assets/tiles.json` | JSON | Atlasdefinition plus zusätzlicher Katalog |
| `js/atlas.js` | JavaScript | Tatsächlich vom Renderer gelesenes Laufzeitmanifest |
| `assets/tileset.png` | 256 × 336 | Weitere Gelände-, Straßen-, Mauer-, Architektur- und Dekormotive; als `ts1` geladen, aber keine Zeichenaufrufe mit diesem Sheet |
| `assets/mountains.png` | 192 × 160 | Große Fels-/Schneebergmotive über mehrere Rasterzellen; als `mtn` geladen, aber keine Zeichenaufrufe mit diesem Sheet |
| `assets/water.png` | 480 × 48 | Vorhanden und im Service-Worker aufgeführt; kein aktueller Lade-/Animationspfad im Sprite-Renderer |
| `assets/cinematic/terrain.png` | 1254 × 1254 | Neuer Versuch: 4 flächige Landschaftsmotive |
| `assets/cinematic/structures.png` | 1254 × 1254 | Neuer Versuch: 4 freigestellte Gebäudemotive |

Die Dateikommentare in `sprites.js` nennen animiertes Wasser; das entspricht
keiner implementierten Wasseranimation. Die Wasser-Wellen des alten Renderers
sind statisch per Hash ausgewählte Kacheln.

**Manifestabweichung:** `structures.stonemine` steht in `js/atlas.js`, fehlt aber in
`assets/tiles.json`. Die Asset-Map verwendet deshalb das Laufzeitmanifest als
Primärquelle und ergänzt den Katalog. Eine spätere Manifest-Neugenerierung muss
diese Abweichung bereinigen, damit der Steinbruch nicht verloren geht.

## 3. Ursprüngliche Gelände- und Wasserzuordnung

Alle Koordinaten sind **[Spalte, Zeile], ab 0**, im unvergrößerten `tileset2.png`.
Pixelrechteck: `[Spalte × 16, Zeile × 16, 16, 16]`.

| Rolle | Originalzelle | Funktion |
|---|---|---|
| Wiese / Landbasis | [1,1] | Untergrund aller Landfelder |
| Wald | [5,0] | Wald mit Boden |
| Gebirge | [6,0] | Felsmotiv mit Boden |
| Acker | kein eigenes Sprite | Code zeichnet Furchen über die Landbasis |
| Wiesendetails | kein eigenes Sprite | Code zeichnet kleine Grasbüschel/Blumen |
| Wald transparent | [5,1] | Vorhanden, im bisherigen Kartenrenderer ungenutzt |
| Gebirge transparent | [6,1] | Vorhanden, im bisherigen Kartenrenderer ungenutzt |

### Wasser: 18 eigene Zellen

| Rolle / Schlüssel | Zelle | Bedeutung im alten Auswahlcode |
|---|---|---|
| `open` | [3,2] | Offenes Wasser |
| `waves[0..4]` | [4,2], [5,2], [6,2], [7,2], [8,2] | Fünf Varianten offenen Wassers |
| `edge.n` | [1,2] | Land nördlich der Wasserkachel |
| `edge.s` | [1,0] | Land südlich |
| `edge.w` | [2,1] | Land westlich |
| `edge.e` | [0,1] | Land östlich |
| `outer.nw` | [3,0] | Land nördlich und westlich |
| `outer.ne` | [4,0] | Land nördlich und östlich |
| `outer.sw` | [3,1] | Land südlich und westlich |
| `outer.se` | [4,1] | Land südlich und östlich |
| `inner.ne` | [0,2] | Nur diagonales Land nordöstlich, ohne orthogonale Landnachbarn |
| `inner.nw` | [2,2] | Nur diagonales Land nordwestlich |
| `inner.se` | [0,0] | Nur diagonales Land südöstlich |
| `inner.sw` | [2,0] | Nur diagonales Land südwestlich |

Die Schlüssel bezeichnen die **Landnachbarschaft**, nicht eine Anweisung, ein
Grundbild zu drehen. Der bisherige Code priorisiert Nachbarschaften per `if/else`;
das ist kein vollständiger 47-Tile-Blob-Autotiler. Die 18 Bilder erhalten den
vorhandenen Vertrag; eine spätere Erweiterung braucht zusätzliche Regeln und
gegebenenfalls zusätzliche Küstenstücke. `catalog.pond_corners` verweist nochmals
auf dieselben vier `outer`-Zellen und ist kein zusätzlicher Bildsatz.

## 4. Bauten und echte Ausbaustufen

### Auf der aktuellen Spielkarte verwendete Typen

| Typ / Schlüssel | Bildstufe 1 | Bildstufe 2 | Bildstufe 3 | Auswahlregel |
|---|---|---|---|---|
| Burg `castle` | [8,5] | [8,6] | [8,7] | Halle 1–2 / 3–4 / 5–6 |
| Holzfäller `woodcutter` | [0,5] | [0,6] | [0,7] | Strukturlevel 1 / 2 / 3 |
| Eisenmine `ironmine` | [2,5] | [2,6] | [2,7] | Strukturlevel 1 / 2 / 3 |
| Steinbruch `stonemine` | [2,5] | [2,6] | [2,7] | Strukturlevel 1 / 2 / 3; gleiche Originalbilder wie Eisenmine |
| Hof `farmstead` | [4,5] | [4,6] | [4,7] | Strukturlevel 1 / 2 / 3 |
| Schaffarm `sheepfarm` | [6,5] | [6,6] | [6,7] | Strukturlevel 1 / 2 / 3 |

Das sind **18 semantische Bildplätze, ursprünglich 15 verschiedene Bilder**.
Für eine eindeutige neue Darstellung von Eisenmine und Steinbruch werden
**18 eigenständige Bilder** vorgeschlagen. Sechs einzelne Hallenlevel benötigen
im vorhandenen Spiel keine sechs Burgbilder; die visuelle Abstufung hat drei
Stufen. Eine feinere Darstellung wäre eine bewusste spätere Erweiterung.

`Sprites.sizeTier(score)` enthält alternativ Schwellen 12 und 26. Auf der
regulären Karte wird jedoch explizit die Hallenstufe übergeben; der Score-Fallback
steuert diese Burgen daher nicht.

### Vorhandene Reserven

| Typ | Bildzellen | Verwendung |
|---|---|---|
| Hafen `harbor` | [10,5], [10,6], [10,7] | Renderer kennt ihn; keine reguläre Platzierung in `RESOURCE_STRUCTURES` |
| Stadt `city` | [12,5], [12,6], [12,7], [12,8] | Vier Atlasbilder; reguläre Dörfer werden als `castle` gerendert |

Die vierte Stadtstufe ist vorhanden, wird aber durch die regulären Auswahlpfade
mit maximal drei Stufen nicht automatisch erreicht. Sie gehört zur Reserve,
nicht zu einer heute sichtbaren vierten Burgstufe.

Zu den sieben ursprünglichen Bildfamilien gibt es außerdem **22 Varianten mit
festem Hintergrund**: Holzfäller Spalte 1, Mine 3, Hof 5, Schaffarm 7, Burg 9,
Hafen 11, Stadt 13; jeweils Zeilen 5–7, Stadt zusätzlich Zeile 8.
Diese sind für eine frei kombinierbare Karte ungeeignet und müssen nicht als
zusätzliche neue Assets generiert werden. Transparente Varianten sind die geraden
Spalten. Für Steinbruch existiert keine eigene Originalfamilie.

## 5. UI, Rahmen und übrige Assets

| Gruppe | Original / Quelle | Status |
|---|---|---|
| Holz, Stein, Nahrung, Eisen | [0,4], [1,4], [3,4], [6,4] | Weiterhin aktive HUD-/Dialogicons; semantische Zuordnung aus Code, unabhängig vom bildlichen Eindruck |
| Wolle, Hammer, Münze, Bewohner | [4,4], [5,4], [7,4], [8,4] | Katalogisiert, im Sprite-Renderer ungenutzt |
| Helle Stein-/Erzvariante | [2,4] | Visuell vorhanden; keine gesicherte Rohstoffzuordnung im Manifest |
| Holzrahmen | [11,1], [12,1], [13,1], [11,2], [13,2], [11,3], [12,3], [13,3] | Acht positionierte Teile; Mitte [12,2] transparent/ungenutzt |
| Schiffe | Spalten 0–7, Zeile 9 | Acht vorhandene Ansichten/Zustände; kein aktiver Schiffsrenderer; keine bestätigte Animationsfolge |
| Transparente Wellen | Spalten 4–8, Zeile 3 | Vorhanden, im Renderer ungenutzt |
| Zeile-3-Schattenbereich | links im Sheet sichtbar | Keine eindeutige semantische Laufzeitzuordnung; nicht als Produktionsasset eingeplant |
| Gebäudeicons | `BUILDING_ART` in `sprites.js` | 10 prozedurale Icons: Halle, Holzfäller, Steinbruch, Eisenmine, Bauernhof, Lager, Kaserne, Schießplatz, Palisade, Wachturm |
| Einheitenicons | `UNIT_ART` in `sprites.js` | 5 prozedurale Icons: Speer, Schwert, Axt, Bogen, Held |
| Hauswappen | `drawCrest()` / UI | Dynamische Farben und 6 Muster; keine fest eingebrannten Hausfarben in neue Gebäude |
| Garnison, Auswahl, Bedrohung, Marsch, Beschriftung | Renderer / UI | Dynamische Spielinformation; getrennt von der Gebäudegrafik erhalten |

Die Gebäudeicons der Verwaltung sind keine Bauzustände der Kartengebäude.
Die zehn Gebäudeicons sind inzwischen für Cinematic durch freigegebene Nahansichten
ersetzt: `assets/cinematic/ui/construction-review.json` dokumentiert die Auswahl.
Classic und der Rückfall bei fehlenden Bildern behalten die prozeduralen Icons.
Cinematic verwendet für Einheiten fünf Kopf-/Waffenporträts aus
`assets/cinematic/ui/unit-icons.json`; Classic behält seine prozeduralen Figuren.
Cinematic verwendet
für Nahrung, Holz, Stein, Eisen und Bevölkerung eigene Bilder aus
`assets/cinematic/ui/resource-icons.json`, gemeinsam für HUD und Kostenanzeigen.
Die großen Gebirge in `mountains.png` und viele Motive in `tileset.png` erstrecken
sich über mehrere Rasterzellen. Ihre Einzelzellen ergeben keine unabhängigen
kleinen Berge; für spätere Nutzung müssten vollständige Motivgrenzen festgelegt
werden. Der visuelle Katalog zeigt dafür die beschrifteten Gesamtsheets.

## 6. Vorgeschlagener Vertrag für die nächste Generation

### Perspektive, Licht und Maßstab

- Feste schräge Draufsicht, passend zur gewünschten Top-down-Spielbarkeit.
  Exakten Winkel zuerst an **einer Burg, einem Baumcluster und einem Felsmotiv**
  gemeinsam prüfen; keine Mischung aus senkrechter Luftaufnahme und stark
  isometrischen Gebäuden.
- Kamera, Objektausrichtung, Schattenrichtung links oben und Tageslicht bleiben
  für jede Variante identisch. Varianten nicht durch Spiegeln/Drehen ableiten.
- Vergleichbare Größenverhältnisse zwischen Baum, Gebäude und Fels. Die
  strategische Karte darf vereinfachen, aber nicht von Variante zu Variante.
- Terrain in Boden und erhöhte Motive trennen: nahtloser Boden unten,
  freigestellte Bäume/Felsen darüber. Überlappung und feste Fußpunkte erlauben
  natürliche Waldränder, ohne perspektivische Objekte weichzumalen.
- Bauten mit echtem Alpha, einheitlichem Fußpunkt, freiem Rand und getrennten
  Zustands-/Besitzermarkierungen. Kein fester quadratischer Landschaftshintergrund.
- Drei Architekturzustände mit gleicher Bildfläche und gleichem Fußpunkt;
  Stufen sollen sich durch Bauform, nicht nur durch Bildgröße unterscheiden.

### Auflösung und Zoom

Für ein 32-Weltpixel-Feld ergibt sich bei Zoom 3 eine Breite von 96 CSS-Pixeln.
Bei Geräte-Pixeldichte 2 sind das **192 physische Pixel**. Daraus folgt als
praktischer Vorschlag mindestens **256 × 256 px je Einzelfeld**. Ein 4 × 4 Felder
großes Landschaftsmodul benötigt bei gleicher Dichte **1024 × 1024 px**, nicht
ebenfalls nur 256 px.

Der derzeit größte Burgmarker ist ungefähr `32 × 1,1 × 1,74 = 61,25` Weltpixel
breit; bei Zoom 3 und Pixeldichte 2 sind das rund **368 physische Pixel**.
**512 × 512 px pro Bauzustand** bietet dafür Reserve. Diese Werte sind eine
Planungsgrundlage für Zoom bis 3 und DPR bis 2, keine Zusage für beliebige
Displaydichten oder spätere größere Marker.

Für die Umsetzung: Boden, Masken und Overlays nicht vorab auf einfache
Weltauflösung reduzieren. Entweder sichtbare Kacheln direkt aus ihren Quellen
zeichnen oder ausreichend aufgelöste Chunks mit Zoom-/DPR-abhängigen Detailstufen
verwenden. Ein kompletter 1280er-Weltcanvas bei 6 Pixeln je Weltpixel wäre
7680 × 7680, rund 225 MiB RGBA **pro Layer**, ohne weitere Browserkopien.
Deshalb ist ein pauschal riesiger Ganzkarten-Cache besonders mobil ungeeignet.
Auch der sichtbare Canvas braucht eine DPR-bewusste Auflösung und passende
Koordinatentransformationen.

### Vorgeschlagene Produktionsblöcke

| Block | Umfang | Priorität |
|---|---:|---|
| Aktive Bauten | 6 Typen × 3 Zustände = **18 Bilder** | Zuerst, getrennte Mine/Steinbruch und Hof/Schaffarm |
| Wiese/Boden | zunächst 4 kantenkompatible Varianten | Pilot; gleichmäßige Details ohne Spiegelmuster |
| Baumcluster | zunächst 6 freigestellte Varianten | Pilot; feste Perspektive, natürliche Außenkonturen |
| Fels-/Gebirgscluster | zunächst 6 freigestellte Varianten | Pilot; feste Perspektive, zusammenhängende Gebirgsgruppen |
| Ackerboden | zunächst 3 kompatible Varianten | Nach Maßstabsprüfung |
| Wasser/Küste | **18 Bilder** bei Erhalt der bisherigen Auswahlregeln | Richtungsgebundene Küsten, keine Transformationen |
| Stadt/Hafen | 4 + 3 = **7 Bilder** | Reserve, erst bei tatsächlichem Bedarf |
| HUD-/Gebäude-/Einheitenicons | getrennte spätere Serie | Nach Freigabe der Kartensprache |

Der aktive Kartensatz wäre mit diesen vorläufigen Variantenzahlen **55 Bilder**
(18 + 4 + 6 + 6 + 3 + 18), ohne Reserven und UI. Die Zahlen für Boden und Cluster
sind Vorschläge; die 18 Bauplätze und die 18 Wasserrollen folgen dagegen dem
untersuchten Bestand. Bei einem anderen Küstenrenderer ändert sich der Wasserblock.

Zuerst wenige Einzelbilder auf Perspektive, Licht und Material abstimmen. Danach
jede Familie mit getrennten, eindeutig benannten Dateien produzieren. Atlanten
erst anschließend deterministisch packen; große generierte Sammelsheets bergen
Risiken bei Zellausrichtung, Randabstand, Stil und Vollständigkeit.

### Abnahme vor der vollständigen Serie

1. Burgstufen 1/2/3 nebeneinander; Architektur auch bei kleinem Zoom unterscheidbar.
2. Burg, Baumcluster und Fels bei gleicher Kamera-/Lichtführung gemeinsam ansehen.
3. Wiederholte Bodenstücke auf Nahtstellen und auffällige Wiederholungsmuster prüfen.
4. Wald-/Felsränder, Wasserübergänge und Objektüberlappung in einer kleinen Testkarte prüfen.
5. Zoom 0,4 / 1 / 3 mit gleichwertiger Terrain-/Gebäudeschärfe testen; danach DPR 1 / 2.
6. Erst dann vollständige Varianten erzeugen und in den Spielrenderer integrieren.

## 7. Reproduzierbarkeit und Grenzen

`node tools/build-asset-map.cjs` erzeugt `docs/asset-map.json` und
`docs/asset-map.html` erneut. Das Werkzeug liest die Atlasquellen, prüft eindeutige
IDs und Zellgrenzen und misst die PNG-Abmessungen direkt aus den Dateien.
Es ändert keine Spielquellen und wird vom Spiel nicht geladen.

Die semantische Bestandsaufnahme stützt sich auf Code, Manifest und die drei
beschrifteten Referenzbilder. Unbenutzte große Sheets werden visuell eingeordnet,
aber ohne erfundene Animationsfolgen oder unbestätigte Motivgrenzen. Die
Unschärfeanalyse folgt der Renderkette; eine Performance-Messung oder Änderung
dieser Renderkette ist nicht Teil dieses Analyseschritts.
