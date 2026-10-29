import { noRealGrok } from "./nocli.mjs"
import { afterAll, afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GrokAuthPlugin } from "./index.mjs"

noRealGrok()

// Grok Build sends these on every Responses request; without them the proxy
// lets a looping reply run to max_output_tokens (yetone/magpie#3594).
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
const home = mkdtempSync(join(tmpdir(), "grok-loop-check-"))
afterAll(() => rmSync(home, { recursive: true, force: true }))
const expires = Date.now() + 24 * 3600_000
writeFileSync(join(home, "auth.json"), JSON.stringify({
  test: { key: "test-token", email: "test@example.invalid", expires_at: new Date(expires).toISOString() },
}))
const auth = { type: "oauth", refresh: home, access: "test-token", expires, accountId: "test@example.invalid" }

async function send(path, headers = {}) {
  let seen
  globalThis.fetch = async (_, init) => {
    seen = new Headers(init.headers)
    return Response.json({ output: [] })
  }
  const hooks = await GrokAuthPlugin({ client: {} })
  const opts = await hooks.auth.loader(async () => auth)
  await opts.fetch(`https://cli-chat-proxy.grok.com/v1/${path}`, {
    method: "POST", headers, body: JSON.stringify({ model: "grok-4.7", input: "hi", stream: true }),
  })
  return seen
}

test("a Responses request asks for Grok Build's loop checks", async () => {
  const h = await send("responses")
  expect(h.get("x-grok-doom-loop-check")).toBe("1024")
  expect(h.get("x-grok-exact-repetition-check")).toBe("64")
})

test("a value the caller set is kept", async () => {
  const h = await send("responses", { "x-grok-doom-loop-check": "2048" })
  expect(h.get("x-grok-doom-loop-check")).toBe("2048")
  expect(h.get("x-grok-exact-repetition-check")).toBe("64")
})

test("other paths go without them", async () => {
  const h = await send("models")
  expect(h.has("x-grok-doom-loop-check")).toBe(false)
  expect(h.has("x-grok-exact-repetition-check")).toBe(false)
})
