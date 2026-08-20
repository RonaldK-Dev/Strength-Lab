/* Strength-Lab Plangenerator.
   Regelbasiert: Split-Vorlagen aus Bewegungsmuster-Slots, jeder Slot hat
   einen nach Präferenz geordneten Kandidaten-Pool aus der statischen
   Übungs-DB (data/exercises.json, Public Domain / free-exercise-db).
   Gefiltert wird nach verfügbarem Equipment. Reine Funktionen, testbar. */
(function (root) {
  'use strict';

  /* Equipment-Profile: was steht zur Verfügung? */
  var EQUIP_PROFILES = {
    gym:     ['barbell', 'dumbbell', 'cable', 'machine', 'body only', 'e-z curl bar', 'kettlebells', 'bands'],
    homegym: ['barbell', 'dumbbell', 'body only', 'e-z curl bar', 'kettlebells', 'bands'],
    minimal: ['dumbbell', 'body only', 'bands', 'kettlebells']
  };

  /* Kandidaten-Pools je Bewegungsmuster, Reihenfolge = Präferenz.
     IDs stammen aus free-exercise-db und werden im Test gegen die
     Datenbasis verifiziert. */
  var POOLS = {
    squat:      ['Barbell_Squat', 'Barbell_Full_Squat', 'Leg_Press', 'Goblet_Squat', 'Bodyweight_Squat'],
    hinge:      ['Barbell_Deadlift', 'Sumo_Deadlift', 'Romanian_Deadlift', 'Hyperextensions_With_No_Hyperextension_Bench'],
    rdl:        ['Romanian_Deadlift', 'Stiff-Legged_Dumbbell_Deadlift', 'Lying_Leg_Curls', 'Seated_Leg_Curl'],
    legIso:     ['Leg_Extensions', 'Barbell_Lunge', 'Dumbbell_Lunges', 'Bodyweight_Walking_Lunge'],
    legCurl:    ['Lying_Leg_Curls', 'Seated_Leg_Curl', 'Glute_Ham_Raise', 'Stiff-Legged_Dumbbell_Deadlift', 'Romanian_Deadlift'],
    glutes:     ['Barbell_Hip_Thrust', 'Barbell_Glute_Bridge', 'Glute_Kickback'],
    calves:     ['Standing_Calf_Raises', 'Calf_Press_On_The_Leg_Press_Machine', 'Seated_Calf_Raise', 'Calf_Raise_On_A_Dumbbell'],
    bench:      ['Barbell_Bench_Press_-_Medium_Grip', 'Dumbbell_Bench_Press', 'Machine_Bench_Press', 'Pushups'],
    incline:    ['Barbell_Incline_Bench_Press_-_Medium_Grip', 'Incline_Dumbbell_Press', 'Leverage_Incline_Chest_Press'],
    chestIso:   ['Flat_Bench_Cable_Flyes', 'Dumbbell_Flyes', 'Butterfly', 'Bodyweight_Flyes'],
    vertPull:   ['Full_Range-Of-Motion_Lat_Pulldown', 'Pullups', 'Chin-Up', 'V-Bar_Pulldown'],
    horizPull:  ['Bent_Over_Barbell_Row', 'Seated_Cable_Rows', 'Bent_Over_Two-Dumbbell_Row', 'Leverage_Iso_Row', 'Inverted_Row'],
    ohp:        ['Standing_Military_Press', 'Seated_Barbell_Military_Press', 'Dumbbell_Shoulder_Press', 'Machine_Shoulder_Military_Press'],
    sideDelts:  ['Side_Lateral_Raise', 'Seated_Side_Lateral_Raise', 'Lateral_Raise_-_With_Bands'],
    rearDelts:  ['Face_Pull', 'Reverse_Flyes', 'Cable_Rear_Delt_Fly'],
    biceps:     ['Barbell_Curl', 'Hammer_Curls', 'Preacher_Curl', 'Concentration_Curls', 'Alternate_Hammer_Curl'],
    triceps:    ['Triceps_Pushdown_-_Rope_Attachment', 'EZ-Bar_Skullcrusher', 'Lying_Triceps_Press', 'Dips_-_Triceps_Version', 'Bench_Dips'],
    tricepsOh:  ['Cable_Rope_Overhead_Triceps_Extension', 'Dumbbell_One-Arm_Triceps_Extension', 'EZ-Bar_Skullcrusher'],
    abs:        ['Cable_Crunch', 'Hanging_Leg_Raise', 'Plank', 'Cross-Body_Crunch']
  };

  /* Muskel je Slot – für Fokus-Extra-Sätze und die Anzeige. */
  var SLOT_MUSCLE = {
    squat: 'quads', hinge: 'back', rdl: 'hamstrings', legIso: 'quads',
    legCurl: 'hamstrings', glutes: 'glutes', calves: 'calves',
    bench: 'chest', incline: 'chest', chestIso: 'chest',
    vertPull: 'lats', horizPull: 'back', ohp: 'shoulders',
    sideDelts: 'shoulders', rearDelts: 'shoulders',
    biceps: 'biceps', triceps: 'triceps', tricepsOh: 'triceps', abs: 'abs'
  };

  var COMPOUND = { squat: 1, hinge: 1, bench: 1, incline: 1, vertPull: 1, horizPull: 1, ohp: 1, rdl: 1 };

  /* Split-Vorlagen: Trainingstage als Slot-Listen. */
  var SPLITS = {
    1: { name: 'Ganzkörper', days: [
      { name: 'Ganzkörper', slots: ['squat', 'bench', 'horizPull', 'ohp', 'rdl', 'biceps', 'triceps', 'abs'] }
    ]},
    2: { name: 'Ganzkörper A/B', days: [
      { name: 'Ganzkörper A', slots: ['squat', 'bench', 'horizPull', 'sideDelts', 'biceps', 'abs'] },
      { name: 'Ganzkörper B', slots: ['hinge', 'ohp', 'vertPull', 'legCurl', 'triceps', 'calves'] }
    ]},
    3: { name: 'Push / Pull / Beine', days: [
      { name: 'Push', slots: ['bench', 'ohp', 'incline', 'sideDelts', 'triceps', 'tricepsOh'] },
      { name: 'Pull', slots: ['hinge', 'vertPull', 'horizPull', 'rearDelts', 'biceps'] },
      { name: 'Beine', slots: ['squat', 'rdl', 'legIso', 'glutes', 'calves', 'abs'] }
    ]},
    4: { name: 'Oberkörper / Unterkörper', days: [
      { name: 'Oberkörper A', slots: ['bench', 'horizPull', 'ohp', 'sideDelts', 'biceps', 'triceps'] },
      { name: 'Unterkörper A', slots: ['squat', 'rdl', 'legIso', 'calves', 'abs'] },
      { name: 'Oberkörper B', slots: ['ohp', 'vertPull', 'incline', 'rearDelts', 'biceps', 'triceps'] },
      { name: 'Unterkörper B', slots: ['hinge', 'legCurl', 'legIso', 'glutes', 'calves'] }
    ]},
    5: { name: 'PPL + Oberkörper/Unterkörper', days: [
      { name: 'Push', slots: ['bench', 'ohp', 'incline', 'sideDelts', 'triceps'] },
      { name: 'Pull', slots: ['hinge', 'vertPull', 'horizPull', 'rearDelts', 'biceps'] },
      { name: 'Beine', slots: ['squat', 'rdl', 'legIso', 'glutes', 'calves'] },
      { name: 'Oberkörper', slots: ['incline', 'horizPull', 'sideDelts', 'biceps', 'triceps'] },
      { name: 'Unterkörper', slots: ['squat', 'legCurl', 'legIso', 'calves', 'abs'] }
    ]},
    6: { name: 'Push / Pull / Beine ×2', days: [
      { name: 'Push A', slots: ['bench', 'ohp', 'sideDelts', 'triceps'] },
      { name: 'Pull A', slots: ['hinge', 'vertPull', 'rearDelts', 'biceps'] },
      { name: 'Beine A', slots: ['squat', 'rdl', 'calves', 'abs'] },
      { name: 'Push B', slots: ['incline', 'ohp', 'chestIso', 'sideDelts', 'tricepsOh'] },
      { name: 'Pull B', slots: ['horizPull', 'vertPull', 'rearDelts', 'biceps'] },
      { name: 'Beine B', slots: ['legIso', 'legCurl', 'glutes', 'calves', 'abs'] }
    ]}
  };

  /* Fokus-Muskel -> zusätzlicher Isolations-Slot. */
  var FOCUS_EXTRA = {
    chest: 'chestIso', back: 'horizPull', lats: 'vertPull', shoulders: 'sideDelts',
    biceps: 'biceps', triceps: 'triceps', quads: 'legIso', hamstrings: 'legCurl',
    glutes: 'glutes', calves: 'calves', abs: 'abs'
  };

  function pickExercise(pool, byId, allowed, used) {
    var fallback = null;
    for (var i = 0; i < pool.length; i++) {
      var ex = byId[pool[i]];
      if (!ex) continue;
      if (allowed.indexOf(ex.equipment) === -1) continue;
      if (used[ex.id]) { if (!fallback) fallback = ex; continue; }
      return ex;
    }
    return fallback; // lieber doppelt als Lücke
  }

  /* generate(exercises, opts)
     opts: { goal: 'hypertrophy'|'strength', daysPerWeek: 1..6,
             equipment: 'gym'|'homegym'|'minimal', focus: muskel|null,
             mesoWeeks: 3..8, deload: bool }
     Rückgabe: Plan-Datenstruktur für plans.data (jsonb). */
  function generate(exercises, opts) {
    var byId = {};
    for (var i = 0; i < exercises.length; i++) byId[exercises[i].id] = exercises[i];
    var allowed = EQUIP_PROFILES[opts.equipment] || EQUIP_PROFILES.gym;
    var split = SPLITS[opts.daysPerWeek] || SPLITS[3];
    var strength = opts.goal === 'strength';

    var days = [];
    for (var d = 0; d < split.days.length; d++) {
      var tpl = split.days[d];
      var slots = tpl.slots.slice();
      // Fokus: Extra-Isolationsslot an passende Tage hängen (max 1x pro Tag).
      if (opts.focus && FOCUS_EXTRA[opts.focus]) {
        var extra = FOCUS_EXTRA[opts.focus];
        var dayMuscles = slots.map(function (s) { return SLOT_MUSCLE[s]; });
        if (dayMuscles.indexOf(opts.focus) !== -1 && slots.indexOf(extra) === -1) slots.push(extra);
      }
      var used = {};
      var exList = [];
      for (var s = 0; s < slots.length; s++) {
        var slot = slots[s];
        var ex = pickExercise(POOLS[slot], byId, allowed, used);
        if (!ex) continue;
        used[ex.id] = true;
        var isCompound = !!COMPOUND[slot];
        // Kraft-Ziel: schwere Grundübungen 3-6 Wdh., sonst Hypertrophie-Bereiche.
        var repLo = strength && isCompound ? 3 : (isCompound ? 6 : 10);
        var repHi = strength && isCompound ? 6 : (isCompound ? 10 : 15);
        var sets = isCompound ? (strength ? 4 : 3) : (strength ? 2 : 3);
        var focused = opts.focus && SLOT_MUSCLE[slot] === opts.focus;
        if (focused) sets += 1;
        exList.push({
          exerciseId: ex.id, slot: slot, muscle: SLOT_MUSCLE[slot],
          sets: sets, repLo: repLo, repHi: repHi,
          compound: isCompound
        });
      }
      days.push({ name: tpl.name, exercises: exList });
    }

    return {
      splitName: split.name,
      goal: opts.goal, equipment: opts.equipment, focus: opts.focus || null,
      mesoWeeks: opts.mesoWeeks, deload: !!opts.deload,
      days: days
    };
  }

  var api = { generate: generate, POOLS: POOLS, SPLITS: SPLITS,
              EQUIP_PROFILES: EQUIP_PROFILES, SLOT_MUSCLE: SLOT_MUSCLE,
              FOCUS_EXTRA: FOCUS_EXTRA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SLGen = api;
})(this);
