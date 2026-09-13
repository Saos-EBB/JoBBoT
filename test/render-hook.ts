import { createElement } from 'react';
import { act } from 'react';
import TestRenderer from 'react-test-renderer';

// Ohne dieses Flag warnt React bei jedem act() "testing environment not configured" —
// @testing-library/react setzt es intern, hier von Hand, weil wir ohne die Library auskommen.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Hand-gebaut statt @testing-library/react-hooks (deprecated) oder @testing-library/react
// (bräuchte jsdom) — die 11 UI-Hooks fassen nie echte DOM-Elemente an, react-test-renderer
// reicht für State + Effects. Fasst nur, was die Hook-Tests brauchen: aktuellen Rückgabewert
// lesen, mit neuen Props neu rendern, unmounten (löst Effect-Cleanups aus).
export function renderHook<TResult, TProps>(
  callback: (props: TProps) => TResult,
  initialProps: TProps,
): { result: { current: TResult }; rerender: (props: TProps) => void; unmount: () => void } {
  const result = { current: undefined as unknown as TResult };

  function TestComponent({ hookProps }: { hookProps: TProps }) {
    result.current = callback(hookProps);
    return null;
  }

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(createElement(TestComponent, { hookProps: initialProps }));
  });

  return {
    result,
    rerender(props: TProps) {
      act(() => { renderer.update(createElement(TestComponent, { hookProps: props })); });
    },
    unmount() {
      act(() => { renderer.unmount(); });
    },
  };
}

export { act };

// Lässt anhängige Promise-Ketten (fetch().then().then(setState)) ablaufen, bevor der Test
// weiterprüft — setImmediate feuert erst nach allen bereits eingereihten Microtasks.
export function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

// Minimal-Stub für den einen SSE-Anwendungsfall aus ui/components/grid.tsx (useGridStream):
// `new EventSource(url)`, `.onmessage`, `.close()`. Node kennt EventSource nicht global.
export class FakeEventSource {
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  close(): void {
    this.closed = true;
  }

  static instances: FakeEventSource[] = [];

  static install(): void {
    FakeEventSource.instances = [];
    (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  }

  static uninstall(): void {
    delete (globalThis as { EventSource?: unknown }).EventSource;
  }

  static latest(): FakeEventSource {
    const es = FakeEventSource.instances.at(-1);
    if (!es) throw new Error('kein EventSource erzeugt');
    return es;
  }
}
