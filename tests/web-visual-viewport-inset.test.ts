import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { installVisualViewportInset } from "../apps/web/src/runtime/visual-viewport-inset";

type Listener = () => void;

class FakeStyle {
  readonly props = new Map<string, string>();
  setProperty(name: string, value: string) {
    this.props.set(name, value);
  }
  removeProperty(name: string) {
    this.props.delete(name);
    return "";
  }
}

function withFakeViewport(
  options: { innerHeight: number; height: number; offsetTop?: number; missing?: boolean },
  run: (context: { fireResize: () => void; setHeight: (height: number) => void; style: FakeStyle }) => void,
) {
  const windowListeners = new Map<string, Set<Listener>>();
  const viewportListeners = new Map<string, Set<Listener>>();
  const viewport = {
    height: options.height,
    offsetTop: options.offsetTop ?? 0,
    addEventListener(type: string, listener: Listener) {
      const bucket = viewportListeners.get(type) ?? new Set();
      bucket.add(listener);
      viewportListeners.set(type, bucket);
    },
    removeEventListener(type: string, listener: Listener) {
      viewportListeners.get(type)?.delete(listener);
    },
  };
  const fakeWindow = {
    innerHeight: options.innerHeight,
    visualViewport: options.missing ? undefined : viewport,
    addEventListener(type: string, listener: Listener) {
      const bucket = windowListeners.get(type) ?? new Set();
      bucket.add(listener);
      windowListeners.set(type, bucket);
    },
    removeEventListener(type: string, listener: Listener) {
      windowListeners.get(type)?.delete(listener);
    },
    setTimeout(callback: () => void) {
      callback();
      return 0;
    },
  };
  const previous = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  const style = new FakeStyle();
  try {
    run({
      fireResize() {
        for (const listener of viewportListeners.get("resize") ?? []) listener();
      },
      setHeight(height: number) {
        viewport.height = height;
      },
      style,
    });
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previous });
  }
}

test("visualViewport writes keyboard overlap and clears it when the viewport recovers", () => {
  withFakeViewport({ innerHeight: 800, height: 500, offsetTop: 0 }, ({ fireResize, setHeight, style }) => {
    const restore = installVisualViewportInset(style as unknown as CSSStyleDeclaration);
    assert.equal(style.props.get("--keyboard-inset"), "300px");

    setHeight(800);
    fireResize();
    assert.equal(style.props.get("--keyboard-inset"), "0px");

    restore();
    assert.equal(style.props.has("--keyboard-inset"), false);
  });
});

test("missing visualViewport keeps a zero inset and still uninstalls", () => {
  withFakeViewport({ innerHeight: 800, height: 500, missing: true }, ({ style }) => {
    const restore = installVisualViewportInset(style as unknown as CSSStyleDeclaration);
    assert.equal(style.props.get("--keyboard-inset"), "0px");
    restore();
    assert.equal(style.props.has("--keyboard-inset"), false);
  });
});

test("keyboard inset helper stays on Chromium 61 APIs", () => {
  const source = readFileSync(join(process.cwd(), "apps", "web", "src", "runtime", "visual-viewport-inset.ts"), "utf8");
  assert.match(source, /visualViewport/);
  assert.doesNotMatch(source, /Object\.hasOwn\(|\.at\(|crypto\.randomUUID\(/);
  assert.doesNotMatch(source, /\b(?:d|s|l)vh\b/);
});
