// deepseek-v4.1-flash as each build serves it, against each build's own
// /v3/config (testdata/config-561.json: copilot.tencent.com's and
// www.workbuddy.ai's, 2026-10-31, cut to the models compared here).
//   plugins#561: the China build turns a prompt over 100000 tokens away on
//   it, though its config says 1000000; glm-5.3-flash on the same endpoint
//   takes the million, and WorkBuddy AI's deepseek-v4.1-flash took 181,887.
//   plugins#563: it takes reasoning_effort "none" (0 reasoning tokens),
//   though the config says onlyReasoning, so it lists an off level.
import { afterEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { _internal } from "./index.mjs"

const real = globalThis.fetch
afterEach(() => (globalThis.fetch = real))

const configs = JSON.parse(readFileSync(new URL("./testdata/config-561.json", import.meta.url), "utf8"))

async function listed(site) {
  globalThis.fetch = async () => new Response(JSON.stringify(configs[site]))
  const out = await _internal.liveModels(_internal.SITES[site], { access: "a", uid: "u" })
  return Object.fromEntries(out.map((m) => [m.id, m]))
}

test("the China build's deepseek-v4.1-flash takes 100000 tokens, its other models what the config says", async () => {
  const m = await listed("workbuddy")
  expect(m["deepseek-v4.1-flash"].context).toBe(100000)
  expect(m["glm-5.3-flash"].context).toBe(1000000)
  expect(m["deepseek-v4-pro"].context).toBe(1000000)
})

test("WorkBuddy AI's deepseek-v4.1-flash keeps the config's million", async () => {
  const m = await listed("workbuddy-ai")
  expect(m["deepseek-v4.1-flash"].context).toBe(1000000)
  expect(m["deepseek-v4.1-flash-sg"].context).toBe(1000000)
})

test("a config smaller than the cap is kept", () => {
  const site = _internal.SITES.workbuddy
  expect(_internal.contextOf(site, "deepseek-v4.1-flash", 64000)).toBe(64000)
  expect(_internal.contextOf(site, "deepseek-v4.1-flash", undefined)).toBe(100000)
  expect(_internal.contextOf(site, "glm-5.3-flash", 1000000)).toBe(1000000)
})

test("the China build's own model list caps it too", () => {
  const cn = _internal.configModels(_internal.SITES.workbuddy)
  expect(cn["deepseek-v4.1-flash"].limit.context).toBe(100000)
  expect(cn["glm-5.3-flash"].limit.context).toBe(1000000)
})

test("deepseek-v4.1-flash lists none on both builds, its paid id too", async () => {
  const cn = await listed("workbuddy")
  const ai = await listed("workbuddy-ai")
  expect(cn["deepseek-v4.1-flash"].efforts).toEqual(["none", "low", "high", "max"])
  expect(ai["deepseek-v4.1-flash"].efforts).toEqual(["none", "low", "high", "max"])
  expect(ai["deepseek-v4.1-flash-sg"].efforts).toEqual(["none", "low", "high", "max"])
  // its default stays what the config says
  expect(cn["deepseek-v4.1-flash"].effort).toBe("high")
  expect(Object.keys(_internal.configModels(_internal.SITES.workbuddy)["deepseek-v4.1-flash"].variants)).toEqual(["none", "low", "high", "max"])
})

test("glm-5.3-flash, which can't turn thinking off, still lists no none", async () => {
  const cn = await listed("workbuddy")
  const ai = await listed("workbuddy-ai")
  expect(cn["glm-5.3-flash"].efforts).toEqual(["low", "high", "max"])
  expect(ai["glm-5.3-flash"].efforts).toEqual(["low", "high", "max"])
  expect(cn["deepseek-v4-pro"].efforts).toEqual(["none", "high", "xhigh"])
})
