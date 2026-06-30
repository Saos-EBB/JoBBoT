const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

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
      const line = `${FRAMES[frameIdx++ % FRAMES.length]} ${message}`;
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
