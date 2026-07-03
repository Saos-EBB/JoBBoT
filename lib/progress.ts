const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

// \r springt nur an den Anfang der AKTUELLEN (ggf. umgebrochenen) Terminal-Zeile,
// nicht an den Anfang der ganzen Nachricht. Ist die Zeile breiter als das
// Terminal, bricht sie um — jeder Frame überschreibt dann nur die letzte
// Umbruch-Zeile, während der Rest stehen bleibt und sich Frame für Frame
// dupliziert. Deshalb hart auf die Terminalbreite kürzen.
export function fitToWidth(line: string): string {
  const width = process.stdout.columns || 80;
  return line.length >= width ? line.slice(0, width - 2) + '…' : line;
}

export interface Progress {
  update(message: string): void;
  succeed(message: string): void;
  fail(message: string): void;
  stop(): void;
}

export function createProgress(initial = ''): Progress {
  const tty = process.stdout.isTTY === true;
  let message = initial;
  let frameIdx = 0;
  let prevLen = 0;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  if (tty) {
    timer = setInterval(() => {
      const line = fitToWidth(`${FRAMES[frameIdx++ % FRAMES.length]} ${message}`);
      process.stdout.write(`\r${line}`);
      prevLen = line.length;
    }, 80);
  }

  function clear() {
    if (tty && prevLen > 0) process.stdout.write(`\r${' '.repeat(prevLen)}\r`);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer) { clearInterval(timer); timer = null; }
    clear();
  }

  return {
    update(msg: string) {
      if (stopped) return;
      message = msg;
      // non-TTY: suppress mid-run noise; spinner owns the line in TTY mode
    },
    succeed(msg: string) {
      stop();
      if (tty) process.stdout.write(`✓ ${msg}\n`);
      else console.log(`✓ ${msg}`);
    },
    fail(msg: string) {
      stop();
      if (tty) process.stdout.write(`✗ ${msg}\n`);
      else console.log(`✗ ${msg}`);
    },
    stop,
  };
}

export interface AggregateProgress {
  report(source: string, current: number, total: number): void;
  stop(): void;
}

// Ein Timer für ALLE Quellen statt ein \r-Spinner pro Quelle (die würden sich
// gegenseitig überschreiben). Non-TTY: gedrosselte Plain-Zeilen statt Flut bei
// jedem report()-Aufruf.
export function createAggregateProgress(sources: string[]): AggregateProgress {
  const tty = process.stdout.isTTY === true;
  const state = new Map<string, { current: number; total: number; started: boolean }>(
    sources.map(s => [s, { current: 0, total: 0, started: false }]),
  );
  let frameIdx = 0;
  let prevLen = 0;
  let stopped = false;
  let lastPlainRender = 0;

  // Quellen, die noch auf einen Scheduler-Slot warten, haben noch KEIN report()
  // gesehen (der erste Aufruf kommt erst, wenn der Adapter tatsächlich startet) —
  // "wartet…" statt irreführendem "0/0".
  function render(): string {
    return sources.map(s => {
      const st = state.get(s)!;
      return st.started ? `${s} ${st.current}/${st.total}` : `${s} wartet…`;
    }).join(' · ');
  }

  function clear() {
    if (tty && prevLen > 0) process.stdout.write(`\r${' '.repeat(prevLen)}\r`);
  }

  const timer = tty ? setInterval(() => {
    const line = fitToWidth(`${FRAMES[frameIdx++ % FRAMES.length]} ${render()}`);
    process.stdout.write(`\r${line}`);
    prevLen = line.length;
  }, 80) : null;

  return {
    report(source, current, total) {
      if (stopped || !state.has(source)) return;
      state.set(source, { current, total, started: true });
      if (!tty) {
        const now = Date.now();
        if (now - lastPlainRender > 1000) {
          console.log(render());
          lastPlainRender = now;
        }
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      clear();
    },
  };
}
