import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

test("first-load keeps the home shell eager and splits the other product routes", () => {
  const app = read("App.tsx");

  assert.match(app, /import \{ TaskHomePage \} from "\.\/pages\/TaskHomePage"/);
  assert.match(app, /import \{ HomePage \} from "\.\/pages\/HomePage"/);
  assert.match(app, /<Suspense fallback=\{<PageSkeleton path=\{pathname\} \/>\}>\{renderRoute\(pathname\)\}<\/Suspense>/);
  assert.match(app, /holdLazyModule/);
  assert.doesNotMatch(app, /LoadingState/);
  assert.doesNotMatch(app, /Splash|假进度|splash-screen/i);

  for (const page of [
    "TemplatesPage",
    "CreatePage",
    "ObservationReportPage",
    "ObservationStartPage",
    "TaskPage",
    "AiSettingsPage",
    "ApplicationInfoPage",
    "ProfileSettingsPage",
    "SettingsPage",
  ]) {
    assert.match(app, new RegExp(`const ${page} = lazy\\(async`));
    assert.doesNotMatch(app, new RegExp(`import \\{ ${page} \\} from`));
  }
});
