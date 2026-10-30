// Cursor's free credit (CryptoSarom on X: "magpie 似乎没法支持 cursor 的赠金
// 读取, 以及赠金使用限制"), as Cursor 3.x's IDE reads it:
// GetCurrentPeriodUsage's planUsage.bonusSpend / remainingBonus /
// bonusTooltip (its "+$X free usage on us" line) and
// DashboardService/GetUsageLimitStatusAndActiveGrants' activeGrants (its
// "Use your $X free … credits" banner), whose allowedModelIds,
// allowedModelTags and allowedClientTypes say what a grant may be spent on.
//
// The plan replies are real bytes: REAL_PERIOD and REAL_GRANTS are a
// Premium (merged, weekly) account's GetCurrentPeriodUsage and
// GetUsageLimitStatusAndActiveGrants, read 2026-10-31 (autoBucketModels
// shortened), and the #1868 team account's planUsage has a bonusSpend.
// No account at hand had a grant, so the grant replies are Connect JSON of
// aiserver.v1.ActiveCreditGrant as the IDE's and cursor-agent 2026.10.01's
// schemas declare it (int64 fields as strings, as REAL_GRANTS' cents are).
import "./nonet.mjs" // first: no request leaves this machine
import { afterEach, expect, test } from "bun:test"
import { CursorAuthPlugin } from "./index.mjs"

const real = globalThis.fetch
afterEach(() => (globalThis.fetch = real))

let n = 0
const fresh = () => ({
  type: "oauth",
  access: ["e30", Buffer.from(JSON.stringify({ sub: "auth0|user_credit" + ++n, exp: Math.floor(Date.now() / 1000) + 7200 + n })).toString("base64url"), "sig"].join("."),
  refresh: "",
  expires: 0,
  accountId: "a@b.c",
})

const DASH = "https://api2.cursor.sh/aiserver.v1.DashboardService/"
const PERIOD = DASH + "GetCurrentPeriodUsage"
const PLAN = DASH + "GetPlanInfo"
const HARD = DASH + "GetHardLimit"
const GRANTS = DASH + "GetUsageLimitStatusAndActiveGrants"

const REAL_PERIOD = {"billingCycleStart":"1793078412396","billingCycleEnd":"1793683212396","planUsage":{"remainingBonus":false,"bonusTooltip":"We work with model providers to give you free usage beyond what you've purchased. Amounts may vary.","autoPercentUsed":7.042253521126761,"apiPercentUsed":0,"totalPercentUsed":7.042253521126761},"spendLimitUsage":{"limitType":"user"},"displayThreshold":200,"enabled":true,"displayMessage":"You've used 7% of your included usage","autoModelSelectedDisplayMessage":"You've used 7% of your included total usage","namedModelSelectedDisplayMessage":"You've used 0% of your included API usage","autoBucketModels":["default","composer-2","composer-2.5","grok-4.7"]}
const REAL_PLAN = {"planInfo":{"planName":"Premium","price":"","billingCycleEnd":"1794547141340","includedUsagePeriod":"INCLUDED_USAGE_PERIOD_WEEKLY","includedUsageResetsAt":"1793683212396"},"isMerged":true}
const REAL_GRANTS = {"usageLimitPolicyStatus":{"canConfigureSpendLimit":true,"canAdjustOnDemand":true,"recommendedOnDemandLimitCents":"10000","onDemandMinCents":"5000","onDemandMaxCents":"20000","creditRequestButtonHidden":false}}

const provider = { models: Object.fromEntries(["auto", "composer-2.5", "claude-opus-5-5@300k", "claude-opus-5-5@1m", "gpt-5.6-sol"].map((id) => [id, { id }])) }
const at = new Date(1793683212396).toISOString()
const later = Date.now() + 5 * 86400_000

async function read(r, on = false) {
  const seen = []
  globalThis.fetch = async (url, init) => {
    url = String(url)
    seen.push({ url, headers: init.headers, body: init.body })
    if (url === PERIOD) return Response.json(r.period)
    if (url === PLAN) return Response.json(r.plan ?? {})
    if (url === HARD) return Response.json(r.hard ?? { hardLimit: 0 })
    if (url === GRANTS) return r.grants instanceof Response ? r.grants : Response.json(r.grants ?? REAL_GRANTS)
    return new Response("no", { status: 404 })
  }
  const hooks = await CursorAuthPlugin({ magpie: { option: (p, k) => (p === "cursor" && k === "included_only" ? on : undefined) } })
  const a = fresh()
  return { ...(await hooks.auth.usage(async () => a, provider)), seen }
}

// how magpie reads the windows (internal/provider/plugin_usage.go,
// routing.go allowanceOf): a window not aside and used up stops each model
// it counts
function counts(w, model) {
  if (w.models?.length) return w.models.includes(model)
  if (w.notModels?.length) return !w.notModels.includes(model)
  return true
}
const stopped = (windows, model) => windows.some((w) => !w.aside && w.used >= 100 && counts(w, model))

const spentPools = { billingCycleEnd: "1793683212396", planUsage: { autoPercentUsed: 100, apiPercentUsed: 100, totalPercentUsed: 100 }, autoBucketModels: ["default", "composer-2.5"] }
const grant = (g) => ({ activeGrants: [{ grantId: "1001", totalCents: "2000", remainingCents: "1500", expiresAtMs: String(later), grantType: "promo", showInClient: true, ...g }] })

test("the real account with no bonus and no grant shows no free credit, and asks for grants as the IDE does", async () => {
  const { windows, seen } = await read({ period: REAL_PERIOD, plan: REAL_PLAN })
  expect(windows.map((w) => w.name)).toEqual(["Weekly"])
  const g = seen.find((r) => r.url === GRANTS)
  expect(g.body).toBe("{}")
  expect(g.headers["Connect-Protocol-Version"]).toBe("1")
})

test("the plan's bonus: its spend is shown, and with some left the spent pools don't stop the account", async () => {
  const { windows } = await read({ period: { ...spentPools, planUsage: { ...spentPools.planUsage, bonusSpend: 1234, remainingBonus: true } } })
  expect(windows.find((w) => w.name === "Free usage")).toEqual({ name: "Free usage", used: 0, display: "+$12.34 on us, more left", resetsAt: at, aside: true })
  for (const m of ["composer-2.5", "gpt-5.6-sol"]) expect(stopped(windows, m)).toBe(false)
  // none left: the spent pools stop it again
  const out = (await read({ period: { ...spentPools, planUsage: { ...spentPools.planUsage, bonusSpend: 1234, remainingBonus: false } } })).windows
  expect(out.find((w) => w.name === "Free usage").display).toBe("+$12.34 on us")
  for (const m of ["composer-2.5", "gpt-5.6-sol"]) expect(stopped(out, m)).toBe(true)
})

test("a grant for every model: remaining of total, its expiry, and the spent pools stay aside while it lasts", async () => {
  const { windows } = await read({ period: spentPools, grants: grant({ campaignName: "Launch week" }) })
  expect(windows.find((w) => w.name === "Launch week")).toEqual({
    name: "Launch week", used: 25, display: "$5.00 / $20.00", amount: 5, limit: 20, unit: "USD",
    runsOutAt: new Date(later).toISOString(), runsOut: 15, aside: true,
  })
  for (const m of ["composer-2.5", "gpt-5.6-sol"]) expect(stopped(windows, m)).toBe(false)
  // used up, or expired: the pools are the allowance again
  for (const g of [{ remainingCents: "0" }, { expiresAtMs: String(Date.now() - 1000) }]) {
    const out = (await read({ period: spentPools, grants: grant(g) })).windows
    for (const m of ["composer-2.5", "gpt-5.6-sol"]) expect(stopped(out, m)).toBe(true)
  }
})

test("a grant limited to some models names them, and keeps only those served past a spent pool", async () => {
  for (const g of [{ allowedModelIds: ["claude-opus-5-5"] }, { allowedModelTags: ["opus-5"] }, { allowedModelSelections: [{ modelId: "claude-opus-5-5", maxMode: false }] }]) {
    const { windows } = await read({ period: spentPools, grants: grant(g) })
    const w = windows.find((w) => w.name === "Free credit")
    // a sized id is asked for by its bare name too
    expect(w.models).toEqual(["claude-opus-5-5@300k", "claude-opus-5-5", "claude-opus-5-5@1m"])
    expect(w.aside).toBe(true)
    expect(stopped(windows, "claude-opus-5-5@1m")).toBe(false)
    expect(stopped(windows, "gpt-5.6-sol")).toBe(true)
    expect(stopped(windows, "composer-2.5")).toBe(true)
  }
  // with room in the pools nothing changes
  const room = (await read({ period: { ...spentPools, planUsage: { autoPercentUsed: 10, apiPercentUsed: 10, totalPercentUsed: 10 } }, grants: grant({ allowedModelIds: ["claude-opus-5-5"] }) })).windows
  expect(room.find((w) => w.name === "Other Models").notModels).toEqual(["auto", "composer-2.5", "default"])
})

test("a grant on Cursor Models alone keeps a spent Cursor Models pool from stopping them, never counting every model", async () => {
  const { windows } = await read({ period: spentPools, grants: grant({ allowedModelIds: ["default", "composer-2.5"] }) })
  const cm = windows.find((w) => w.name === "Cursor Models")
  expect(cm.models.length).toBeGreaterThan(0)
  expect(stopped(windows, "composer-2.5")).toBe(false)
  expect(stopped(windows, "auto")).toBe(false)
  expect(stopped(windows, "gpt-5.6-sol")).toBe(true)
})

test("a merged plan's spent Weekly leaves out the models a grant pays for", async () => {
  const { windows } = await read({ period: spentPools, plan: REAL_PLAN, grants: grant({ allowedModelIds: ["gpt-5.6-sol"] }) })
  expect(stopped(windows, "gpt-5.6-sol")).toBe(false)
  expect(stopped(windows, "composer-2.5")).toBe(true)
})

test("a grant magpie can't spend (Cloud Agents only, or another client) is shown with its limit and keeps nothing served", async () => {
  for (const [clients, name] of [[["glass"], "Free credit (Cloud Agents only)"], [["ide"], "Free credit (ide only)"]]) {
    const { windows } = await read({ period: spentPools, grants: grant({ allowedClientTypes: clients }) })
    expect(windows.find((w) => w.name === name)).toBeDefined()
    expect(stopped(windows, "composer-2.5")).toBe(true)
  }
  const cli = (await read({ period: spentPools, grants: grant({ allowedClientTypes: ["ide", "cli"] }) })).windows
  expect(stopped(cli, "composer-2.5")).toBe(false)
})

test("with Included usage only on, free credit is shown and keeps nothing served", async () => {
  const { windows } = await read({ period: { ...spentPools, planUsage: { ...spentPools.planUsage, bonusSpend: 100, remainingBonus: true } }, grants: grant({}) }, true)
  expect(windows.some((w) => w.name === "Free credit")).toBe(true)
  expect(stopped(windows, "composer-2.5")).toBe(true)
})

test("free credit goes after Bot and before Total; a grants read that fails leaves the card as before", async () => {
  const { windows } = await read({ period: spentPools, grants: grant({}) })
  expect(windows.map((w) => w.name)).toEqual(["Cursor Models", "Other Models", "Free credit", "Total"])
  const failed = (await read({ period: spentPools, grants: new Response("no", { status: 500 }) })).windows
  expect(failed.map((w) => w.name)).toEqual(["Cursor Models", "Other Models", "Total"])
  for (const m of ["composer-2.5", "gpt-5.6-sol"]) expect(stopped(failed, m)).toBe(true)
})
