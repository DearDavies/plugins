// kthink on Discord: dsh on google/gemini-3.8-flash through Command Code
// was refused 400 AI_UnsupportedFunctionalityError "Google schema
// conversion only supports references to direct children of root-level
// $defs or definitions … JSON Schema reference:
// #/properties/func/properties/triggers/items". A tool schema that reuses
// an earlier part of itself by a JSON pointer has that part written out
// for a Google model, on the Provider API and on Go's /alpha/generate; a
// ref to a direct child of $defs, which Google takes, goes as it came, and
// every other model's schema goes as it came.
import { afterEach, expect, test } from "bun:test"
import { CommandCodePlugin, _internal } from "./index.mjs"

const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
  _internal.subsSeen.clear()
  _internal.extraSeen.clear()
})

const TRIGGER = { type: "object", properties: { on: { type: "string", enum: ["push", "pull"] } }, required: ["on"] }
// shaped as the error's path: a later property reuses
// #/properties/func/properties/triggers/items
const DSH = {
  type: "object",
  properties: {
    func: {
      type: "object",
      properties: {
        name: { type: "string" },
        triggers: { type: "array", items: TRIGGER },
      },
    },
    extra: { type: "array", items: { $ref: "#/properties/func/properties/triggers/items", description: "another trigger" } },
  },
  required: ["func"],
}
const tool = (parameters) => ({ type: "function", function: { name: "schedule", description: "d", parameters } })

const refsIn = (s) => [...JSON.stringify(s).matchAll(/"\$ref":"([^"]*)"/g)].map((m) => m[1])

test("a pointer into the schema is written out for a Google model", () => {
  const g = _internal.googleSchema(DSH)
  expect(refsIn(g)).toEqual([])
  expect(g.properties.extra.items).toEqual({ ...TRIGGER, description: "another trigger" })
  expect(g.properties.func).toEqual(DSH.properties.func)
  expect(DSH.properties.extra.items.$ref).toBe("#/properties/func/properties/triggers/items") // not changed in place
})

test("a ref to a direct child of $defs goes as it came, and its def is gone through", () => {
  const s = {
    type: "object",
    properties: { a: { $ref: "#/$defs/A" }, b: { $ref: "#/definitions/B" } },
    $defs: { A: { type: "object", properties: { x: { $ref: "#/properties/b" } } } },
    definitions: { B: { type: "string" } },
  }
  const g = _internal.googleSchema(s)
  expect(g.properties.a).toEqual({ $ref: "#/$defs/A" })
  expect(g.properties.b).toEqual({ $ref: "#/definitions/B" })
  expect(g.$defs.A.properties.x).toEqual({ $ref: "#/definitions/B" })
  expect(g.definitions).toEqual(s.definitions)
})

test("a schema that refers to itself ends", () => {
  const s = { type: "object", properties: { name: { type: "string" }, children: { type: "array", items: { $ref: "#" } } } }
  const g = _internal.googleSchema(s)
  expect(refsIn(g)).toEqual([])
  expect(g.properties.children.items.properties.children.items).toEqual({ type: "object" })
  const deep = { type: "object", properties: { a: { type: "object", properties: { b: { $ref: "#/properties/a" } } } } }
  expect(refsIn(_internal.googleSchema(deep))).toEqual([])
})

test("data named $ref (an enum, a default) and a ref that names nothing go as they came", () => {
  const s = {
    type: "object",
    properties: {
      e: { type: "object", default: { $ref: "#/properties/x" }, enum: [{ $ref: "#/properties/x" }] },
      lost: { $ref: "#/properties/nowhere" },
      remote: { $ref: "https://example.com/s.json" },
    },
  }
  expect(_internal.googleSchema(s)).toEqual(s)
})

test("Google's models are told apart from the rest", () => {
  for (const m of ["google/gemini-3.8-flash", "google/gemini-3.5-flash-lite", "gemini-3.8-flash"]) expect(_internal.isGoogle(m)).toBe(true)
  for (const m of ["anthropic/claude-sonnet-4-6", "deepseek/deepseek-v4-pro", "moonshotai/Kimi-K3", "openai/gpt-5.5", undefined]) expect(_internal.isGoogle(m)).toBe(false)
})

// sends schema's tool for model through a plan's fetch and gives the tool
// schema the gateway was sent
async function sent(plan, model, schema) {
  const out = []
  globalThis.fetch = async (input, init = {}) => {
    const path = new URL(typeof input === "string" ? input : input.url ?? String(input)).pathname
    if (path.endsWith("/chat/completions")) {
      const b = init.body ?? (input instanceof Request ? await input.text() : undefined)
      out.push(JSON.parse(b).tools[0].function.parameters)
      return Response.json({ choices: [] })
    }
    if (path === "/alpha/generate") {
      out.push(JSON.parse(init.body).params.tools[0].input_schema)
      return new Response(JSON.stringify({ type: "finish", finishReason: "stop", totalUsage: { inputTokens: 1, outputTokens: 1 } }) + "\n")
    }
    return new Response("", { status: 404 })
  }
  const hooks = await CommandCodePlugin()
  const opts = await hooks.auth.loader(async () => ({ type: "api", key: plan.toLowerCase(), metadata: { plan } }))
  const body = { model, stream: false, messages: [{ role: "user", content: "hi" }], tools: [tool(schema)] }
  const res = await opts.fetch("https://api.commandcode.ai/provider/v1/chat/completions", { method: "POST", body: JSON.stringify(body) })
  await res.text()
  expect(out.length).toBe(1)
  return out[0]
}

for (const plan of ["GOAT", "Go"])
  test(`${plan}: a Google model is sent the schema written out, any other the schema as it came`, async () => {
    expect(refsIn(await sent(plan, "google/gemini-3.8-flash", DSH))).toEqual([])
    for (const m of ["anthropic/claude-sonnet-4-6", "deepseek/deepseek-v4-pro", "moonshotai/Kimi-K3"]) expect(await sent(plan, m, DSH)).toEqual(DSH)
  })
