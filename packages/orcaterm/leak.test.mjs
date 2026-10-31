import { test, expect } from "bun:test"
import { _internal, OrcaTermAuthPlugin } from "./index.mjs"

// magpie-community/plugins#564 (ferocknew): a session's reply came out as the
// assistant's own action envelope, and another session's transcript ended with
// OrcaTerm's output protocol. These are the reporter's literal bytes.
const ANSWER = "## 一句话结论\n\n这个提交（2b40776，把案例模块改成「构造时注入数据库连接」的重构）xxxxxx....."
const REPORTED = `{
  "action": "completion",
  "ph_1": "--",
  "taskCompletion": "## 一句话结论\\n\\n这个提交（2b40776，把案例模块改成「构造时注入数据库连接」的重构）xxxxxx....."
}`
const REPORTED_COMPACT = '{"action":"completion","ph_1":"--","taskCompletion":"## 一句话结论\\n\\n这个提交（2b40776，把案例模块改成「构造时注入数据库连接」的重构）xxxxxx....."}'

const frame = (content, reasoningContent = "") =>
  `data: ${JSON.stringify({ content, reasoningContent, type: "ai", code: 0 })}\n\n`

const sse = (frames) =>
  new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(new TextEncoder().encode(f))
      c.close()
    },
  })

const pieces = (s, n) => {
  const out = []
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n))
  return out
}

async function streamed(res) {
  const text = await res.text()
  let content = ""
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue
    content += JSON.parse(line.slice(6)).choices[0].delta.content ?? ""
  }
  return content
}

for (const [name, raw] of [
  ["pretty-printed", REPORTED],
  ["compact", REPORTED_COMPACT],
]) {
  test(`the reported envelope (${name}) comes out as its answer, streamed and not`, async () => {
    for (const n of [1, 3, 17, raw.length]) {
      const res = _internal.upstreamToOpenAI(sse(pieces(raw, n).map((p) => frame(p))), { model: "m" })
      expect(await streamed(res)).toBe(ANSWER)
    }
    const res = await _internal.upstreamToJSON(sse([frame(raw)]), { model: "m" })
    expect((await res.json()).choices[0].message.content).toBe(ANSWER)
  })
}

// The assistant writes its own JSON, and a long Markdown answer comes with the
// line breaks written as they are and quotes left unescaped. That is not JSON,
// and the whole object went out as the reply.
test("an envelope whose answer has raw line breaks and bare quotes is still unwrapped", async () => {
  const answer = '## 一句话结论\n\n这个提交把 "案例模块" 改成\t构造时注入。\n- 第一点'
  const raw = `{\n  "action": "completion",\n  "ph_1": "--",\n  "taskCompletion": "${answer}"\n}`
  expect(() => JSON.parse(raw)).toThrow()
  for (const n of [1, 5, raw.length]) {
    const res = _internal.upstreamToOpenAI(sse(pieces(raw, n).map((p) => frame(p))), { model: "m" })
    expect(await streamed(res)).toBe(answer)
  }
  const res = await _internal.upstreamToJSON(sse([frame(raw)]), { model: "m" })
  expect((await res.json()).choices[0].message.content).toBe(answer)
})

// Upstream sent the envelope as thinking and no text: the reply fell back to
// the thinking, envelope and all.
test("an envelope that arrives as thinking only falls back to its answer, not its JSON", async () => {
  const res = _internal.upstreamToOpenAI(sse([frame("", REPORTED)]), { model: "m" })
  expect(await streamed(res)).toBe(ANSWER)
  const j = await _internal.upstreamToJSON(sse([frame("", REPORTED)]), { model: "m" })
  expect((await j.json()).choices[0].message.content).toBe(ANSWER)
})

// An agent that kept an earlier envelope in its history sent it back up as the
// assistant's turn, and the model then answered in the same shape.
test("an earlier assistant turn in the envelope's shape goes up as its answer", () => {
  const up = _internal.toUpstreamBody(
    {
      messages: [
        { role: "user", content: "review 2b40776" },
        { role: "assistant", content: REPORTED },
        { role: "user", content: "thanks, and the tests?" },
      ],
    },
    { conversationId: "cid-1", userId: "u-1" },
  )
  expect(up.input.input).not.toContain('"action"')
  expect(up.input.input).not.toContain("taskCompletion")
  expect(up.input.input).toContain("assistant: ## 一句话结论")
})

// OrcaTerm keeps a conversation's turns by its id. The plugin sends the whole
// transcript every time, so an id reused across requests added upstream's copy
// of earlier turns — the assistant's protocol and its envelopes, and with no
// session id (or the same one) another session's too.
test("no two requests share an upstream conversation, whatever session they name", async () => {
  const ids = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    ids.push(JSON.parse(init.body).conversationId)
    return new Response(frame("ok") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } })
  }
  try {
    const plugin = await OrcaTermAuthPlugin({ client: { app: { log: () => {} } } })
    const loader = await plugin.auth.loader(async () => ({ type: "api", key: "uin=o1234567890; skey=SECRET123456" }))
    const ask = async (session) => {
      const headers = { "content-type": "application/json" }
      const h = {}
      await plugin["chat.headers"]({ sessionID: session, model: { providerID: "orcaterm" } }, { headers: h })
      Object.assign(headers, h)
      const res = await loader.fetch("https://lightai.cloud.tencent.com/assistant/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "TokenHub/glm-5.3", stream: false, messages: [{ role: "user", content: "hi" }] }),
      })
      await res.text()
    }
    await ask("")
    await ask("")
    await ask("magpie-a083915a")
    await ask("magpie-a083915a")
    await ask("magpie-other")
    expect(ids.length).toBe(5)
    expect(new Set(ids).size).toBe(5)
    for (const id of ids) expect(id).toMatch(/^cid-[0-9a-f-]{36}-orcaterm$/)
  } finally {
    globalThis.fetch = realFetch
  }
})

// The plugin's only hook on other providers' requests is chat.headers, and it
// adds nothing to them.
test("another provider's request gets nothing from this plugin", async () => {
  const plugin = await OrcaTermAuthPlugin({ client: { app: { log: () => {} } } })
  const out = { headers: {} }
  await plugin["chat.headers"]({ sessionID: "s", model: { providerID: "anthropic" } }, out)
  expect(out.headers).toEqual({})
  const hooks = Object.keys(plugin).filter((k) => k !== "auth" && k !== "config")
  expect(hooks).toEqual(["chat.headers"])
})

test("prose followed by a hand-written envelope that isn't JSON keeps the prose only", async () => {
  const prose = "结论：重构把连接改成构造时注入。\n\n"
  const raw = prose + '```json\n{"action": "completion", "ph_1": "--", "taskCompletion": "结论：\n"注入"连接"}\n```'
  for (const n of [1, 7, raw.length]) {
    const res = _internal.upstreamToOpenAI(sse(pieces(raw, n).map((p) => frame(p))), { model: "m" })
    expect(await streamed(res)).toBe(prose)
  }
})

test("a hand-written envelope keeps what it doesn't escape, and an object that isn't one is left alone", () => {
  expect(_internal.looseEnvelopeAnswer('{"action": "completion", "taskCompletion": "C:\\Users\\me "a"\n\\u4e2d", "ph_2": "--"}')).toBe('C:\\Users\\me "a"\n中')
  expect(_internal.looseEnvelopeAnswer('{"type": "completion", "taskCompletion": "x\ny"}')).toBe(null)
  expect(_internal.looseEnvelopeAnswer('{"action": "completion", "taskCompletion": "x\ny"} and then prose')).toBe(null)
  const example = 'Here is the shape:\n{"action": "SAVE", "content": "a\nb"}'
  expect(_internal.answerOf(example)).toBe(example)
})
