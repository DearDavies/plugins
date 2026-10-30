// WorkBuddy's safety filter refusing a reply it had begun (itspig, plugins
// #540): deepseek-v4.1-flash on copilot.tencent.com reasoned, said "Sorry,
// I can't respond to this question.", and ended finish_reason
// content_filter with 0 output tokens, all under a 200. The text is taken
// out, so the reply says nothing before content_filter: the refusal magpie
// asks the group's next member for.
import { expect, test } from "bun:test"
import { WorkBuddyAuthPlugin } from "./index.mjs"

const said = "Sorry, I can't respond to this question."

const chunk = (delta, finish = null, usage) =>
  `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "deepseek-v4.1-flash", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`

const zero = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

// pieces is a stream's bytes cut where the given cuts fall, as a server's
// writes may
function streamOf(text, cuts = 7) {
  const b = new TextEncoder().encode(text)
  return new ReadableStream({
    start(c) {
      for (let i = 0; i < b.length; i += cuts) c.enqueue(b.slice(i, i + cuts))
      c.close()
    },
  })
}

async function through(upstream, cuts) {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes("/chat/completions")) return new Response(streamOf(upstream, cuts), { headers: { "content-type": "text/event-stream" } })
    return new Response("{}", { headers: { "content-type": "application/json" } })
  }
  try {
    const hooks = await WorkBuddyAuthPlugin({ client: {} })
    const loader = await hooks.auth.loader(async () => ({ type: "oauth", access: "access", uid: "uid", expires: Date.now() + 3600_000 }))
    const res = await loader.fetch("https://copilot.tencent.com/v2/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "deepseek-v4.1-flash", stream: true, reasoning_effort: "high", messages: [{ role: "user", content: "hi" }] }),
    })
    expect(res.status).toBe(200)
    return await res.text()
  } finally {
    globalThis.fetch = realFetch
  }
}

const contents = (out) =>
  out
    .split("\n\n")
    .filter((e) => e.startsWith("data: {"))
    .map((e) => JSON.parse(e.slice(6)).choices?.[0])
    .filter(Boolean)

for (const [name, text] of [
  ["in one delta", [chunk({ content: said })]],
  ["a few words at a time", [chunk({ content: "Sorry" }), chunk({ content: ", I can't" }), chunk({ content: " respond to this question." })]],
]) {
  for (const cuts of [7, 1 << 20]) {
    test(`the filter's text before content_filter is taken out, ${name}, ${cuts > 7 ? "whole" : "cut"}`, async () => {
      const upstream =
        chunk({ role: "assistant", reasoning_content: "" }) +
        chunk({ reasoning_content: "The user is asking" }) +
        chunk({ reasoning_content: " about it." }) +
        text.join("") +
        chunk({}, "content_filter", zero) +
        "data: [DONE]\n\n"
      const out = await through(upstream, cuts)
      expect(out).not.toContain("Sorry")
      const cs = contents(out)
      expect(cs.map((c) => c.delta.reasoning_content ?? "").join("")).toBe("The user is asking about it.")
      expect(cs.some((c) => typeof c.delta.content === "string" && c.delta.content)).toBe(false)
      expect(cs.at(-1).finish_reason).toBe("content_filter")
      expect(out.endsWith("data: [DONE]\n\n")).toBe(true)
    })
  }
}

test("the filter's text in the chunk that ends content_filter is taken out", async () => {
  const out = await through(chunk({ reasoning_content: "hm" }) + chunk({ content: said }, "content_filter", zero) + "data: [DONE]\n\n")
  expect(out).not.toContain("Sorry")
  expect(contents(out).at(-1).finish_reason).toBe("content_filter")
})

test("the same words as an answer that ends stop go through whole", async () => {
  const upstream = chunk({ reasoning_content: "hm" }) + chunk({ content: "Sorry" }) + chunk({ content: ", I can't respond to this question." }) + chunk({}, "stop") + "data: [DONE]\n\n"
  expect(await through(upstream)).toBe(upstream)
})

test("a reply that only begins like it goes through as it came", async () => {
  const upstream = chunk({ content: "Sorry" }) + chunk({ content: ", I can't find that file." }) + chunk({}, "stop") + "data: [DONE]\n\n"
  expect(await through(upstream)).toBe(upstream)
})

test("a reply cut off by content_filter after other words keeps them", async () => {
  const upstream = chunk({ content: "Here is the plan: " }) + chunk({ content: said }) + chunk({}, "content_filter") + "data: [DONE]\n\n"
  expect(await through(upstream)).toBe(upstream)
})

test("an answer's words are not held", async () => {
  // the first chunk that isn't the filter's goes out before the stream ends
  const enc = new TextEncoder()
  let push
  const body = new ReadableStream({ start: (c) => (push = c) })
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) =>
    String(url).includes("/chat/completions")
      ? new Response(body, { headers: { "content-type": "text/event-stream" } })
      : new Response("{}", { headers: { "content-type": "application/json" } })
  try {
    const hooks = await WorkBuddyAuthPlugin({ client: {} })
    const loader = await hooks.auth.loader(async () => ({ type: "oauth", access: "access", uid: "uid", expires: Date.now() + 3600_000 }))
    const res = await loader.fetch("https://copilot.tencent.com/v2/chat/completions", { method: "POST", body: JSON.stringify({ model: "deepseek-v4.1-flash", stream: true, messages: [{ role: "user", content: "hi" }] }) })
    const rd = res.body.getReader()
    push.enqueue(enc.encode(chunk({ content: "Hello" })))
    const { value } = await rd.read()
    expect(new TextDecoder().decode(value)).toContain("Hello")
    push.close()
  } finally {
    globalThis.fetch = realFetch
  }
})
