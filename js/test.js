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

/* 1b. Alle Pool-Übungen haben eine deutsche Anleitung (das ist, was Nutzer
   beim Training tatsächlich sehen). */
var poolIds = {};
Object.keys(gen.POOLS).forEach(function (slot) { gen.POOLS[slot].forEach(function (id) { poolIds[id] = 1; }); });
Object.keys(poolIds).forEach(function (id) {
  assert(byId[id].instructionsDe && byId[id].instructionsDe.length,
    'Pool-Übung ohne deutsche Anleitung: ' + id);
  assert(byId[id].de, 'Pool-Übung ohne deutschen Namen: ' + id);
});
console.log('OK  Alle ' + Object.keys(poolIds).length + ' Plan-Übungen haben deutsche Anleitung');

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

/* 5. Generator: jede Equipment-Kombi/Frequenz/Split-Variante liefert vollständige Tage. */
var EQUIP_COMBOS = [
  gen.EQUIPMENT_TAGS.slice(),                             // alles
  ['barbell', 'dumbbell', 'body only'],                    // Homegym ohne Kabel/Maschine
  ['dumbbell', 'body only', 'bands'],                       // Minimal
  ['barbell', 'body only', 'cable', 'bands']                // genau das Setup aus der Anfrage
];
EQUIP_COMBOS.forEach(function (equip) {
  for (var days = 1; days <= 6; days++) {
    gen.variantsFor(days).forEach(function (variant) {
      var plan = gen.generate(exercises, {
        goal: 'hypertrophy', daysPerWeek: days, splitKey: variant.key,
        equipment: equip, focus: [], mesoWeeks: 5, deload: true
      });
      var tag = equip.join(',') + '/' + days + '/' + variant.key;
      assert.strictEqual(plan.days.length, days, tag + ': falsche Tagesanzahl');
      plan.days.forEach(function (d) {
        assert(d.exercises.length >= 4, tag + '/' + d.name + ': zu wenige Übungen (' + d.exercises.length + ')');
        d.exercises.forEach(function (pe) {
          assert(byId[pe.exerciseId], 'unbekannte Übung ' + pe.exerciseId);
          assert(pe.sets >= 2 && pe.repLo < pe.repHi);
        });
      });
    });
  }
});
console.log('OK  Generator (' + EQUIP_COMBOS.length + ' Equipment-Kombis × 6 Frequenzen × alle Split-Varianten)');

/* 5b. Equipment-Filter wird tatsächlich respektiert, wenn der Pool es hergibt. */
var onlyDumbbell = gen.generate(exercises, {
  goal: 'hypertrophy', daysPerWeek: 3, splitKey: 'ppl',
  equipment: ['dumbbell', 'body only'], focus: [], mesoWeeks: 5, deload: true
});
var offEquip = [];
onlyDumbbell.days.forEach(function (d) { d.exercises.forEach(function (pe) {
  var eq = byId[pe.exerciseId].equipment;
  if (eq !== 'dumbbell' && eq !== 'body only') offEquip.push(pe.exerciseId + ' (' + eq + ')');
}); });
assert.strictEqual(offEquip.length, 0, 'Equipment-Filter ignoriert: ' + offEquip.join(', '));
console.log('OK  Equipment-Filter wird eingehalten');

/* 5c. 3-Tage-Ganzkörper-Variante existiert und unterscheidet sich vom PPL-Split. */
var variants3 = gen.variantsFor(3);
assert(variants3.length >= 2, 'Bei 3 Tagen sollten mehrere Split-Varianten existieren');
var hasFullbody = variants3.some(function (v) { return v.key === 'fullbody'; });
var hasPPL = variants3.some(function (v) { return v.key === 'ppl'; });
assert(hasFullbody && hasPPL, '3-Tage-Splits müssen Ganzkörper UND PPL enthalten');
console.log('OK  Ganzkörper-Option bei 3 Tagen/Woche vorhanden');

/* 6. Fokus (Mehrfachauswahl) erhöht Volumen aller gewählten Zielmuskeln. */
var base = gen.generate(exercises, { goal: 'hypertrophy', daysPerWeek: 3, splitKey: 'ppl', equipment: [], focus: [], mesoWeeks: 5, deload: true });
var foc = gen.generate(exercises, { goal: 'hypertrophy', daysPerWeek: 3, splitKey: 'ppl', equipment: [], focus: ['chest', 'triceps'], mesoWeeks: 5, deload: true });
function setsFor(p, muscle) {
  var n = 0;
  p.days.forEach(function (d) { d.exercises.forEach(function (e) { if (e.muscle === muscle) n += e.sets; }); });
  return n;
}
assert(setsFor(foc, 'chest') > setsFor(base, 'chest'), 'Fokus muss Sätze für Brust erhöhen');
assert(setsFor(foc, 'triceps') > setsFor(base, 'triceps'), 'Fokus muss Sätze für Trizeps erhöhen');
console.log('OK  Mehrfach-Muskel-Fokus');

/* 7. Kraft-Ziel: Grundübungen im 3-6-Bereich. */
var str = gen.generate(exercises, { goal: 'strength', daysPerWeek: 4, equipment: [], focus: [], mesoWeeks: 5, deload: true });
var comp = str.days[0].exercises.filter(function (e) { return e.compound; });
assert(comp.length && comp.every(function (e) { return e.repLo === 3 && e.repHi === 6 && e.sets === 4; }));
console.log('OK  Kraft-Ziel (3-6 Wdh., 4 Sätze)');

console.log('\nAlle Tests bestanden.');
