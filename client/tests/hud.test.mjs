import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyConsole } from "../public/src/game/hud.js";

test("chat dunia dikenali dan dibersihkan", () => {
  const c = classifyConsole("CP:_PL:0_OID:_CT:[W]_`$<`2budi`$> halo");
  assert.equal(c.kind, "world");
  assert.equal(c.chat, true);
  assert.equal(c.text, "<budi> halo");
});
test("pesan pribadi", () => {
  assert.equal(classifyConsole("CP:_PL:0_OID:_CT:[P]_hai").kind, "private");
});
test("pesan sistem", () => {
  const c = classifyConsole("Welcome back");
  assert.deepEqual([c.kind, c.chat], ["system", false]);
});
