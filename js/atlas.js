/* World of Houses - Tile-Atlas (generiert aus assets/tiles.json).
   Laufzeit-Manifest, da fetch() auf file:// blockiert ist. */
window.WOH = window.WOH || {};
window.WOH.Atlas = {
  "tileSize": 16,
  "note": "Kachelkoordinaten als [Spalte, Zeile] im jeweiligen Sheet. Generiert von tools/gen_atlas.",
  "sheets": {
    "ts2": "assets/tileset2.png",
    "mtn": "assets/mountains.png",
    "ts1": "assets/tileset.png"
  },
  "terrain": {
    "grass": [
      1,
      1
    ],
    "forest": [
      5,
      0
    ],
    "mountain": [
      6,
      0
    ]
  },
  "water": {
    "open": [
      3,
      2
    ],
    "waves": [
      [
        4,
        2
      ],
      [
        5,
        2
      ],
      [
        6,
        2
      ],
      [
        7,
        2
      ],
      [
        8,
        2
      ]
    ],
    "edge": {
      "n": [
        1,
        2
      ],
      "s": [
        1,
        0
      ],
      "w": [
        2,
        1
      ],
      "e": [
        0,
        1
      ]
    },
    "outer": {
      "nw": [
        3,
        0
      ],
      "ne": [
        4,
        0
      ],
      "sw": [
        3,
        1
      ],
      "se": [
        4,
        1
      ]
    },
    "inner": {
      "ne": [
        0,
        2
      ],
      "nw": [
        2,
        2
      ],
      "se": [
        0,
        0
      ],
      "sw": [
        2,
        0
      ]
    },
    "note": "Kacheln NIE rotieren. open=(3,2) ist sauberes Wasser. edge=eine Landseite, outer=zwei orthogonale Landseiten, inner=Land nur diagonal (Gras-Nase in der Ecke)."
  },
  "resources": {
    "food": [
      3,
      4
    ],
    "wood": [
      0,
      4
    ],
    "stone": [
      1,
      4
    ],
    "iron": [
      6,
      4
    ]
  },
  "structures": {
    "woodcutter": [
      [
        0,
        5
      ],
      [
        0,
        6
      ],
      [
        0,
        7
      ]
    ],
    "ironmine": [
      [
        2,
        5
      ],
      [
        2,
        6
      ],
      [
        2,
        7
      ]
    ],
    "stonemine": [
      [
        2,
        5
      ],
      [
        2,
        6
      ],
      [
        2,
        7
      ]
    ],
    "farmstead": [
      [
        4,
        5
      ],
      [
        4,
        6
      ],
      [
        4,
        7
      ]
    ],
    "sheepfarm": [
      [
        6,
        5
      ],
      [
        6,
        6
      ],
      [
        6,
        7
      ]
    ],
    "castle": [
      [
        8,
        5
      ],
      [
        8,
        6
      ],
      [
        8,
        7
      ]
    ],
    "harbor": [
      [
        10,
        5
      ],
      [
        10,
        6
      ],
      [
        10,
        7
      ]
    ],
    "city": [
      [
        12,
        5
      ],
      [
        12,
        6
      ],
      [
        12,
        7
      ],
      [
        12,
        8
      ]
    ],
    "note": "Transparente Varianten (gerade Spalten). Index 0/1/2 = basic/medium/large; city zusaetzlich 3."
  },
  "border": {
    "tl": [
      11,
      1
    ],
    "t": [
      12,
      1
    ],
    "tr": [
      13,
      1
    ],
    "l": [
      11,
      2
    ],
    "r": [
      13,
      2
    ],
    "bl": [
      11,
      3
    ],
    "b": [
      12,
      3
    ],
    "br": [
      13,
      3
    ],
    "note": "9-Slice-Holzrahmen am Spielfeldrand. Mitte (12,2) transparent, ungenutzt. Nicht rotieren."
  }
};
