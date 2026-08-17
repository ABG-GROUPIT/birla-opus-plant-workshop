import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const vercelConfigUrl = new URL("../vercel.json", import.meta.url);
const pagesWorkflowUrl = new URL("../.github/workflows/pages.yml", import.meta.url);

test("keeps GitHub Pages as the only automatic deployment target", async () => {
  const [vercelConfigText, pagesWorkflow] = await Promise.all([
    readFile(vercelConfigUrl, "utf8"),
    readFile(pagesWorkflowUrl, "utf8"),
  ]);
  const vercelConfig = JSON.parse(vercelConfigText);

  assert.equal(vercelConfig.git?.deploymentEnabled, false);
  assert.match(pagesWorkflow, /name:\s*Deploy GitHub Pages/i);
  assert.match(pagesWorkflow, /actions\/deploy-pages@/i);
});
