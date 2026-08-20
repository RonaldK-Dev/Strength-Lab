/* Strength-Lab Progressions-Algorithmus.
   Eigenentwicklung, konzeptionell orientiert an RIR-basierter Autoregulation +
   Double Progression. Reine Funktionen ohne DOM/Netz, damit direkt mit Node
   testbar (node js/test.js). Wird im Browser über window.SLAlgo genutzt. */
(function (root) {
  'use strict';

  /* Geschätztes 1RM nach Epley, um die RIR erweitert: reps + rir =
     Wiederholungen, die bei Satzabbruch am Muskelversagen möglich gewesen
     wären. Freie, allgemein bekannte Formel. */
  function e1rm(weight, reps, rir) {
    var effReps = reps + (rir == null ? 0 : rir);
    if (weight <= 0 || effReps <= 0) return 0;
    if (effReps === 1) return weight;
    return weight * (1 + effReps / 30);
  }

  /* Geschätztes Gewicht für n Wiederholungen bei gegebenem e1RM (Epley
     umgestellt). Für Deload- und Einstiegs-Empfehlungen. */
  function weightForReps(oneRm, reps) {
    if (reps <= 1) return oneRm;
    return oneRm / (1 + reps / 30);
  }

  /* Wochen-Parameter im Mesozyklus. Nicht-Deload-Wochen rampen das Ziel-RIR
     von 3 auf 1 herunter (härter werdende Wochen); ab der 2. Zyklushälfte
     kommt 1 Satz pro Übung dazu. Die letzte Woche ist optional ein Deload
     mit halbiertem Volumen und ~90% Last. */
  function weekParams(week, mesoWeeks, deload) {
    var workWeeks = deload ? mesoWeeks - 1 : mesoWeeks;
    if (deload && week >= mesoWeeks) {
      return { week: week, isDeload: true, targetRir: 4, setFactor: 0.5, setBonus: 0, loadFactor: 0.9 };
    }
    var w = Math.min(week, workWeeks);
    var rir; // 3 -> 1 linear über die Arbeitswochen
    if (workWeeks <= 1) rir = 2;
    else rir = Math.round(3 - 2 * (w - 1) / (workWeeks - 1));
    var setBonus = (workWeeks >= 4 && w > Math.ceil(workWeeks / 2)) ? 1 : 0;
    return { week: week, isDeload: false, targetRir: rir, setFactor: 1, setBonus: setBonus, loadFactor: 1 };
  }

  /* Gewichts-Rundung auf das Geräte-Raster. */
  function roundToIncrement(weight, inc) {
    if (!inc || inc <= 0) inc = 2.5;
    return Math.round(weight / inc) * inc;
  }

  /* Schrittweite je Equipment: Kurzhanteln haben meist 2-kg-Sprünge,
     alles andere 2,5 kg (Scheiben/Steckgewichte). */
  function incrementFor(equipment) {
    if (equipment === 'dumbbell' || equipment === 'kettlebells') return 2;
    return 2.5;
  }

  /* Kern: Empfehlung für die nächste Einheit einer Übung.
     lastSets: Sätze der letzten Einheit dieser Übung, chronologisch
               [{weight, reps, rir}, ...]; leer/null = keine Historie.
     opts: { repLo, repHi, targetRir, loadFactor, increment, bodyweight }
     Rückgabe: { weight, reps, note } oder null (keine Historie). */
  function recommend(lastSets, opts) {
    if (!lastSets || !lastSets.length) return null;
    var inc = opts.increment || 2.5;
    var lo = opts.repLo, hi = opts.repHi;
    var target = opts.targetRir == null ? 2 : opts.targetRir;
    var lf = opts.loadFactor == null ? 1 : opts.loadFactor;

    // Referenz: bester Arbeitssatz der letzten Einheit (höchstes e1RM).
    var top = lastSets[0];
    var best = 0;
    for (var i = 0; i < lastSets.length; i++) {
      var s = lastSets[i];
      var v = e1rm(s.weight, s.reps, s.rir);
      if (v > best) { best = v; top = s; }
    }

    // Körpergewichtsübungen: reine Wiederholungs-Progression.
    if (opts.bodyweight) {
      var prevRir0 = top.rir == null ? target : top.rir;
      var eff0 = top.reps + (prevRir0 - target);
      var reps0 = Math.max(lo, Math.min(hi, eff0 + 1));
      if (lf < 1) reps0 = Math.max(lo, Math.round(reps0 * 0.7));
      return { weight: 0, reps: reps0, note: lf < 1 ? 'Deload' : (eff0 >= hi ? 'Zusatzgewicht erwägen' : '+Wdh.') };
    }

    var prevRir = top.rir == null ? target : top.rir;
    // effReps: Wiederholungen, die beim Ziel-RIR möglich gewesen wären.
    var effReps = top.reps + (prevRir - target);

    // Deload: Last reduzieren, unteres Ende des Bereichs.
    if (lf < 1) {
      return {
        weight: Math.max(0, roundToIncrement(top.weight * lf, inc)),
        reps: lo,
        note: 'Deload'
      };
    }

    if (effReps >= hi) {
      // Oberes Ende erreicht -> Gewicht rauf, Wiederholungen zurück ans
      // untere Ende. Überschuss über hi zusätzlich in Last umrechnen.
      var surplus = effReps - hi;
      var newW = top.weight + inc;
      if (surplus >= 2) newW = roundToIncrement(top.weight * (1 + 0.025 * surplus), inc);
      if (newW <= top.weight) newW = top.weight + inc;
      return { weight: newW, reps: lo, note: 'Gewicht erhöhen' };
    }
    if (effReps < lo) {
      // Zu schwer für den Bereich -> Gewicht leicht runter.
      var down = roundToIncrement(top.weight - inc, inc);
      return { weight: Math.max(0, down), reps: lo, note: 'Gewicht reduzieren' };
    }
    // Im Bereich -> gleiche Last, eine Wiederholung mehr anpeilen.
    return {
      weight: top.weight,
      reps: Math.min(hi, Math.max(lo, effReps + 1)),
      note: '+1 Wdh.'
    };
  }

  var api = { e1rm: e1rm, weightForReps: weightForReps, weekParams: weekParams,
              recommend: recommend, roundToIncrement: roundToIncrement,
              incrementFor: incrementFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SLAlgo = api;
})(this);
