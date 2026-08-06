import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIVE_BRIDGE_PROTOCOL_VERSION,
  registerHongTaiNativePlugins,
  type NativePluginRegistrar,
} from "./bridge.js";

test("registers the local-data boundary without exposing secret reads", () => {
  const requestedNames: string[] = [];
  const registrar: NativePluginRegistrar = <T>(name: string): T => {
    requestedNames.push(name);
    return {} as T;
  };

  const plugins = registerHongTaiNativePlugins(registrar);

  assert.equal(NATIVE_BRIDGE_PROTOCOL_VERSION, 1);
  assert.deepEqual(requestedNames, [
    "SecureSettings",
    "LocalData",
    "NativeNetwork",
    "FileMedia",
    "MediaRuntime",
    "TaskRuntime",
  ]);
  assert.equal("readSecret" in plugins.secureSettings, false);
});
