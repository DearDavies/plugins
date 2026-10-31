// Zed's cloud takes an Anthropic message's content as blocks only. A string,
// which Anthropic's own API takes as one text block, is answered 400 "failed
// to parse Anthropic request: invalid type: string \"hi\", expected a
// sequence": magpie's model test sends {"role":"user","content":"hi"}, and
// every Claude model failed its test (Been on Discord, plugin 0.1.11).
import { afterEach, expect, test } from "bun:test"
import { _internal } from "./index.mjs"

const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
  _internal.tokens.clear()
})

const s = { userId: "4242", access: "plain-access", systemId: "", org: "org-me", plan: "zed_pro", who: "octo" }

// sent is the provider_request the plugin hands Zed for an Anthropic body.
async function sent(body) {
  let got
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname
    if (path === "/client/llm_tokens") return Response.json({ token: "llm-token" })
    if (path === "/completions") {
      got = JSON.parse(init.body)
      const ev = (e) => JSON.stringify({ event: e })
      return new Response(
        [
          ev({ type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: "claude-sonnet-5", content: [], usage: { input_tokens: 1, output_tokens: 0 } } }),
          ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
          ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }),
          ev({ type: "content_block_stop", index: 0 }),
          ev({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }),
          ev({ type: "message_stop" }),
          JSON.stringify({ status: "stream_ended" }),
        ].join("\n") + "\n",
        { headers: { "x-zed-server-supports-status-messages": "true" } },
      )
    }
    return new Response("", { status: 404 })
  }
  const res = await _internal.complete(s, "https://cloud.zed.dev/v1/messages", { method: "POST", body: JSON.stringify(body) })
  return { req: got.provider_request, res, text: await res.text() }
}

test("magpie's model test, a string content, goes to Zed as one text block", async () => {
  // the body magpie's Test models sends (internal/provider/test.go tinyBody)
  const { req, res, text } = await sent({ model: "claude-sonnet-5", max_tokens: 16, messages: [{ role: "user", content: "hi" }] })
  expect(req.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }])
  expect(res.status).toBe(200)
  expect(JSON.parse(text).content).toEqual([{ type: "text", text: "Hi" }])
})

test("each turn's string content becomes blocks; block content is left as sent", async () => {
  const blocks = [{ type: "text", text: "and now?", cache_control: { type: "ephemeral" } }]
  const { req } = await sent({
    model: "claude-sonnet-5",
    stream: true,
    max_tokens: 100,
    system: "You are terse.",
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi." },
      { role: "user", content: blocks },
    ],
  })
  expect(req.messages).toEqual([
    { role: "user", content: [{ type: "text", text: "hello" }] },
    { role: "assistant", content: [{ type: "text", text: "Hi." }] },
    { role: "user", content: blocks },
  ])
  // the top-level system is as the agent sent it (Zed's StringOrContents)
  expect(req.system).toBe("You are terse.")
})
