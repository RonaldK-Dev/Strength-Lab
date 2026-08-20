/* Strength-Lab App: UI, State, Supabase.
   Vanilla JS, kein Build-Step. Views werden in #root gerendert,
   Navigation über location.hash. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://hrmkpwiwdmsuosdyehwq.supabase.co';
  /* Publishable Key: darf öffentlich sein, Sicherheit kommt aus RLS. */
  var SUPABASE_KEY = 'sb_publishable_noGwk7sJrpok8MsGgiFcLQ_YKeNK5wV';
  var VERSION = '1.2.0';

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  /* ---------- State ---------- */
  var S = {
    session: null,
    exercises: [],
    byId: {},
    plan: null,          // aktiver Plan (Zeile aus plans)
    planWorkouts: [],    // abgeschlossene Workouts des aktiven Plans
    workout: null,       // laufendes Workout {row, day, week, params, logs:{exId:[sets]}, last:{exId:[sets]}, recs:{exId:rec}}
    lastSetAt: null,
    timerInterval: null,
    libFilter: { q: '', muscle: '' },
    progressEx: null
  };

  /* ---------- Labels ---------- */
  var MUSCLE_DE = {
    chest: 'Brust', back: 'Rücken', lats: 'Lat', shoulders: 'Schultern',
    biceps: 'Bizeps', triceps: 'Trizeps', quads: 'Quadrizeps',
    hamstrings: 'Beinbeuger', glutes: 'Gesäß', calves: 'Waden', abs: 'Bauch'
  };
  var DB_MUSCLE_DE = {
    'chest': 'Brust', 'lats': 'Rücken', 'middle back': 'Rücken', 'lower back': 'Unterer Rücken',
    'traps': 'Nacken/Trapez', 'shoulders': 'Schultern', 'biceps': 'Bizeps', 'triceps': 'Trizeps',
    'forearms': 'Unterarme', 'abdominals': 'Bauch', 'quadriceps': 'Quadrizeps',
    'hamstrings': 'Beinbeuger', 'glutes': 'Gesäß', 'calves': 'Waden',
    'adductors': 'Adduktoren', 'abductors': 'Abduktoren', 'neck': 'Nacken'
  };
  var EQUIP_DE = {
    'barbell': 'Langhantel', 'dumbbell': 'Kurzhantel', 'cable': 'Kabelzug',
    'machine': 'Maschine', 'body only': 'Körpergewicht', 'e-z curl bar': 'SZ-Stange',
    'kettlebells': 'Kettlebell', 'bands': 'Band'
  };
  var LIB_GROUPS = [
    ['', 'Alle'], ['chest', 'Brust'], ['back', 'Rücken'], ['shoulders', 'Schultern'],
    ['biceps', 'Bizeps'], ['triceps', 'Trizeps'], ['quadriceps', 'Beine'],
    ['hamstrings', 'Beinbeuger'], ['glutes', 'Gesäß'], ['calves', 'Waden'], ['abdominals', 'Bauch']
  ];
  var LIB_GROUP_MAP = {
    back: ['lats', 'middle back', 'lower back', 'traps'],
    quadriceps: ['quadriceps'], chest: ['chest'], shoulders: ['shoulders'],
    biceps: ['biceps'], triceps: ['triceps'], hamstrings: ['hamstrings'],
    glutes: ['glutes'], calves: ['calves'], abdominals: ['abdominals']
  };

  /* ---------- Utils ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtW(n) {
    if (n == null) return '–';
    var v = Math.round(n * 100) / 100;
    return String(v).replace('.', ',');
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  /* Deutscher Name mit Fallback aufs englische Original (bei ~8% der
     593 Übungen konnte das Übersetzungs-Wörterbuch keinen sauberen
     Kernbegriff erkennen). */
  function exName(id) {
    var ex = S.byId[id];
    if (!ex) return id;
    return ex.de || ex.name;
  }
  /* Anleitung: deutsch für die ~70 vom Plangenerator genutzten Übungen,
     sonst englisches Original (mit Hinweis in der UI). */
  function exInstructions(ex) {
    if (ex.instructionsDe && ex.instructionsDe.length) return { steps: ex.instructionsDe, en: false };
    return { steps: ex.instructions || [], en: true };
  }
  function root() { return document.getElementById('root'); }
  function toast(msg, isError) {
    var t = document.createElement('div');
    t.className = 'toast' + (isError ? ' toast-err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 2600);
  }
  function go(hash) { location.hash = hash; }

  /* ---------- Daten laden ---------- */
  function loadExercises() {
    return fetch('data/exercises.json').then(function (r) { return r.json(); }).then(function (list) {
      S.exercises = list;
      S.byId = {};
      list.forEach(function (e) { S.byId[e.id] = e; });
    });
  }

  function loadActivePlan() {
    return sb.from('plans').select('*').eq('active', true)
      .order('created_at', { ascending: false }).limit(1)
      .then(function (res) {
        if (res.error) throw res.error;
        S.plan = res.data && res.data[0] ? res.data[0] : null;
        if (!S.plan) { S.planWorkouts = []; return; }
        return sb.from('workouts').select('id, day_index, week, started_at, finished_at')
          .eq('plan_id', S.plan.id).order('started_at', { ascending: true })
          .then(function (r2) {
            if (r2.error) throw r2.error;
            S.planWorkouts = r2.data || [];
          });
      });
  }

  /* Nächster Trainingstag + Woche aus der Anzahl abgeschlossener Workouts. */
  function nextSlot() {
    if (!S.plan) return null;
    var days = S.plan.data.days.length;
    var meso = S.plan.data.mesoWeeks;
    var done = S.planWorkouts.filter(function (w) { return w.finished_at; }).length;
    var total = days * meso;
    var cycle = Math.floor(done / total) + 1;
    var c = done % total;
    return { dayIndex: c % days, week: Math.floor(c / days) + 1, cycle: cycle, done: done };
  }

  function openWorkout() {
    return S.planWorkouts.find(function (w) { return !w.finished_at; }) || null;
  }

  /* ---------- Auth ---------- */
  function viewLogin() {
    root().innerHTML =
      '<div class="header"><h1>Strength<span class="accent">Lab</span></h1>' +
      '<p class="sub">Progressives Krafttraining. Dein Algorithmus, deine Daten.</p></div>' +
      '<div class="card">' +
      '<label>Email</label><input id="auth-email" type="email" autocomplete="username" placeholder="du@example.com">' +
      '<label>Passwort</label><input id="auth-pass" type="password" autocomplete="current-password" placeholder="mind. 6 Zeichen">' +
      '<button class="btn btn-primary" onclick="App.login()">Anmelden</button>' +
      '<button class="btn btn-ghost" onclick="App.register()">Registrieren</button>' +
      '<p id="auth-msg" class="muted small"></p>' +
      '</div>' +
      '<p class="footer-note">v' + VERSION + ' · Open Source · Übungsdaten: free-exercise-db (Public Domain)</p>';
  }

  function authInputs() {
    return {
      email: document.getElementById('auth-email').value.trim().toLowerCase(),
      pass: document.getElementById('auth-pass').value
    };
  }

  function login() {
    var a = authInputs();
    if (!a.email || !a.pass) return toast('Email und Passwort eingeben', true);
    sb.auth.signInWithPassword({ email: a.email, password: a.pass }).then(function (res) {
      if (res.error) return toast('Login fehlgeschlagen: ' + res.error.message, true);
      // onAuthStateChange übernimmt
    });
  }

  function register() {
    var a = authInputs();
    if (!a.email || a.pass.length < 6) return toast('Email + Passwort (mind. 6 Zeichen)', true);
    sb.auth.signUp({ email: a.email, password: a.pass }).then(function (res) {
      if (res.error) return toast('Registrierung fehlgeschlagen: ' + res.error.message, true);
      if (res.data && res.data.session) return; // direkt eingeloggt
      document.getElementById('auth-msg').textContent =
        'Bestätigungs-Email verschickt. Bitte Postfach prüfen, dann anmelden.';
    });
  }

  function logout() {
    sb.auth.signOut().then(function () { S.plan = null; S.workout = null; go('#login'); });
  }

  /* ---------- Navigation / Shell ---------- */
  function navBar(active) {
    var items = [
      ['#home', 'Start', '⌂'], ['#plan', 'Plan', '▤'], ['#progress', 'Verlauf', '↗'],
      ['#library', 'Übungen', '≡'], ['#settings', 'Mehr', '⋯']
    ];
    return '<nav class="nav">' + items.map(function (it) {
      return '<a href="' + it[0] + '" class="' + (active === it[0] ? 'active' : '') + '">' +
        '<span class="nav-ico">' + it[2] + '</span>' + it[1] + '</a>';
    }).join('') + '</nav>';
  }

  function shell(title, contentHtml, activeNav) {
    root().innerHTML =
      '<div class="header header-sm"><h1>' + title + '</h1></div>' +
      '<div class="content">' + contentHtml + '</div>' +
      navBar(activeNav);
  }

  /* ---------- Home / Dashboard ---------- */
  function viewHome() {
    var html = '';
    var open = openWorkout();
    if (open) {
      html += '<div class="card card-accent"><h2>Offenes Workout</h2>' +
        '<p class="muted">' + fmtDate(open.started_at) + ' · ' + esc(dayName(open.day_index)) + '</p>' +
        '<button class="btn btn-primary" onclick="App.resumeWorkout(\'' + open.id + '\')">Fortsetzen</button>' +
        '<button class="btn btn-ghost" onclick="App.discardWorkout(\'' + open.id + '\')">Verwerfen</button></div>';
    }
    if (S.plan) {
      var slot = nextSlot();
      var p = S.plan.data;
      var day = p.days[slot.dayIndex];
      var params = SLAlgo.weekParams(slot.week, p.mesoWeeks, p.deload);
      html += '<div class="card"><div class="row-between"><h2>' + esc(day.name) + '</h2>' +
        '<span class="badge' + (params.isDeload ? ' badge-deload' : '') + '">' +
        (params.isDeload ? 'DELOAD' : 'Woche ' + slot.week + '/' + p.mesoWeeks) + '</span></div>' +
        '<p class="muted small">' + esc(p.splitName) + ' · Zyklus ' + slot.cycle +
        ' · Ziel-RIR ' + params.targetRir + '</p>' +
        '<ul class="ex-preview">' + day.exercises.map(function (pe) {
          var sets = Math.max(1, Math.round((pe.sets + params.setBonus) * params.setFactor));
          return '<li>' + esc(exName(pe.exerciseId)) + ' <span class="muted">' + sets + '×' + pe.repLo + '–' + pe.repHi + '</span></li>';
        }).join('') + '</ul>' +
        (open ? '' : '<button class="btn btn-primary" onclick="App.startWorkout(' + slot.dayIndex + ',' + slot.week + ')">Workout starten</button>' +
          '<details class="other-days"><summary class="muted small">Anderen Tag wählen</summary>' +
          p.days.map(function (d2, i) {
            return i === slot.dayIndex ? '' :
              '<button class="btn btn-ghost btn-sm" onclick="App.startWorkout(' + i + ',' + slot.week + ')">' + esc(d2.name) + '</button>';
          }).join('') + '</details>') +
        '</div>';
    } else {
      html += '<div class="card"><h2>Kein aktiver Plan</h2>' +
        '<p class="muted">Erstelle deinen ersten Trainingsplan – abgestimmt auf Ziel, Frequenz und Equipment.</p>' +
        '<button class="btn btn-primary" onclick="location.hash=\'#generator\'">Plan generieren</button></div>';
    }
    // Letzte Workouts
    html += '<div class="card"><h2>Zuletzt trainiert</h2><div id="recent-list" class="muted small">Lade …</div></div>';
    shell('Strength<span class="accent">Lab</span>', html, '#home');
    loadRecent();
  }

  function dayName(idx) {
    if (!S.plan || idx == null) return 'Freies Training';
    var d = S.plan.data.days[idx];
    return d ? d.name : 'Tag ' + (idx + 1);
  }

  function loadRecent() {
    sb.from('workouts').select('id, day_index, week, started_at, finished_at')
      .not('finished_at', 'is', null)
      .order('started_at', { ascending: false }).limit(5)
      .then(function (res) {
        var el = document.getElementById('recent-list');
        if (!el) return;
        if (res.error) { el.textContent = 'Fehler beim Laden.'; return; }
        if (!res.data.length) { el.textContent = 'Noch keine Workouts geloggt.'; return; }
        el.innerHTML = '<ul class="list">' + res.data.map(function (w) {
          return '<li><a href="#history">' + fmtDate(w.started_at) + ' · ' + esc(dayName(w.day_index)) +
            (w.week ? ' <span class="muted">(W' + w.week + ')</span>' : '') + '</a></li>';
        }).join('') + '</ul><a class="link" href="#history">Alle anzeigen →</a>';
      });
  }

  /* ---------- Plan-Generator (Wizard) ---------- */
  var GEN_STATE = {
    goal: 'hypertrophy', days: 3, splitKey: null,
    equipment: SLGen.EQUIPMENT_TAGS.slice(), // Start: alles an – Nutzer deselektiert, was fehlt
    focus: [], mesoWeeks: 5, deload: true
  };

  function viewGenerator() {
    var g = GEN_STATE;
    function opt(name, val, label, cur) {
      return '<button class="chip' + (String(cur) === String(val) ? ' chip-on' : '') + '" ' +
        'onclick="App.genSet(\'' + name + '\',\'' + val + '\')">' + label + '</button>';
    }
    function toggleChip(name, val, label, arr) {
      var on = arr.indexOf(val) !== -1;
      return '<button class="chip' + (on ? ' chip-on' : '') + '" ' +
        'onclick="App.genToggle(\'' + name + '\',\'' + val + '\')">' + label + '</button>';
    }
    var variants = SLGen.variantsFor(g.days);
    var html =
      '<div class="card"><h2>Ziel</h2><div class="chips">' +
      opt('goal', 'hypertrophy', 'Muskelaufbau', g.goal) + opt('goal', 'strength', 'Maximalkraft', g.goal) +
      '</div></div>' +
      '<div class="card"><h2>Trainingstage pro Woche</h2><div class="chips">' +
      [1, 2, 3, 4, 5, 6].map(function (n) { return opt('days', n, String(n), g.days); }).join('') +
      '</div></div>' +
      (variants.length > 1
        ? '<div class="card"><h2>Splits-Typ</h2><div class="chips">' +
          variants.map(function (v) { return opt('splitKey', v.key, v.name, g.splitKey || variants[0].key); }).join('') +
          '</div></div>'
        : '<p class="muted small hint-split">' + esc(variants[0].name) + '</p>') +
      '<div class="card"><h2>Equipment <span class="muted small">(was steht dir zur Verfügung?)</span></h2><div class="chips">' +
      SLGen.EQUIPMENT_TAGS.map(function (tag) { return toggleChip('equipment', tag, EQUIP_DE[tag] || tag, g.equipment); }).join('') +
      '</div></div>' +
      '<div class="card"><h2>Muskel-Fokus <span class="muted small">(optional, Mehrfachauswahl)</span></h2><div class="chips">' +
      Object.keys(MUSCLE_DE).map(function (m) { return toggleChip('focus', m, MUSCLE_DE[m], g.focus); }).join('') +
      '</div></div>' +
      '<div class="card"><h2>Zyklus</h2><div class="chips">' +
      [4, 5, 6, 8].map(function (n) { return opt('mesoWeeks', n, n + ' Wochen', g.mesoWeeks); }).join('') +
      '</div><div class="chips" style="margin-top:8px">' +
      opt('deload', 'true', 'Mit Deload-Woche', String(g.deload)) +
      opt('deload', 'false', 'Ohne Deload', String(g.deload)) +
      '</div></div>' +
      '<button class="btn btn-primary btn-big" onclick="App.genRun()">Plan erstellen</button>' +
      '<button class="btn btn-ghost" onclick="App.genCancel()">Abbrechen</button>';
    shell('Plan-Generator', html, '#plan');
  }

  function genCancel() {
    go(S.plan ? '#plan' : '#home');
  }

  function genSet(name, val) {
    if (name === 'days') { GEN_STATE.days = parseInt(val, 10); GEN_STATE.splitKey = null; }
    else if (name === 'mesoWeeks') GEN_STATE.mesoWeeks = parseInt(val, 10);
    else if (name === 'deload') GEN_STATE.deload = (val === 'true');
    else GEN_STATE[name] = val;
    viewGenerator();
  }

  function genToggle(name, val) {
    var arr = GEN_STATE[name];
    var i = arr.indexOf(val);
    if (i === -1) arr.push(val); else arr.splice(i, 1);
    viewGenerator();
  }

  function genRun() {
    var g = GEN_STATE;
    if (!g.equipment.length) return toast('Bitte mindestens ein Equipment auswählen', true);
    var data = SLGen.generate(S.exercises, {
      goal: g.goal, daysPerWeek: g.days, splitKey: g.splitKey,
      equipment: g.equipment, focus: g.focus, mesoWeeks: g.mesoWeeks, deload: g.deload
    });
    var name = data.splitName + (g.focus.length ? ' · Fokus ' + g.focus.map(function (m) { return MUSCLE_DE[m]; }).join(', ') : '');
    // Alten Plan deaktivieren, neuen speichern
    var deactivate = S.plan
      ? sb.from('plans').update({ active: false }).eq('id', S.plan.id)
      : Promise.resolve({});
    Promise.resolve(deactivate).then(function () {
      return sb.from('plans').insert({
        user_id: S.session.user.id, name: name, goal: g.goal,
        days_per_week: g.days, meso_weeks: g.mesoWeeks, deload: g.deload, data: data
      }).select().single();
    }).then(function (res) {
      if (res.error) return toast('Speichern fehlgeschlagen: ' + res.error.message, true);
      toast('Plan erstellt');
      return loadActivePlan().then(function () { go('#plan'); });
    });
  }

  /* ---------- Plan-Ansicht ---------- */

  /* Tausch-Zustand: welche Übung gerade zum Tauschen aufgeklappt ist. */
  var SWAP = { day: -1, ex: -1, q: '' };

  /* Alternativen für einen Slot: erst der kuratierte Pool (Equipment-
     gefiltert, ohne bereits im Tag verwendete Übungen), dazu freie Suche
     über die komplette Bibliothek. */
  function swapCandidates(dayIdx, exIdx) {
    var p = S.plan.data;
    var day = p.days[dayIdx];
    var pe = day.exercises[exIdx];
    var usedInDay = {};
    day.exercises.forEach(function (e, i) { if (i !== exIdx) usedInDay[e.exerciseId] = 1; });
    var allowed = p.equipment && p.equipment.length ? p.equipment : SLGen.EQUIPMENT_TAGS;

    var pool = (SLGen.POOLS[pe.slot] || []).filter(function (id) {
      var ex = S.byId[id];
      return ex && id !== pe.exerciseId && !usedInDay[id] && allowed.indexOf(ex.equipment) !== -1;
    });
    // Pool-Kandidaten ohne Equipment-Treffer trotzdem anbieten (gekennzeichnet),
    // damit der Slot nie ohne Alternativen dasteht.
    var poolAny = (SLGen.POOLS[pe.slot] || []).filter(function (id) {
      var ex = S.byId[id];
      return ex && id !== pe.exerciseId && !usedInDay[id] && pool.indexOf(id) === -1;
    });

    var search = [];
    if (SWAP.q && SWAP.q.length >= 2) {
      var q = SWAP.q.toLowerCase();
      search = S.exercises.filter(function (ex) {
        if (ex.id === pe.exerciseId || usedInDay[ex.id]) return false;
        var hit = ex.name.toLowerCase().indexOf(q) !== -1 || (ex.de && ex.de.toLowerCase().indexOf(q) !== -1);
        return hit;
      }).slice(0, 10).map(function (ex) { return ex.id; });
    }
    return { pool: pool, poolAny: poolAny, search: search };
  }

  function viewPlan() {
    if (!S.plan) return viewGenerator();
    var p = S.plan.data;
    var slot = nextSlot();
    var equipList = (p.equipment || []).map(function (t) { return EQUIP_DE[t] || t; }).join(', ');
    var focusList = (p.focus || []).map(function (m) { return MUSCLE_DE[m] || m; }).join(', ');
    var html = '<div class="card"><div class="row-between"><h2>' + esc(S.plan.name) + '</h2>' +
      '<span class="badge">Woche ' + slot.week + '/' + p.mesoWeeks + '</span></div>' +
      '<p class="muted small">' + (p.goal === 'strength' ? 'Maximalkraft' : 'Muskelaufbau') +
      ' · ' + esc(equipList) + (p.deload ? ' · Deload in Woche ' + p.mesoWeeks : '') + '</p>' +
      (focusList ? '<p class="muted small">Fokus: ' + esc(focusList) + '</p>' : '') + '</div>';

    p.days.forEach(function (d, i) {
      html += '<div class="card"><h3>' + esc(d.name) + (i === slot.dayIndex ? ' <span class="badge">nächster</span>' : '') + '</h3>' +
        '<ul class="list">' + d.exercises.map(function (pe, j) {
          var row = '<li><div class="row-between"><span>' +
            '<a href="#exercise/' + encodeURIComponent(pe.exerciseId) + '">' + esc(exName(pe.exerciseId)) + '</a>' +
            '<span class="muted small"> · ' + pe.sets + '×' + pe.repLo + '–' + pe.repHi + '</span></span>' +
            '<button class="swap-btn" title="Übung tauschen" onclick="App.swapOpen(' + i + ',' + j + ')">⇄</button></div>';

          if (SWAP.day === i && SWAP.ex === j) {
            var cand = swapCandidates(i, j);
            row += '<div class="swap-panel">';
            if (cand.pool.length || cand.poolAny.length) {
              row += '<p class="muted small">Passende Alternativen:</p>' +
                cand.pool.map(function (id) {
                  return '<button class="btn btn-ghost btn-sm" onclick="App.swapPick(' + i + ',' + j + ',\'' + id + '\')">' +
                    esc(exName(id)) + ' <span class="muted small">(' + esc(EQUIP_DE[S.byId[id].equipment] || '') + ')</span></button>';
                }).join('') +
                cand.poolAny.map(function (id) {
                  return '<button class="btn btn-ghost btn-sm" onclick="App.swapPick(' + i + ',' + j + ',\'' + id + '\')">' +
                    esc(exName(id)) + ' <span class="muted small">(' + esc(EQUIP_DE[S.byId[id].equipment] || '') + ' – nicht in deiner Auswahl)</span></button>';
                }).join('');
            }
            row += '<input type="search" placeholder="Oder ganze Bibliothek durchsuchen …" value="' + esc(SWAP.q) + '" ' +
              'oninput="App.swapSearch(this.value)">' +
              (cand.search.length
                ? cand.search.map(function (id) {
                    return '<button class="btn btn-ghost btn-sm" onclick="App.swapPick(' + i + ',' + j + ',\'' + id + '\')">' +
                      esc(exName(id)) + ' <span class="muted small">(' + esc(EQUIP_DE[S.byId[id].equipment] || S.byId[id].equipment) + ')</span></button>';
                  }).join('')
                : (SWAP.q.length >= 2 ? '<p class="muted small">Keine Treffer.</p>' : '')) +
              '<button class="btn btn-ghost btn-sm" onclick="App.swapClose()">Schließen</button>' +
              '</div>';
          }
          return row + '</li>';
        }).join('') + '</ul></div>';
    });

    html += '<button class="btn btn-ghost" onclick="location.hash=\'#generator\'">Neuen Plan generieren</button>' +
      '<button class="btn btn-danger" onclick="App.deletePlan()">Plan löschen</button>';
    shell('Trainingsplan', html, '#plan');
  }

  function swapOpen(dayIdx, exIdx) {
    if (SWAP.day === dayIdx && SWAP.ex === exIdx) { return swapClose(); }
    SWAP = { day: dayIdx, ex: exIdx, q: '' };
    viewPlan();
  }
  function swapClose() {
    SWAP = { day: -1, ex: -1, q: '' };
    viewPlan();
  }
  var swapTimeout = null;
  function swapSearch(q) {
    SWAP.q = q;
    clearTimeout(swapTimeout);
    swapTimeout = setTimeout(function () {
      var scroll = window.scrollY;
      viewPlan();
      var inp = document.querySelector('.swap-panel input[type=search]');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      window.scrollTo(0, scroll);
    }, 250);
  }

  function swapPick(dayIdx, exIdx, newId) {
    var ex = S.byId[newId];
    if (!ex) return;
    var p = S.plan.data;
    var pe = p.days[dayIdx].exercises[exIdx];
    var oldName = exName(pe.exerciseId);
    pe.exerciseId = newId;
    sb.from('plans').update({ data: p }).eq('id', S.plan.id).then(function (res) {
      if (res.error) return toast('Speichern fehlgeschlagen: ' + res.error.message, true);
      toast(oldName + ' → ' + exName(newId));
      SWAP = { day: -1, ex: -1, q: '' };
      viewPlan();
    });
  }

  function deletePlan() {
    if (!S.plan) return;
    if (!confirm('Plan "' + S.plan.name + '" wirklich löschen?\nDeine Workout-Historie bleibt erhalten.')) return;
    sb.from('plans').delete().eq('id', S.plan.id).then(function (res) {
      if (res.error) return toast('Löschen fehlgeschlagen: ' + res.error.message, true);
      toast('Plan gelöscht');
      S.plan = null;
      S.planWorkouts = [];
      return loadActivePlan().then(function () { go('#home'); viewHome(); });
    });
  }

  /* ---------- Workout ---------- */
  function startWorkout(dayIndex, week) {
    sb.from('workouts').insert({
      user_id: S.session.user.id, plan_id: S.plan.id, day_index: dayIndex, week: week
    }).select().single().then(function (res) {
      if (res.error) return toast('Start fehlgeschlagen: ' + res.error.message, true);
      S.planWorkouts.push(res.data);
      initWorkout(res.data);
    });
  }

  function resumeWorkout(id) {
    var row = S.planWorkouts.find(function (w) { return w.id === id; });
    if (!row) return toast('Workout nicht gefunden', true);
    initWorkout(row);
  }

  function discardWorkout(id) {
    if (!confirm('Offenes Workout wirklich verwerfen? Geloggte Sätze werden gelöscht.')) return;
    sb.from('workouts').delete().eq('id', id).then(function (res) {
      if (res.error) return toast('Fehler: ' + res.error.message, true);
      S.planWorkouts = S.planWorkouts.filter(function (w) { return w.id !== id; });
      if (S.workout && S.workout.row.id === id) S.workout = null;
      viewHome();
    });
  }

  function initWorkout(row) {
    var p = S.plan.data;
    var day = p.days[row.day_index];
    var params = SLAlgo.weekParams(row.week || 1, p.mesoWeeks, p.deload);
    var exIds = day.exercises.map(function (pe) { return pe.exerciseId; });
    S.workout = { row: row, day: day, params: params, logs: {}, last: {}, recs: {} };

    // Bereits geloggte Sätze dieses Workouts + letzte Historie je Übung laden.
    Promise.all([
      sb.from('set_logs').select('*').eq('workout_id', row.id).order('created_at', { ascending: true }),
      sb.from('set_logs').select('exercise_id, workout_id, weight, reps, rir, created_at')
        .in('exercise_id', exIds).neq('workout_id', row.id)
        .order('created_at', { ascending: false }).limit(600)
    ]).then(function (results) {
      var cur = results[0], hist = results[1];
      if (cur.error || hist.error) return toast('Laden fehlgeschlagen', true);
      cur.data.forEach(function (s) {
        (S.workout.logs[s.exercise_id] = S.workout.logs[s.exercise_id] || []).push(s);
      });
      // Historie: pro Übung die Sätze des jüngsten früheren Workouts.
      var lastWk = {};
      hist.data.forEach(function (s) {
        if (!lastWk[s.exercise_id]) lastWk[s.exercise_id] = s.workout_id;
        if (s.workout_id === lastWk[s.exercise_id]) {
          (S.workout.last[s.exercise_id] = S.workout.last[s.exercise_id] || []).unshift(s);
        }
      });
      // Empfehlungen berechnen.
      day.exercises.forEach(function (pe) {
        var ex = S.byId[pe.exerciseId];
        var bw = ex && ex.equipment === 'body only';
        S.workout.recs[pe.exerciseId] = SLAlgo.recommend(S.workout.last[pe.exerciseId], {
          repLo: pe.repLo, repHi: pe.repHi, targetRir: params.targetRir,
          loadFactor: params.loadFactor, increment: SLAlgo.incrementFor(ex ? ex.equipment : ''),
          bodyweight: bw
        });
      });
      viewWorkout();
    });
  }

  function viewWorkout() {
    var w = S.workout;
    if (!w) return go('#home');
    var params = w.params;
    var html = '<div class="card card-accent row-between"><div>' +
      '<h2>' + esc(w.day.name) + '</h2><p class="muted small">' +
      (params.isDeload ? 'DELOAD · ' : 'Woche ' + (w.row.week || 1) + ' · ') + 'Ziel-RIR ' + params.targetRir + '</p></div>' +
      '<div id="rest-timer" class="timer">–</div></div>';

    w.day.exercises.forEach(function (pe, ei) {
      var ex = S.byId[pe.exerciseId];
      var sets = Math.max(1, Math.round((pe.sets + params.setBonus) * params.setFactor));
      var logged = w.logs[pe.exerciseId] || [];
      var rec = w.recs[pe.exerciseId];
      var last = w.last[pe.exerciseId];
      var bw = ex && ex.equipment === 'body only';

      html += '<div class="card"><div class="row-between">' +
        '<h3><a href="#exercise/' + encodeURIComponent(pe.exerciseId) + '">' + esc(exName(pe.exerciseId)) + '</a></h3>' +
        '<span class="muted small">' + logged.length + '/' + sets + ' Sätze</span></div>' +
        '<p class="muted small">' + pe.repLo + '–' + pe.repHi + ' Wdh. · ' + esc(EQUIP_DE[ex ? ex.equipment : ''] || '') + '</p>';

      if (rec) {
        html += '<p class="rec">Empfehlung: <strong>' + (bw ? '' : fmtW(rec.weight) + ' kg × ') + rec.reps + ' Wdh.</strong>' +
          ' <span class="muted small">(' + esc(rec.note) + ')</span></p>';
      } else if (last && last.length) {
        html += '<p class="rec muted">Letztes Mal: ' + fmtW(last[0].weight) + ' kg × ' + last[0].reps + '</p>';
      } else {
        html += '<p class="rec muted">Erste Einheit: Gewicht finden, mit dem ' + pe.repLo + '–' + pe.repHi +
          ' saubere Wdh. bei RIR ' + params.targetRir + ' möglich sind.</p>';
      }

      // Geloggte Sätze
      if (logged.length) {
        html += '<ul class="setlist">' + logged.map(function (s) {
          return '<li>Satz ' + s.set_number + ': <strong>' + fmtW(s.weight) + ' kg × ' + s.reps + '</strong>' +
            (s.rir != null ? ' <span class="muted">@RIR ' + s.rir + '</span>' : '') +
            ' <span class="badge badge-sm">e1RM ' + fmtW(SLAlgo.e1rm(s.weight, s.reps, s.rir)) + '</span></li>';
        }).join('') + '</ul>';
      }

      // Eingabezeile für nächsten Satz
      if (logged.length < sets) {
        var preW = rec ? rec.weight : (logged.length ? logged[logged.length - 1].weight : '');
        var preR = rec ? rec.reps : '';
        html += '<div class="setrow" id="setrow-' + ei + '">' +
          '<input type="number" inputmode="decimal" step="0.5" min="0" id="w-' + ei + '" placeholder="kg" value="' + preW + '">' +
          '<input type="number" inputmode="numeric" step="1" min="0" id="r-' + ei + '" placeholder="Wdh." value="' + preR + '">' +
          '<select id="rir-' + ei + '">' + [0, 1, 2, 3, 4, 5].map(function (n) {
            return '<option value="' + n + '"' + (n === params.targetRir ? ' selected' : '') + '>RIR ' + n + '</option>';
          }).join('') + '</select>' +
          '<button class="btn btn-primary btn-set" onclick="App.logSet(' + ei + ')">✓</button>' +
          '</div>';
      }
      html += '</div>';
    });

    html += '<button class="btn btn-primary btn-big" onclick="App.finishWorkout()">Workout abschließen</button>' +
      '<button class="btn btn-ghost" onclick="location.hash=\'#home\'">Später weitermachen</button>';

    root().innerHTML = '<div class="header header-sm"><h1>Workout</h1></div>' +
      '<div class="content">' + html + '</div>' + navBar('#home');
    startTimer();
  }

  function startTimer() {
    if (S.timerInterval) clearInterval(S.timerInterval);
    S.timerInterval = setInterval(function () {
      var el = document.getElementById('rest-timer');
      if (!el) { clearInterval(S.timerInterval); return; }
      if (!S.lastSetAt) { el.textContent = '–'; return; }
      var sec = Math.floor((Date.now() - S.lastSetAt) / 1000);
      el.textContent = Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
    }, 1000);
  }

  function logSet(ei) {
    var w = S.workout;
    var pe = w.day.exercises[ei];
    var weight = parseFloat(document.getElementById('w-' + ei).value.replace(',', '.'));
    var reps = parseInt(document.getElementById('r-' + ei).value, 10);
    var rir = parseInt(document.getElementById('rir-' + ei).value, 10);
    if (isNaN(weight) || weight < 0) weight = 0;
    if (isNaN(reps) || reps <= 0) return toast('Wiederholungen eingeben', true);
    var setNo = (w.logs[pe.exerciseId] || []).length + 1;
    sb.from('set_logs').insert({
      user_id: S.session.user.id, workout_id: w.row.id, exercise_id: pe.exerciseId,
      set_number: setNo, weight: weight, reps: reps, rir: rir
    }).select().single().then(function (res) {
      if (res.error) return toast('Speichern fehlgeschlagen: ' + res.error.message, true);
      (w.logs[pe.exerciseId] = w.logs[pe.exerciseId] || []).push(res.data);
      S.lastSetAt = Date.now();
      viewWorkout();
    });
  }

  function finishWorkout() {
    var w = S.workout;
    var total = Object.keys(w.logs).reduce(function (n, k) { return n + w.logs[k].length; }, 0);
    if (!total && !confirm('Keine Sätze geloggt – trotzdem abschließen?')) return;
    sb.from('workouts').update({ finished_at: new Date().toISOString() }).eq('id', w.row.id)
      .then(function (res) {
        if (res.error) return toast('Fehler: ' + res.error.message, true);
        w.row.finished_at = new Date().toISOString();
        S.workout = null;
        S.lastSetAt = null;
        toast('Workout gespeichert 💪');
        loadActivePlan().then(viewHome);
      });
  }

  /* ---------- Verlauf / Charts ---------- */
  function viewProgress() {
    var html = '<div class="card"><h2>Übung wählen</h2><select id="prog-ex" onchange="App.progressPick(this.value)">' +
      '<option value="">– Übung –</option></select><div id="prog-chart"></div></div>' +
      '<div class="card"><h2>Wochen-Volumen <span class="muted small">(Tonnage gesamt)</span></h2><div id="vol-chart" class="muted small">Lade …</div></div>' +
      '<div class="card"><h2>Historie</h2><div id="hist-short" class="muted small">Lade …</div>' +
      '<a class="link" href="#history">Komplette Historie →</a></div>';
    shell('Fortschritt', html, '#progress');

    // Übungen mit Logs für den Picker + Volumendaten laden.
    sb.from('set_logs').select('exercise_id, weight, reps, rir, created_at')
      .order('created_at', { ascending: true }).limit(5000)
      .then(function (res) {
        if (res.error) return;
        S._allSets = res.data;
        var seen = {};
        res.data.forEach(function (s) { seen[s.exercise_id] = 1; });
        var sel = document.getElementById('prog-ex');
        if (!sel) return;
        Object.keys(seen).sort(function (a, b) { return exName(a).localeCompare(exName(b)); })
          .forEach(function (id) {
            var o = document.createElement('option');
            o.value = id; o.textContent = exName(id);
            sel.appendChild(o);
          });
        if (S.progressEx && seen[S.progressEx]) { sel.value = S.progressEx; progressPick(S.progressEx); }
        renderVolumeChart(res.data);
      });
    loadHistShort();
  }

  function progressPick(exId) {
    S.progressEx = exId || null;
    var el = document.getElementById('prog-chart');
    if (!el) return;
    if (!exId) { el.innerHTML = ''; return; }
    // max e1RM pro Kalendertag
    var byDay = {};
    (S._allSets || []).forEach(function (s) {
      if (s.exercise_id !== exId) return;
      var day = s.created_at.slice(0, 10);
      var v = SLAlgo.e1rm(parseFloat(s.weight), s.reps, s.rir);
      if (!byDay[day] || v > byDay[day]) byDay[day] = v;
    });
    var days = Object.keys(byDay).sort();
    var pts = days.map(function (d) { return { x: d, y: byDay[d] }; });
    el.innerHTML = pts.length < 2
      ? '<p class="muted small">Noch zu wenige Daten für einen Trend (' + pts.length + ' Einheit' + (pts.length === 1 ? '' : 'en') + ').</p>'
      : svgLineChart(pts, 'e1RM (kg)');
  }

  function renderVolumeChart(sets) {
    var el = document.getElementById('vol-chart');
    if (!el) return;
    var byWeek = {};
    sets.forEach(function (s) {
      var d = new Date(s.created_at);
      // ISO-Woche berechnen
      var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      var dayNum = (t.getUTCDay() + 6) % 7;
      t.setUTCDate(t.getUTCDate() - dayNum + 3);
      var firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
      var week = 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
      var key = t.getUTCFullYear() + '-W' + ('0' + week).slice(-2);
      byWeek[key] = (byWeek[key] || 0) + parseFloat(s.weight) * s.reps;
    });
    var keys = Object.keys(byWeek).sort().slice(-12);
    if (!keys.length) { el.textContent = 'Noch keine Daten.'; return; }
    el.innerHTML = svgBarChart(keys.map(function (k) { return { x: k.slice(5), y: byWeek[k] }; }), 'kg');
  }

  function loadHistShort() {
    sb.from('workouts').select('id, day_index, week, started_at')
      .not('finished_at', 'is', null).order('started_at', { ascending: false }).limit(5)
      .then(function (res) {
        var el = document.getElementById('hist-short');
        if (!el || res.error) return;
        el.innerHTML = res.data.length
          ? '<ul class="list">' + res.data.map(function (w) {
              return '<li>' + fmtDate(w.started_at) + ' · ' + esc(dayName(w.day_index)) + '</li>';
            }).join('') + '</ul>'
          : 'Noch keine Workouts.';
      });
  }

  /* Minimalistische SVG-Charts ohne Fremdbibliothek. */
  function svgLineChart(pts, label) {
    var W = 420, H = 180, P = 34;
    var ys = pts.map(function (p) { return p.y; });
    var min = Math.min.apply(null, ys), max = Math.max.apply(null, ys);
    if (max === min) { max += 5; min -= 5; }
    var pad = (max - min) * 0.1; min -= pad; max += pad;
    function X(i) { return P + (W - 2 * P) * (pts.length === 1 ? 0.5 : i / (pts.length - 1)); }
    function Y(v) { return H - P - (H - 2 * P) * ((v - min) / (max - min)); }
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p.y).toFixed(1); }).join(' ');
    var dots = pts.map(function (p, i) {
      return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="3.5" class="ch-dot"/>';
    }).join('');
    var first = pts[0].x.slice(5), lastX = pts[pts.length - 1].x.slice(5);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart">' +
      '<text x="' + P + '" y="14" class="ch-label">' + esc(label) + '</text>' +
      '<text x="' + P + '" y="' + (H - 8) + '" class="ch-tick">' + esc(first) + '</text>' +
      '<text x="' + (W - P) + '" y="' + (H - 8) + '" text-anchor="end" class="ch-tick">' + esc(lastX) + '</text>' +
      '<text x="6" y="' + (Y(max - pad) + 4).toFixed(1) + '" class="ch-tick">' + Math.round(max - pad) + '</text>' +
      '<text x="6" y="' + (Y(min + pad) + 4).toFixed(1) + '" class="ch-tick">' + Math.round(min + pad) + '</text>' +
      '<path d="' + path + '" class="ch-line"/>' + dots + '</svg>';
  }

  function svgBarChart(pts, unit) {
    var W = 420, H = 170, P = 30;
    var max = Math.max.apply(null, pts.map(function (p) { return p.y; })) || 1;
    var bw = (W - 2 * P) / pts.length;
    var bars = pts.map(function (p, i) {
      var h = (H - 2 * P) * (p.y / max);
      return '<rect x="' + (P + i * bw + 3).toFixed(1) + '" y="' + (H - P - h).toFixed(1) +
        '" width="' + (bw - 6).toFixed(1) + '" height="' + h.toFixed(1) + '" class="ch-bar"/>' +
        (pts.length <= 12 ? '<text x="' + (P + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 8) +
          '" text-anchor="middle" class="ch-tick">' + esc(p.x) + '</text>' : '');
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart">' +
      '<text x="' + P + '" y="14" class="ch-label">max ' + Math.round(max).toLocaleString('de-AT') + ' ' + unit + '</text>' +
      bars + '</svg>';
  }

  /* ---------- Historie ---------- */
  function viewHistory() {
    shell('Historie', '<div id="hist-full" class="muted">Lade …</div>', '#progress');
    Promise.all([
      sb.from('workouts').select('*').not('finished_at', 'is', null).order('started_at', { ascending: false }).limit(60),
      sb.from('set_logs').select('workout_id, exercise_id, set_number, weight, reps, rir').order('created_at', { ascending: true }).limit(5000)
    ]).then(function (results) {
      var el = document.getElementById('hist-full');
      if (!el) return;
      if (results[0].error || results[1].error) { el.textContent = 'Fehler beim Laden.'; return; }
      var setsByWk = {};
      results[1].data.forEach(function (s) {
        (setsByWk[s.workout_id] = setsByWk[s.workout_id] || []).push(s);
      });
      if (!results[0].data.length) { el.textContent = 'Noch keine Workouts.'; return; }
      el.innerHTML = results[0].data.map(function (w) {
        var sets = setsByWk[w.id] || [];
        var ton = sets.reduce(function (n, s) { return n + parseFloat(s.weight) * s.reps; }, 0);
        var byEx = {};
        sets.forEach(function (s) { (byEx[s.exercise_id] = byEx[s.exercise_id] || []).push(s); });
        return '<details class="card"><summary><strong>' + fmtDate(w.started_at) + '</strong> · ' +
          esc(dayName(w.day_index)) + (w.week ? ' (W' + w.week + ')' : '') +
          ' <span class="muted small">' + sets.length + ' Sätze · ' + Math.round(ton).toLocaleString('de-AT') + ' kg</span></summary>' +
          Object.keys(byEx).map(function (exId) {
            return '<p class="hist-ex"><strong>' + esc(exName(exId)) + '</strong><br>' +
              byEx[exId].map(function (s) {
                return fmtW(s.weight) + '×' + s.reps + (s.rir != null ? '@' + s.rir : '');
              }).join(' · ') + '</p>';
          }).join('') + '</details>';
      }).join('');
    });
  }

  /* ---------- Übungs-Bibliothek ---------- */
  function libMatches(ex) {
    var f = S.libFilter;
    if (f.muscle) {
      var allowed = LIB_GROUP_MAP[f.muscle] || [f.muscle];
      var hit = ex.primaryMuscles.some(function (m) { return allowed.indexOf(m) !== -1; });
      if (!hit) return false;
    }
    if (f.q) {
      var q = f.q.toLowerCase();
      var hitName = ex.name.toLowerCase().indexOf(q) !== -1;
      var hitDe = ex.de && ex.de.toLowerCase().indexOf(q) !== -1;
      if (!hitName && !hitDe) return false;
    }
    return true;
  }

  function viewLibrary() {
    var f = S.libFilter;
    var list = S.exercises.filter(libMatches).slice(0, 80);
    var html = '<div class="card">' +
      '<input type="search" placeholder="Übung suchen …" value="' + esc(f.q) + '" ' +
      'oninput="App.libSearch(this.value)">' +
      '<div class="chips chips-scroll">' + LIB_GROUPS.map(function (g) {
        return '<button class="chip' + (f.muscle === g[0] ? ' chip-on' : '') + '" ' +
          'onclick="App.libMuscle(\'' + g[0] + '\')">' + g[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="card"><ul class="list">' + (list.length ? list.map(function (ex) {
        return '<li><a href="#exercise/' + encodeURIComponent(ex.id) + '">' + esc(exName(ex.id)) + '</a>' +
          '<span class="muted small"> · ' + esc(DB_MUSCLE_DE[ex.primaryMuscles[0]] || '') +
          ' · ' + esc(EQUIP_DE[ex.equipment] || ex.equipment) + '</span></li>';
      }).join('') : '<li class="muted">Keine Treffer.</li>') + '</ul>' +
      (list.length === 80 ? '<p class="muted small">Erste 80 Treffer – Suche verfeinern.</p>' : '') +
      '</div>';
    shell('Übungen', html, '#library');
  }
  var libTimeout = null;
  function libSearch(q) {
    S.libFilter.q = q;
    clearTimeout(libTimeout);
    libTimeout = setTimeout(function () {
      var scroll = document.querySelector('.content') ? window.scrollY : 0;
      viewLibrary();
      var inp = document.querySelector('input[type=search]');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      window.scrollTo(0, scroll);
    }, 250);
  }
  function libMuscle(m) { S.libFilter.muscle = m; viewLibrary(); }

  function viewExercise(id) {
    var ex = S.byId[id];
    if (!ex) return viewLibrary();
    var instr = exInstructions(ex);
    var html = '<div class="card"><h2>' + esc(exName(id)) + '</h2>' +
      (ex.de ? '<p class="muted small">' + esc(ex.name) + '</p>' : '') +
      '<p class="muted small">' +
      esc((ex.primaryMuscles || []).map(function (m) { return DB_MUSCLE_DE[m] || m; }).join(', ')) +
      ' · ' + esc(EQUIP_DE[ex.equipment] || ex.equipment) +
      (ex.mechanic ? ' · ' + (ex.mechanic === 'compound' ? 'Grundübung' : 'Isolation') : '') + '</p>' +
      (ex.secondaryMuscles && ex.secondaryMuscles.length
        ? '<p class="muted small">Sekundär: ' + esc(ex.secondaryMuscles.map(function (m) { return DB_MUSCLE_DE[m] || m; }).join(', ')) + '</p>' : '') +
      '</div>' +
      '<div class="card"><h3>Ausführung' + (instr.en ? ' <span class="badge badge-sm">EN</span>' : '') + '</h3>' +
      (instr.en ? '<p class="muted small">Für diese Übung liegt noch keine deutsche Anleitung vor.</p>' : '') +
      '<ol class="instructions">' +
      instr.steps.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') +
      '</ol></div>' +
      '<button class="btn btn-ghost" onclick="history.back()">← Zurück</button>';
    shell('Übung', html, '#library');
  }

  /* ---------- Einstellungen ---------- */
  function viewSettings() {
    var email = S.session && S.session.user ? S.session.user.email : '';
    var html = '<div class="card"><h2>Konto</h2><p class="muted">' + esc(email) + '</p>' +
      '<button class="btn btn-ghost" onclick="App.logout()">Abmelden</button></div>' +
      '<div class="card"><h2>Daten</h2>' +
      '<button class="btn btn-ghost" onclick="App.exportData()">Alle Daten als JSON exportieren</button></div>' +
      '<div class="card"><h2>Über</h2><p class="muted small">Strength-Lab v' + VERSION +
      ' · Selbstgebaute, kostenlose Trainings-App.<br>Progression: RIR-Autoregulation + Double Progression, Mesozyklen mit Deload.<br>' +
      'Übungsdaten: <a class="link" href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener">free-exercise-db</a> (Public Domain).</p></div>';
    shell('Mehr', html, '#settings');
  }

  function exportData() {
    Promise.all([
      sb.from('plans').select('*'),
      sb.from('workouts').select('*'),
      sb.from('set_logs').select('*').limit(20000)
    ]).then(function (r) {
      if (r[0].error || r[1].error || r[2].error) return toast('Export fehlgeschlagen', true);
      var blob = new Blob([JSON.stringify({
        exportedAt: new Date().toISOString(), version: VERSION,
        plans: r[0].data, workouts: r[1].data, set_logs: r[2].data
      }, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'strength-lab-export-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
  }

  /* ---------- Router ---------- */
  function route() {
    if (!S.session) return viewLogin();
    var h = location.hash || '#home';
    if (h.indexOf('#exercise/') === 0) return viewExercise(decodeURIComponent(h.slice(10)));
    switch (h) {
      case '#login': return viewHome();
      case '#home': return viewHome();
      case '#plan': return viewPlan();
      case '#generator': return viewGenerator();
      case '#progress': return viewProgress();
      case '#history': return viewHistory();
      case '#library': return viewLibrary();
      case '#settings': return viewSettings();
      case '#workout': return S.workout ? viewWorkout() : viewHome();
      default: return viewHome();
    }
  }

  /* ---------- Init ---------- */
  function boot() {
    loadExercises().then(function () {
      return sb.auth.getSession();
    }).then(function (res) {
      S.session = res.data ? res.data.session : null;
      sb.auth.onAuthStateChange(function (_evt, session) {
        var wasOut = !S.session;
        S.session = session;
        if (session && wasOut) {
          loadActivePlan().then(function () { go('#home'); route(); });
        } else if (!session) {
          viewLogin();
        }
      });
      if (S.session) return loadActivePlan().then(route);
      viewLogin();
    }).catch(function (e) {
      root().innerHTML = '<div class="card"><h2>Fehler beim Start</h2><p class="muted">' + esc(e.message || e) + '</p></div>';
    });
    window.addEventListener('hashchange', function () { if (S.session) route(); });
  }

  /* Service Worker */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline optional */ });
    });
  }

  window.App = {
    login: login, register: register, logout: logout,
    genSet: genSet, genToggle: genToggle, genRun: genRun, genCancel: genCancel,
    swapOpen: swapOpen, swapClose: swapClose, swapSearch: swapSearch, swapPick: swapPick,
    deletePlan: deletePlan,
    startWorkout: startWorkout, resumeWorkout: resumeWorkout, discardWorkout: discardWorkout,
    logSet: logSet, finishWorkout: finishWorkout,
    progressPick: progressPick, libSearch: libSearch, libMuscle: libMuscle,
    exportData: exportData
  };

  boot();
})();
