/* =========================================================================
 * World of Houses – Seeded RNG (Mulberry32)
 * Deterministische Zufallszahlen, damit dieselbe Seed dieselbe Karte erzeugt.
 * ========================================================================= */
(function (WOH) {
  'use strict';

  function Mulberry32(seed) {
    this.s = seed >>> 0;
  }
  Mulberry32.prototype.next = function () {
    this.s |= 0; this.s = (this.s + 0x6D2B79F5) | 0;
    var t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Gleitkomma in [min, max)
  Mulberry32.prototype.range = function (min, max) {
    return min + this.next() * (max - min);
  };
  // Ganzzahl in [min, max] inkl.
  Mulberry32.prototype.int = function (min, max) {
    return Math.floor(this.range(min, max + 1));
  };
  // Zufälliges Element
  Mulberry32.prototype.pick = function (arr) {
    return arr[Math.floor(this.next() * arr.length)];
  };
  // Mische Array (Fisher-Yates), in-place
  Mulberry32.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this.next() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  Mulberry32.prototype.chance = function (p) { return this.next() < p; };

  WOH.RNG = function (seed) { return new Mulberry32(seed); };
  WOH.randomSeed = function () { return (Math.random() * 0xFFFFFFFF) >>> 0; };
})(window.WOH = window.WOH || {});
