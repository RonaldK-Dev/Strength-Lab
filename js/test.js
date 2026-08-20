/* Node-Tests für Algorithmus + Generator: node js/test.js
   Kein Test-Framework nötig — assert reicht. */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var algo = require('./algorithm.js');
var gen = require('./generator.js');

var exercises = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'exercises.json'), 'utf8'));
var byId = {};
exercises.forEach(function (e) { byId[e.id] = e; });

/* 1. Alle Pool-IDs müssen in der Datenbasis existieren. */
Object.keys(gen.POOLS).forEach(function (slot) {
  gen.POOLS[slot].forEach(function (id) {
    assert(byId[id], 'Pool-ID fehlt in exercises.json: ' + id + ' (Slot ' + slot + ')');
  });
});
console.log('OK  Pool-IDs vollständig (' + Object.keys(gen.POOLS).length + ' Slots)');

/* 2. e1RM: 100kg x 10 @ RIR 0 => ~133; RIR erhöht den Schätzwert. */
assert(Math.abs(algo.e1rm(100, 10, 0) - 133.33) < 0.1);
assert(algo.e1rm(100, 8, 2) > algo.e1rm(100, 8, 0));
assert.strictEqual(algo.e1rm(100, 1, 0), 100);
console.log('OK  e1RM (Epley, RIR-adjustiert)');

/* 3. Wochen-Parameter: RIR rampt 3->1, Deload in letzter Woche. */
var w1 = algo.weekParams(1, 5, true), w4 = algo.weekParams(4, 5, true), w5 = algo.weekParams(5, 5, true);
assert.strictEqual(w1.targetRir, 3);
assert.strictEqual(w4.targetRir, 1);
assert(w5.isDeload && w5.setFactor === 0.5 && w5.loadFactor === 0.9);
assert(!algo.weekParams(5, 5, false).isDeload);
assert(w4.setBonus === 1 && w1.setBonus === 0);
console.log('OK  Mesozyklus-Wochenparameter');

/* 4. Empfehlung: hohes RIR => Steigerung; RIR 0 unter Range => Reduktion. */
var recUp = algo.recommend([{ weight: 80, reps: 10, rir: 3 }], { repLo: 6, repHi: 10, targetRir: 1, increment: 2.5 });
assert(recUp.weight > 80, 'Bei viel RIR-Reserve muss das Gewicht steigen');
var recDown = algo.recommend([{ weight: 80, reps: 4, rir: 0 }], { repLo: 6, repHi: 10, targetRir: 1, increment: 2.5 });
assert(recDown.weight < 80, 'Unter der Range bei RIR 0 muss das Gewicht sinken');
var recMid = algo.recommend([{ weight: 80, reps: 8, rir: 1 }], { repLo: 6, repHi: 10, targetRir: 1, increment: 2.5 });
assert.strictEqual(recMid.weight, 80);
assert.strictEqual(recMid.reps, 9, 'Innerhalb der Range: +1 Wdh.');
var recDeload = algo.recommend([{ weight: 100, reps: 8, rir: 1 }], { repLo: 6, repHi: 10, targetRir: 4, loadFactor: 0.9, increment: 2.5 });
assert.strictEqual(recDeload.weight, 90);
assert.strictEqual(algo.recommend([], {}), null);
var recBw = algo.recommend([{ weight: 0, reps: 10, rir: 2 }], { repLo: 6, repHi: 15, targetRir: 1, bodyweight: true });
assert(recBw.reps === 12 && recBw.weight === 0);
console.log('OK  Empfehlungs-Logik (Autoregulation)');

/* 5. Generator: jede Frequenz/Equipment-Kombi liefert vollständige Tage. */
['gym', 'homegym', 'minimal'].forEach(function (eq) {
  for (var days = 1; days <= 6; days++) {
    var plan = gen.generate(exercises, { goal: 'hypertrophy', daysPerWeek: days, equipment: eq, focus: null, mesoWeeks: 5, deload: true });
    assert.strictEqual(plan.days.length, days, eq + '/' + days + ': falsche Tagesanzahl');
    plan.days.forEach(function (d) {
      assert(d.exercises.length >= 4, eq + '/' + days + '/' + d.name + ': zu wenige Übungen (' + d.exercises.length + ')');
      d.exercises.forEach(function (pe) {
        assert(byId[pe.exerciseId], 'unbekannte Übung ' + pe.exerciseId);
        var allowed = gen.EQUIP_PROFILES[eq];
        assert(allowed.indexOf(byId[pe.exerciseId].equipment) !== -1,
          eq + ': ' + pe.exerciseId + ' nutzt unerlaubtes Equipment ' + byId[pe.exerciseId].equipment);
        assert(pe.sets >= 2 && pe.repLo < pe.repHi);
      });
    });
  }
});
console.log('OK  Generator (3 Equipment-Profile × 6 Frequenzen)');

/* 6. Fokus erhöht Volumen des Zielmuskels. */
var base = gen.generate(exercises, { goal: 'hypertrophy', daysPerWeek: 3, equipment: 'gym', focus: null, mesoWeeks: 5, deload: true });
var foc = gen.generate(exercises, { goal: 'hypertrophy', daysPerWeek: 3, equipment: 'gym', focus: 'chest', mesoWeeks: 5, deload: true });
function chestSets(p) {
  var n = 0;
  p.days.forEach(function (d) { d.exercises.forEach(function (e) { if (e.muscle === 'chest') n += e.sets; }); });
  return n;
}
assert(chestSets(foc) > chestSets(base), 'Fokus muss Sätze für den Zielmuskel erhöhen');
console.log('OK  Muskel-Fokus');

/* 7. Kraft-Ziel: Grundübungen im 3-6-Bereich. */
var str = gen.generate(exercises, { goal: 'strength', daysPerWeek: 4, equipment: 'gym', focus: null, mesoWeeks: 5, deload: true });
var comp = str.days[0].exercises.filter(function (e) { return e.compound; });
assert(comp.length && comp.every(function (e) { return e.repLo === 3 && e.repHi === 6 && e.sets === 4; }));
console.log('OK  Kraft-Ziel (3-6 Wdh., 4 Sätze)');

console.log('\nAlle Tests bestanden.');
