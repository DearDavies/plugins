// plugins#572 (kongbai01203): WorkBuddy AI's kimi-k3 read as image: false
// and reasoning: false, the list the plugin declares before an account's
// own is read. That list said no model took images, while both sites'
// /v3/config mark every one supportsImages (read 2026-11-01), and a chat to
// www.workbuddy.ai's kimi-k3 with a blue|yellow PNG answered "Blue yellow".
// Only WorkBuddy AI's GLM models drop images (textOnly).
import { expect, test } from "bun:test"
import { WorkBuddyAIAuthPlugin, _internal } from "./index.mjs"

test("a declared model takes images unless its site drops them", () => {
  const ai = _internal.configModels(_internal.SITES["workbuddy-ai"])
  expect(ai["kimi-k3"].modalities.input).toEqual(["text", "image"])
  expect(ai["kimi-k3"].attachment).toBe(true)
  expect(ai["glm-5.3"].modalities.input).toEqual(["text"])
  expect(ai["glm-5.3"].attachment).toBe(false)
  for (const site of ["workbuddy", "workbuddy-ai"]) {
    for (const [id, m] of Object.entries(_internal.configModels(_internal.SITES[site]))) {
      const img = !(site === "workbuddy-ai" && id.startsWith("glm-"))
      expect([site, id, m.modalities.input.includes("image")]).toEqual([site, id, img])
    }
  }
})

test("the config hook declares kimi-k3 with images", async () => {
  const h = await WorkBuddyAIAuthPlugin({ client: {} })
  const cfg = {}
  await h.config(cfg)
  const m = cfg.provider["workbuddy-ai"].models["kimi-k3"]
  expect(m.modalities.input).toContain("image")
})
