export const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:ital,wght@0,400;0,600;1,400&display=swap');

.jb *, .jb *::before, .jb *::after { box-sizing: border-box; }
.jb {
  --ink:#0E1116; --slate:#141821; --panel:#1B212B; --raised:#222A36;
  --line:#2A323F; --line-soft:#212936;
  --text:#E6EAF0; --muted:#8A94A6; --dim:#5E6878;
  --paper:#F3F2EE; --paper-ink:#191C22; --paper-line:#DAD8D1;
  --err:#E5484D; --ok:#35D0A5;
  --fit-matched:#5B8CFF; --fit-offstack:#E8B04B; --fit-brutal:#E8622A;
  --sans:'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  --mono:'IBM Plex Mono', ui-monospace, 'SF Mono', monospace;
  --serif:'IBM Plex Serif', Georgia, serif;

  position:fixed; inset:0;
  /* Band B: stetig statt in Stufen. Die alte 1180er-Stufe (236/372 -> 208/320) sprang
     sichtbar, und bei 1024px blieben der Detailspalte nur 496px — schmaler als das
     Anschreiben selbst (.paper, max-width:660px). minmax(0,1fr) statt 1fr, damit die
     Detailspalte beim Schrumpfen nicht ihre Mindest-Inhaltsbreite erzwingt und das
     Raster über den Rand schiebt. */
  display:grid;
  grid-template-columns:clamp(200px, 16vw, 236px) clamp(320px, 26vw, 430px) minmax(0, 1fr);
  background:var(--ink); color:var(--text);
  font-family:var(--sans); font-size:13px; line-height:1.45;
  -webkit-font-smoothing:antialiased;
}
.jb button { font:inherit; color:inherit; background:none; border:none; cursor:pointer; }
.jb :focus-visible { outline:2px solid #6EA8FF; outline-offset:1px; border-radius:3px; }

/* ---------- Sidebar ---------- */
.sb { background:var(--slate); border-right:1px solid var(--line-soft); display:flex; flex-direction:column; overflow-y:auto; }
.sb__brand { padding:16px 16px 14px; display:flex; align-items:baseline; gap:8px; }
.sb__logo { font-family:var(--mono); font-size:14px; font-weight:500; letter-spacing:-.02em; }
.sb__logo b { color:var(--text); font-weight:500; }
.sb__logo span { color:var(--dim); }
.sb__ver { font-family:var(--mono); font-size:10px; color:var(--dim); }

.sb__group { padding:0 8px; margin-bottom:4px; }
.sb__head {
  display:flex; align-items:center; gap:6px;
  padding:12px 8px 6px; font-size:10px; font-weight:600;
  letter-spacing:.09em; text-transform:uppercase; color:var(--dim);
}
.sb__head svg { width:11px; height:11px; }
.sb__rule { height:1px; background:var(--line-soft); margin:8px 16px; }

.fld {
  width:100%; display:flex; align-items:center; gap:9px;
  padding:6px 8px; border-radius:5px; color:var(--muted); text-align:left;
}
.fld:hover { background:var(--panel); color:var(--text); }
.fld--on { background:var(--raised); color:var(--text); font-weight:500; }
.fld svg { width:14px; height:14px; flex:none; opacity:.75; }
.fld__label { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fld__n { font-family:var(--mono); font-size:11px; font-variant-numeric:tabular-nums; color:var(--dim); }
.fld--on .fld__n { color:var(--muted); }
.fld--err.fld--has svg, .fld--err.fld--has .fld__n { color:var(--err); opacity:1; }
.fld__dot { width:6px; height:6px; border-radius:50%; background:var(--ok); flex:none; }

.fld__bar { height:3px; margin:0 8px 6px; background:var(--line); border-radius:99px; overflow:hidden; }
.fld__bar span {
  display:block; height:100%; border-radius:inherit; transition:width .3s ease;
  background:linear-gradient(90deg, #5B8CFF, #35D0A5, #5B8CFF);
  background-size:200% 100%;
}

.loadgrid { display:flex; flex-direction:column; gap:16px; }
.loadgrid__done-badge {
  position:absolute; right:0; bottom:-2px;
  font-size:10px; font-weight:600; letter-spacing:.02em;
  padding:2px 7px; border-radius:5px;
  background:var(--ok); color:var(--ink);
}
.loadgrid__head {
  font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:.06em;
  color:var(--muted); margin-bottom:7px;
}
.loadgrid__row { display:flex; flex-wrap:wrap; gap:3px; margin-bottom:3px; }
/* Zwei getrennte Animationen: "pop" (Erscheinen, pro Quadrat gestaffelt via --pop-delay)
   endet grau und BLEIBT grau — erst wenn die ganze Zeile fertig erschienen ist, färbt
   "color" (auf --reveal-delay verzögert, für jedes Quadrat der Zeile gleich) sie um. */
.loadgrid__sq {
  position:relative; /* Anker für Tschobbos geklebte Klumpen, siehe ui/tschobbo.js */
  width:11px; height:11px; border-radius:3px; flex:none;
  opacity:0; transform:scale(.4); background:var(--dim);
  animation-name: loadgrid-pop, loadgrid-color;
  animation-duration: .35s, .3s;
  animation-timing-function: ease-out, ease-out;
  animation-delay: var(--pop-delay, 0ms), var(--reveal-delay, 0ms);
  animation-fill-mode: forwards, forwards;
}
.loadgrid__sq--done { --final-color:#5B8CFF; }
.loadgrid__sq--error { --final-color:var(--err); }
.loadgrid__sq--excluded { --final-color:var(--dim); }
/* Filter-Ergebnis nutzt exakt die Fit-Urteilsfarben (siehe FIT oben) statt eigener
   Töne — ein Quadrat und ein Job-Zeilen-Punkt für dasselbe Urteil sehen identisch aus. */
.loadgrid__sq--matched { --final-color:var(--fit-matched); }
.loadgrid__sq--offstack { --final-color:var(--fit-offstack); }
.loadgrid__sq--brutal { --final-color:var(--fit-brutal); }
.loadgrid__sq--clickable { cursor:pointer; }
.loadgrid__sq--clickable:hover { filter:brightness(1.4); }
@keyframes loadgrid-pop { to { opacity:1; transform:scale(1); } }
@keyframes loadgrid-color { to { background:var(--final-color); } }

/* .chip/.chip--on ist für die Fit-Filter gebaut, wo ein Farbpunkt die Auswahl
   trägt — ohne Punkt (Regex/LLM) ist der Kontrast dort zu schwach, um überhaupt
   wie ein Button auszusehen. Eigener, kontrastreicherer Toggle statt .chip.
   ".jb " vorangestellt (statt nur .modebtn): ".jb button" resettet border/
   background mit höherer Spezifität (Klasse+Element) als ein einzelner
   Klassen-Selektor — ohne den Präfix gewinnt der Reset und der Toggle sieht
   aus wie reiner Text (derselbe Effekt trifft übrigens auch .chip/.btn/.fitbtn
   im Bestandscode, hier aber bewusst nur lokal für den neuen Toggle behoben). */
.modetoggle { display:flex; gap:6px; padding:10px 0; }
.jb .modebtn { padding:5px 14px; border-radius:6px; border:1px solid var(--line); color:var(--muted); font-size:12.5px; }
.jb .modebtn:hover { border-color:var(--dim); color:var(--text); }
.jb .modebtn--on { background:var(--text); color:var(--ink); border-color:var(--text); font-weight:600; }

.sb__keys { margin-top:auto; padding:14px 16px; border-top:1px solid var(--line-soft); display:flex; flex-direction:column; gap:5px; }
.key { display:flex; justify-content:space-between; font-size:11px; color:var(--dim); }
.key kbd {
  font-family:var(--mono); font-size:10px; background:var(--panel);
  border:1px solid var(--line); border-bottom-width:2px; border-radius:3px;
  padding:0 4px; color:var(--muted);
}

/* ---------- Liste ---------- */
.ls { background:var(--panel); border-right:1px solid var(--line-soft); display:flex; flex-direction:column; min-width:0; min-height:0; }
.ls__top { padding:12px 12px 0; border-bottom:1px solid var(--line-soft); }
.srch { display:flex; align-items:center; gap:8px; background:var(--ink); border:1px solid var(--line); border-radius:6px; padding:6px 9px; }
.srch svg { width:13px; height:13px; color:var(--dim); flex:none; }
.srch input { flex:1; background:none; border:none; outline:none; color:var(--text); font:inherit; min-width:0; }
.srch input::placeholder { color:var(--dim); }

/* Die Reihe war bei JEDER Fensterbreite breiter als ihre Spalte — bei 1024 um 168px, ab
   1280 um 116px, selbst auf 2560 noch, weil die Listenspalte nie mitwächst. Sie lag in
   einem overflow-x:auto mit scrollbar-width:none, sah also abgeschnitten aus statt
   scrollbar. Umbruch statt Scrollen: eine Filterreihe, die man nicht ganz sieht, ist als
   Filter wertlos, und zwei Zeilen kosten hier 28px. Erst mit einer Listenspalte jenseits
   von 600px passte sie in eine Zeile — so breit soll die Liste aber gar nicht werden. */
.chips { display:flex; flex-wrap:wrap; gap:5px; padding:10px 0; }
.chip {
  display:flex; align-items:center; gap:6px; flex:none;
  padding:3px 9px; border-radius:99px; border:1px solid var(--line);
  color:var(--muted); font-size:11.5px; white-space:nowrap;
}
.chip:hover { border-color:var(--dim); color:var(--text); }
.chip--on { background:var(--raised); border-color:transparent; color:var(--text); font-weight:500; }
.chip__dot { width:6px; height:6px; border-radius:99px; flex:none; }
.chip__n { font-family:var(--mono); font-size:10px; color:var(--dim); font-variant-numeric:tabular-nums; }

.ls__scroll { flex:1; min-height:0; overflow-y:auto; }

.row-wrap { display:flex; align-items:stretch; border-bottom:1px solid var(--line-soft); }
.row__check { flex:none; align-self:center; margin-left:14px; accent-color:var(--text); cursor:pointer; }
/* Ungefilterte Jobs (status "new") sitzen mit im "jobs"-Ordner, taugen aber nicht
   fürs Anschreiben — Checkbox bleibt sichtbar (die Spalte soll nicht springen),
   nur eben erkennbar tot. */
.row__check:disabled { cursor:not-allowed; opacity:.3; }

.row {
  position:relative; width:100%; display:block; text-align:left;
  padding:11px 12px 11px 18px;
}
.row:hover { background:var(--raised); }
.row--on { background:var(--raised); }
.row--on::after { content:''; position:absolute; right:0; top:0; bottom:0; width:2px; background:var(--text); }
.row--dim { opacity:.58; }
.row--dim:hover, .row--dim.row--on { opacity:1; }
.rail { position:absolute; left:0; top:0; bottom:0; width:3px; }

/* wrap, weil die Listenspalte schmal ist: mit fünf Aktionen passt die Leiste dort
   nicht mehr in eine Zeile und die letzten Knöpfe verschwänden unter der Detailspalte.
   Kein flex:1-Spacer mehr — der würde beim Umbruch eine ganze Zeile fressen. */
.selbar {
  display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px; padding:8px 12px;
  border-bottom:1px solid var(--line-soft); background:var(--raised);
  font-size:12px; color:var(--muted);
}
.selbar__n { flex:none; font-weight:500; color:var(--text); margin-right:2px; }

/* Nachfass-Zeile: flacher als .row (kein Snippet, kein Fit-Rail) — die Liste ist eine
   Auswahlliste, kein Job-Browser. */
.nf__row {
  display:grid; grid-template-columns:auto 1fr 2fr auto; align-items:center; gap:10px;
  padding:7px 4px; border-bottom:1px solid var(--line-soft); cursor:pointer; font-size:12.5px;
}
.nf__row:hover { background:var(--raised); }
.nf__firma { color:var(--text); font-weight:500; }
.nf__titel { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nf__meta { display:flex; align-items:center; gap:6px; justify-self:end; }
.selbar .btn { padding:5px 10px; white-space:nowrap; }
.sel__hint { color:var(--dim); }
/* Natives <select> auf .btn getrimmt: eigene Optik, aber das Menü bleibt das des
   Betriebssystems (Tastatur, Touch, kein offener Zustand im React-State). */
.selbar__menu { appearance:none; background:transparent; cursor:pointer; padding-right:11px; }
.selbar__menu option { background:var(--panel); color:var(--text); }

.row__l1 { display:flex; align-items:baseline; gap:8px; margin-bottom:2px; }
.row__firma { font-weight:600; font-size:13px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.row__age { font-family:var(--mono); font-size:10.5px; color:var(--dim); flex:none; font-variant-numeric:tabular-nums; }
/* display:block ist hier Pflicht, nicht Kosmetik: als <span> sind beide inline, und an
   inline-Elementen sind overflow/text-overflow/margin-bottom wirkungslos. Deshalb liefen
   Titel und Ausschnitt bisher in einer Zeile ineinander ("…ADMINISTRATOR:INAls Quereinsteiger")
   statt untereinander mit Auslassungspunkten. */
.row__titel { display:block; font-size:12.5px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-bottom:4px; }
.row__snip { display:block; font-size:11.5px; color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.row__meta { display:flex; align-items:center; gap:7px; margin-top:6px; }
.tag {
  font-family:var(--mono); font-size:9.5px; letter-spacing:.04em;
  padding:1px 5px; border-radius:3px; border:1px solid var(--line); color:var(--dim);
}
.tag--nomail { border-style:dashed; }
.tag--err { border-color:rgba(229,72,77,.4); color:var(--err); }
.tag--roh { border-style:dotted; border-color:rgba(232,176,75,.45); color:var(--fit-offstack); }
.tag--reply { border-color:rgba(53,208,165,.4); color:var(--ok); }

.empty { padding:56px 24px; text-align:center; color:var(--dim); }
.empty__h { color:var(--muted); font-weight:500; margin-bottom:5px; font-size:13px; }

/* ---------- Detail ---------- */
.dt { display:flex; flex-direction:column; min-width:0; min-height:0; background:var(--ink); }
.dt__back { display:none; }
.dt__head { padding:18px 24px 14px; border-bottom:1px solid var(--line-soft); }
.dt__firma { font-size:18px; font-weight:600; letter-spacing:-.01em; margin-bottom:3px; }
.dt__titel { color:var(--muted); font-size:13.5px; margin-bottom:11px; }
.dt__meta { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-family:var(--mono); font-size:11px; color:var(--dim); }
.dt__sep { color:var(--line); }
.dt__mail { color:var(--muted); }
.dt__nomail { color:var(--dim); font-style:italic; font-family:var(--sans); }
/* Sieht aus wie Text, bis man draufzeigt — die Adresse ist meistens nur zu lesen,
   aber sie muss von Hand korrigierbar sein (findEmail trifft nicht immer). */
.dt__mailin { color:var(--muted); font:inherit; background:transparent; border:0;
  border-bottom:1px dashed transparent; padding:0 0 1px; min-width:24ch; }
.dt__mailin:hover { border-bottom-color:var(--line); }
.dt__mailin:focus { outline:none; border-bottom-color:var(--accent); color:var(--ink); }
.dt__mailin::placeholder { color:var(--dim); font-style:italic; font-family:var(--sans); }
.lnk { display:inline-flex; align-items:center; gap:3px; color:var(--dim); }
.lnk:hover { color:var(--text); }
.lnk svg { width:10px; height:10px; }

/* Babyblau statt Standard-Browserblau, Rosa statt Lila für besuchte Links — weniger
   aggressiv auf dem dunklen Hintergrund. */
.dup-lnk:link { color:#8ecae6; }
.dup-lnk:visited { color:#e8a0c4; }
.dup-lnk:hover { color:var(--text); }

.fitpick { display:flex; align-items:center; gap:7px; margin-top:12px; }
.fitpick__lbl { font-size:11px; color:var(--dim); }
.fitbtn {
  display:flex; align-items:center; gap:5px; padding:2px 8px;
  border:1px solid var(--line); border-radius:99px; font-size:11px; color:var(--dim);
}
.fitbtn:hover { border-color:var(--dim); }
.fitbtn--on { border-color:transparent; font-weight:500; }

.tabs { display:flex; gap:2px; padding:10px 24px 0; border-bottom:1px solid var(--line-soft); }
.tab { padding:6px 11px; border-radius:5px 5px 0 0; color:var(--dim); font-size:12.5px; border-bottom:2px solid transparent; margin-bottom:-1px; }
.tab:hover { color:var(--text); }
.tab--on { color:var(--text); border-bottom-color:var(--text); font-weight:500; }

.dt__body { flex:1; min-height:0; overflow-y:auto; padding:22px 24px; }

/* ---------- Anhang ---------- */
.att { display:flex; flex-direction:column; min-width:0; min-height:0; background:var(--ink); grid-column:span 2; }
.dropzone {
  display:flex; align-items:center; justify-content:center; text-align:center;
  margin-top:16px; padding:28px; border:1px dashed var(--line); border-radius:8px;
  color:var(--dim); font-size:12.5px; cursor:pointer; max-width:420px;
}
.dropzone:hover { border-color:var(--dim); color:var(--muted); }
.dropzone input { display:none; }

/* Das Anschreiben: einzige helle Fläche der App. Es ist ein Brief, kein UI. */
.paper {
  background:var(--paper); color:var(--paper-ink);
  border-radius:3px; padding:34px 38px;
  box-shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 32px -8px rgba(0,0,0,.6);
  max-width:660px;
}
.paper__to {
  font-family:var(--mono); font-size:10.5px; color:#8C8A83;
  padding-bottom:14px; margin-bottom:20px; border-bottom:1px solid var(--paper-line);
  display:flex; justify-content:space-between; gap:12px;
}
.paper__ta {
  width:100%; background:none; border:none; outline:none; resize:none;
  font-family:var(--serif); font-size:14.5px; line-height:1.72; color:var(--paper-ink);
  display:block; overflow:hidden;
}
.paper__ta::selection { background:#C9DCF5; }
.paper__foot {
  margin-top:22px; padding-top:12px; border-top:1px solid var(--paper-line);
  font-family:var(--mono); font-size:10px; color:#9B9891; display:flex; justify-content:space-between;
}

.inserat { max-width:660px; font-size:13px; line-height:1.7; color:var(--muted); white-space:pre-wrap; }
.inserat h4 { font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--dim); margin:0 0 10px; font-weight:600; }

.errbox { max-width:660px; border:1px solid rgba(229,72,77,.3); background:rgba(229,72,77,.06); border-radius:6px; padding:16px 18px; margin-bottom:20px; }
.errbox__h { display:flex; align-items:center; gap:7px; color:var(--err); font-weight:600; font-size:12.5px; margin-bottom:7px; }
.errbox__h svg { width:14px; height:14px; }
.errbox__msg { font-family:var(--mono); font-size:11.5px; line-height:1.6; color:var(--muted); }

.bar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:12px 24px; border-top:1px solid var(--line-soft); background:var(--slate); }
.btn { display:flex; align-items:center; gap:6px; padding:6px 13px; border-radius:5px; border:1px solid var(--line); color:var(--muted); font-size:12.5px; }
.btn:hover { border-color:var(--dim); color:var(--text); }
.btn svg { width:13px; height:13px; }
.btn--primary { background:var(--text); color:var(--ink); border-color:var(--text); font-weight:600; }
.btn--primary:hover { background:#fff; border-color:#fff; color:var(--ink); }
.btn--ghost { border-color:transparent; }
.btn--danger:hover { border-color:rgba(229,72,77,.5); color:var(--err); }
.bar__spacer { flex:1; }
.bar__hint { font-family:var(--mono); font-size:10.5px; color:var(--dim); }

/* Rechts oben statt mittig unten — verdeckt so nicht den Content-Fokus in der Mitte.
   Alternative (mittig auf Augenhöhe), falls gewünscht, wäre hier eine Ein-Zeilen-Änderung:
   top:50%; left:50%; transform:translate(-50%,-50%); (position bleibt sonst gleich). */
.toaststack {
  position:fixed; top:20px; right:20px; z-index:50;
  display:flex; flex-direction:column; gap:8px;
}
.toast {
  background:var(--raised); border:1px solid var(--line); border-radius:6px;
  padding:8px 15px; font-size:12.5px; box-shadow:0 8px 24px rgba(0,0,0,.5);
  display:flex; align-items:center; gap:7px;
}
.toast svg { width:14px; height:14px; flex:none; }
.toast--ok { border-color:rgba(53,208,165,.4); }
.toast--ok svg { color:var(--ok); }
.toast--err { border-color:rgba(229,72,77,.4); }
.toast--err svg { color:var(--err); }

@media (prefers-reduced-motion:no-preference) {
  .toast { animation:rise .16s ease-out; }
  @keyframes rise { from { opacity:0; transform:translateY(-6px); } }
}

/* ---------- Kalender ---------- */
/* Eigene Ansicht (7-Spalten-Wochenraster), aber dieselben Farbtokens wie das Lade-Grid:
   --fit-matched für "gesendet", --ok für "Antwort" (deckt sich mit .tag--reply, das
   dieselbe Farbe für "hat geantwortet" in der Job-Liste nutzt). */
.cal { display:flex; flex-direction:column; min-width:0; min-height:0; background:var(--ink); grid-column:span 2; }
.cal__head-row { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.cal__legende { display:flex; gap:14px; margin-top:8px; font-size:11px; color:var(--dim); }
.cal__legende > span { display:flex; align-items:center; gap:5px; }
.cal__body { flex:1; min-height:0; overflow-y:auto; padding:22px 24px; display:flex; flex-direction:column; gap:28px; }
.cal__month-h {
  display:flex; align-items:center; gap:8px; width:100%; padding:4px 0;
  font-size:13px; font-weight:600; color:var(--text); margin-bottom:8px;
  text-transform:capitalize; text-align:left; cursor:pointer;
}
.cal__month-h:hover { color:var(--text); }
.cal__month-h:hover .cal__month-sum { color:var(--muted); }
.cal__caret { display:inline-block; color:var(--dim); font-size:10px; transition:transform .12s ease; }
.cal__caret--offen { transform:rotate(90deg); }
.cal__month-sum { font-family:var(--mono); font-size:10px; font-weight:400; color:var(--dim); text-transform:none; }
.cal__weekday-row, .cal__grid { display:grid; grid-template-columns:repeat(7, 34px); gap:4px; }
.cal__weekday-row { font-family:var(--mono); font-size:9.5px; color:var(--dim); text-align:center; margin-bottom:4px; }
.cal__sq {
  width:34px; height:34px; border-radius:5px; border:1px solid var(--line);
  display:flex; align-items:flex-end; justify-content:flex-end; padding:3px 4px;
  font-family:var(--mono); font-size:10px; color:var(--dim);
}
.cal__sq--pad { visibility:hidden; }
/* Farbe kommt inline aus CAL_COLOR (ein Tag kann gesendet + nachgefasst + Antwort
   tragen, das wären sonst sieben Kombinationsklassen) — hier bleibt nur, was für
   jeden gefüllten Tag gleich ist. */
.cal__sq--filled { border-color:transparent; color:var(--ink); }
.cal__sq--active { cursor:pointer; }
.cal__sq--active:hover { filter:brightness(1.15); }

.cal__hover {
  position:fixed; z-index:60; pointer-events:none;
  background:var(--raised); border:1px solid var(--line); border-radius:6px;
  padding:6px 10px; font-size:11.5px; color:var(--text); box-shadow:0 8px 24px rgba(0,0,0,.5);
  white-space:nowrap;
}

.cal__overlay { position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:70; display:flex; align-items:center; justify-content:center; }
.cal__popup { width:380px; max-height:70vh; display:flex; flex-direction:column; background:var(--panel); border:1px solid var(--line); border-radius:8px; box-shadow:0 20px 60px rgba(0,0,0,.6); }
.cal__popup-head { padding:14px 18px; border-bottom:1px solid var(--line-soft); font-weight:600; font-size:13.5px; text-transform:capitalize; }
.cal__popup-list { flex:1; min-height:0; overflow-y:auto; padding:6px 8px; }
.cal__entry { display:flex; align-items:center; gap:9px; width:100%; padding:8px 10px; border-radius:5px; text-align:left; }
.cal__entry:hover { background:var(--raised); }
/* Aus Gmail, kein Job dazu — nicht anklickbar, aber vollwertig sichtbar: der Eintrag
   ist der einzige Beleg für diese Bewerbung. */
.cal__entry--nurmail { cursor:default; }
.cal__entry--nurmail:hover { background:transparent; }
.cal__entry__quelle {
  font-family:var(--mono); font-size:9px; letter-spacing:.04em; flex:none;
  padding:1px 5px; border-radius:3px; border:1px dotted var(--line); color:var(--dim);
}
.cal__entry__dot { width:7px; height:7px; border-radius:99px; flex:none; }
.cal__entry__firma { font-weight:500; font-size:12.5px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cal__entry__titel { font-size:11px; color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:130px; }
.cal__popup-foot { padding:8px 18px; border-top:1px solid var(--line-soft); font-family:var(--mono); font-size:10px; color:var(--dim); }

/* ---------- Responsive ---------- */
/* ---------- Einstellungsseite "Suche" ---------- */
.cfg { display:flex; flex-direction:column; gap:34px; max-width:820px; }
.cfg__block { display:flex; flex-direction:column; gap:12px; }
.cfg__h {
  display:flex; align-items:baseline; gap:10px; margin:0;
  font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted);
}
.cfg__h span { font-size:10.5px; letter-spacing:0; text-transform:none; color:var(--dim); }
.cfg__erklaerung { margin:0; font-size:12px; color:var(--dim); max-width:60ch; }

.cfg__portal { border:1px solid var(--line-soft); border-radius:6px; padding:11px 13px; display:flex; flex-direction:column; gap:9px; }
.cfg__portal--aus { opacity:.55; }
.cfg__portal--aus:focus-within, .cfg__portal--aus:hover { opacity:1; }
.cfg__portal-kopf { display:flex; align-items:center; gap:10px; }
.cfg__portal-name { font-weight:600; font-size:13px; flex:1; }
.cfg__schalter { display:flex; align-items:center; gap:6px; font-family:var(--mono); font-size:10.5px; color:var(--dim); cursor:pointer; }

.cfg__chips { display:flex; flex-wrap:wrap; align-items:center; gap:5px; }
.cfg__chip {
  display:inline-flex; align-items:center; gap:5px; padding:3px 4px 3px 9px; border-radius:99px;
  border:1px solid var(--line); color:var(--muted); font-size:11.5px; white-space:nowrap;
}
.cfg__chip-x { color:var(--dim); font-size:13px; line-height:1; padding:2px 5px; border-radius:99px; }
.cfg__chip-x:hover { color:var(--err); background:var(--raised); }
.cfg__add {
  flex:1; min-width:150px; background:var(--ink); border:1px dashed var(--line); border-radius:99px;
  color:var(--text); font:inherit; font-size:11.5px; padding:3px 10px; outline:none;
}
.cfg__add:focus { border-style:solid; border-color:var(--dim); }
.cfg__add::placeholder { color:var(--dim); }

/* Zeilenform für Anfragen mit mehreren Feldern (linkedin, ams) — ein Chip müsste zum
   Ändern ohnehin aufklappen, dann kann es gleich eine Zeile sein. */
.cfg__zeilen { display:flex; flex-direction:column; gap:4px; }
.cfg__zeile { display:grid; gap:6px; align-items:center; }
.cfg__zeile--kopf { font-family:var(--mono); font-size:10px; letter-spacing:.05em; text-transform:uppercase; color:var(--dim); }
.cfg__feld {
  background:var(--ink); border:1px solid var(--line); border-radius:5px;
  color:var(--text); font:inherit; font-size:12px; padding:4px 8px; outline:none; min-width:0;
}
.cfg__feld:focus { border-color:var(--dim); }
.cfg__plus { align-self:flex-start; margin-top:2px; }

.cfg__warn {
  flex:1 0 100%; display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:4px;
  border:1px solid rgba(232,176,75,.4); background:rgba(232,176,75,.07); border-radius:6px;
  padding:9px 11px; font-size:12px; color:var(--fit-offstack);
}
.cfg__warn > span { flex:1 1 240px; }

.cfg__kaputt, .cfg__verwaist {
  border:1px solid rgba(232,98,42,.35); background:rgba(232,98,42,.06); border-radius:6px;
  padding:11px 13px; font-size:12px; color:var(--muted);
  display:flex; flex-direction:column; gap:7px;
}
.cfg__verwaist { flex-direction:row; align-items:center; gap:10px; }
.cfg__kaputt b { color:var(--fit-brutal); font-size:12.5px; }
.cfg__kaputt-zeile { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.cfg__kaputt-zeile > span { flex:1 1 260px; }

.cfg__gruppe { display:flex; flex-direction:column; gap:6px; }
.cfg__gruppe-name { font-size:12px; color:var(--dim); }

.cfg__roh { display:flex; flex-direction:column; gap:8px; align-items:flex-start; margin-top:4px; }
.cfg__roh-kopf { display:flex; align-items:center; gap:7px; font-size:12px; color:var(--muted); }
.cfg__roh-kopf:hover { color:var(--text); }
.cfg__roh-hint { font-family:var(--mono); font-size:10px; color:var(--dim); }
.cfg__roh-text {
  width:100%; max-height:340px; overflow:auto; margin:0;
  background:var(--ink); border:1px solid var(--line-soft); border-radius:6px; padding:11px 13px;
  font-family:var(--mono); font-size:11px; line-height:1.6; color:var(--muted);
}
.cfg__leiste { display:flex; flex-wrap:wrap; gap:8px; margin-top:4px; }

/* ---------- Mobile Kopfzeile + Schublade ---------- */
/* Beide existieren nur unterhalb von 1024. Darüber ist .sb eine normale Rasterspalte,
   und diese Regeln fassen sie nicht an. */
.topbar { display:none; }
.sb__overlay { display:none; }

/* Umschaltpunkt von 960 auf 1024 gehoben: dazwischen standen drei Spalten auf zu wenig
   Platz (bei 1024 waren es 208+320+496). Ab hier ist die Seitenleiste eine Schublade. */
@media (max-width:1023px) {
  .jb { grid-template-columns:minmax(0, 1fr); }
  .ls { border-right:none; }
  .dt { display:none; }
  .jb--detail .ls { display:none; }
  .jb--detail .dt { display:flex; }
  .dt__back { display:flex; align-items:center; gap:5px; padding:11px 16px 0; color:var(--muted); font-size:12.5px; }
  .dt__back svg { width:14px; height:14px; }
  .dt__head, .dt__body, .tabs, .bar { padding-left:16px; padding-right:16px; }
  .paper { padding:24px 22px; }

  /* Die Pipeline-Ansichten sind für zwei Spalten gebaut. Im Ein-Spalten-Raster erzeugt
     span 2 eine implizite zweite Spalte — heute 0px breit und damit harmlos, aber sie
     sitzen dort aus Versehen richtig statt aus Absicht. */
  .att, .cal { grid-column:1 / -1; }

  /* Trefferflächen: 13px-Zeilen und ein 13px-Kästchen sind für den Daumen zu klein. */
  .fld { min-height:44px; }
  .chip { padding:8px 12px; }
  .row__check { width:20px; height:20px; margin-left:12px; }
  .row { padding-top:14px; padding-bottom:14px; }

  /* Kalender wächst mit, statt bei 7×34px stehenzubleiben. */
  .cal__weekday-row, .cal__grid { grid-template-columns:repeat(7, minmax(0, 1fr)); }
  .cal__sq { width:auto; }

  /* Mehrfeldrige Anfragen stapeln statt nebeneinander — drei Felder auf 390px sind
     drei unlesbare Spalten. Die Kopfzeile entfällt dabei, die Platzhalter tragen. */
  .cfg__zeile { grid-template-columns:1fr auto !important; }
  .cfg__zeile--kopf { display:none; }
  .cfg__zeile .cfg__feld { grid-column:1; }
  .cfg__zeile .cfg__chip-x { grid-row:1; grid-column:2; }
  /* Gestapelt sind drei Anfragen zu je zwei Feldern sechs Kästen untereinander — ohne
     Klammer sieht man nicht, welche zusammengehören. */
  .cfg__zeilen .cfg__zeile:not(.cfg__zeile--kopf) {
    border:1px solid var(--line-soft); border-radius:6px; padding:7px; background:var(--slate);
  }

  /* Nachfass-Zeile zweizeilig: Firma+Titel oben, Adresse+Alter darunter. */
  .nf__row { grid-template-columns:auto 1fr; row-gap:4px; }
  .nf__titel { grid-column:2; }
  .nf__meta { grid-column:2; justify-self:start; }

  /* top statt padding-top: .jb ist position:fixed;inset:0 und selbst NICHT von der
     border-box-Regel erfasst (die gilt für .jb *), ein padding würde es zu hoch machen. */
  .jb { top:48px; }
  .topbar {
    position:fixed; top:0; left:0; right:0; height:48px; z-index:58;
    display:flex; align-items:center; gap:10px; padding:0 8px;
    background:var(--slate); border-bottom:1px solid var(--line-soft);
  }
  .topbar__burger {
    display:flex; align-items:center; justify-content:center;
    width:40px; height:40px; border-radius:6px; color:var(--muted); flex:none;
  }
  .topbar__burger:hover { color:var(--text); background:var(--raised); }
  .topbar__burger svg { width:18px; height:18px; }
  .topbar__wo { font-weight:600; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .topbar__n { font-family:var(--mono); font-size:11px; color:var(--dim); flex:none; margin-left:auto; }

  /* Schublade: fährt über den Inhalt statt ihn zu verschieben — der Inhalt ist hier
     ohnehin nur eine Spalte breit, ein Wegschieben würde ihn unlesbar quetschen. */
  .sb {
    position:fixed; top:0; bottom:0; left:0; z-index:60;
    width:min(300px, 84vw); transform:translateX(-100%);
  }
  .sb--offen { transform:none; box-shadow:0 0 40px rgba(0,0,0,.5); }
  .sb__overlay { display:block; position:fixed; inset:0; z-index:59; background:rgba(0,0,0,.5); }
}
@media (max-width:1023px) and (prefers-reduced-motion:no-preference) {
  .sb { transition:transform .18s ease-out; }
}

/* Band C: ab 2000px hat die Detailspalte Platz für zwei Bahnen (bei 2560 sind es 1894px).
   Statt Anschreiben UND Inserat übereinander umzuschalten, stehen sie nebeneinander — beim
   Prüfen liest man den Brief gegen das Inserat, und genau dafür war der Platz bisher leer.
   Die Tabs verschwinden, weil es nichts mehr umzuschalten gibt. */
.dt__panels--brief .dt__panel--inserat,
.dt__panels--inserat .dt__panel--brief { display:none; }

@media (min-width:2000px) {
  .tabs { display:none; }
  .dt__panels {
    display:grid; grid-template-columns:minmax(0, 660px) minmax(0, 720px);
    gap:36px; align-items:start; justify-content:start;
  }
  /* schlägt die Tab-Regel oben, weil gleich spezifisch und später im Stylesheet */
  .dt__panels--brief .dt__panel--inserat,
  .dt__panels--inserat .dt__panel--brief { display:block; }
  /* Eine Zeile "Ort · Quelle · Alter · Hinweis" über 1500px ist keine Zeile mehr,
     sondern eine Fährte. */
  .dt__head > * { max-width:1100px; }
}

`;
