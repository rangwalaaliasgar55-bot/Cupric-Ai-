import { describe, expect, it, beforeAll } from "vitest";
import { writeFileSync } from "node:fs";
import { installDom, makeCtx, type CallLog } from "./mock-canvas";

installDom();

type Mods = { reg: typeof import("@/registry"); core: typeof import("@/core/registry"); tpl: typeof import("@/video/templates"); ai: typeof import("@/ai/generate"); comp: typeof import("@/render/compositor"); sg: typeof import("@/core/scene-graph") };
let M: Mods;
beforeAll(async () => {
  M = { reg: await import("@/registry"), core: await import("@/core/registry"), tpl: await import("@/video/templates"), ai: await import("@/ai/generate"), comp: await import("@/render/compositor"), sg: await import("@/core/scene-graph") };
});

describe("registry", () => {
  it("meets catalog minimums with real assets", () => {
    const c = M.reg.catalogCounts().byKind;
    expect(c.motion).toBeGreaterThanOrEqual(100);
    expect(c.typography).toBeGreaterThanOrEqual(50);
    expect((c.background ?? 0) + (c.shader ?? 0)).toBeGreaterThanOrEqual(50);
    expect(c.transition).toBeGreaterThanOrEqual(50);
    expect(c.effect).toBeGreaterThanOrEqual(30);
    expect((c.three ?? 0) + (c.material ?? 0) + (c.lighting ?? 0) + (c.camera ?? 0)).toBeGreaterThanOrEqual(40);
    expect(c.particles).toBeGreaterThanOrEqual(30);
    expect((c.ui ?? 0) + (c.device ?? 0)).toBeGreaterThanOrEqual(40);
    expect(c.chart).toBeGreaterThanOrEqual(30);
    expect(c.logo).toBeGreaterThanOrEqual(30);
    expect(c.template).toBeGreaterThanOrEqual(30);
  });
  it("every asset declares schema, capabilities and performance", () => { for (const a of M.core.allAssets()) { expect(a.schema, a.id).toBeTruthy(); expect(a.performance.cpu, a.id).toMatch(/low|medium|high/); expect(typeof a.capabilities.video).toBe("boolean"); } });
  it("semantic search finds relevant assets", () => {
    expect(M.core.searchTransitions("liquid")[0].id).toBe("transition:liquid");
    expect(M.core.searchTemplates("SaaS launch").length).toBeGreaterThan(0);
    expect(M.core.searchAssets("premium AI background", { kind: ["background", "shader"] }).length).toBeGreaterThan(0);
    expect(M.core.search3DPresets("gold luxury")[0].id).toContain("gold");
    expect(M.core.getComponentSchema("typography:scramble")?.text).toBeTruthy();
  });
});

describe("templates & responsive layouts", () => {
  it("every template builds a valid document in every aspect", () => {
    for (const id of Object.keys(M.tpl.TEMPLATES)) for (const aspect of ["16:9", "9:16", "1:1", "4:5"] as const) {
      const d = M.tpl.buildTemplate(id, { aspect, brand: { name: "Acme" } });
      const r = M.sg.importDoc(d);
      expect(r.ok, `${id} ${aspect} ${r.ok ? "" : r.errors.join(";")}`).toBe(true);
    }
  });
  it("uses alternate layouts (not crops) for portrait", () => {
    const land = M.tpl.buildTemplate("productLaunch", { aspect: "16:9" }), port = M.tpl.buildTemplate("productLaunch", { aspect: "9:16" });
    const h = (d: typeof land) => new M.sg.SceneGraph(d).get("product.headline") as import("@/core/types").SceneNode;
    expect((h(land).transform.x ?? 0) / land.width).toBeLessThan(0.4); // text left, product right
    expect((h(port).transform.x ?? 0) / port.width).toBeCloseTo(0.5); // stacked
    expect((h(port).transform.y ?? 0) / port.height).toBeLessThan(0.3);
  });
  it("brand color regenerates theme", () => { const d = M.tpl.buildTemplate("aiLaunch", { brand: { name: "X", primary: "#ff3366" } }); expect(d.theme).toContain("custom"); });
});

describe("AI generation", () => {
  it("analyzes the success-test prompt", async () => {
    const a = M.ai.analyzePrompt("Create a 25-second premium futuristic AI SaaS advertisement.");
    expect(a.duration).toBe(25); expect(a.aspect).toBe("16:9"); expect(a.style).toBe("futuristic");
    expect(a.scenes).toEqual(["hook", "problem", "aiProcessing", "dashboard", "features", "metrics", "cta"]);
    const { doc } = await M.ai.generateVideo({ prompt: "Create a 25-second premium futuristic AI SaaS advertisement." });
    expect(doc.scenes).toHaveLength(7);
    expect(Math.abs(M.sg.docDuration(doc) / doc.fps - 25)).toBeLessThan(2);
  });
  it("detects vertical platforms and structures", async () => {
    expect(M.ai.analyzePrompt("15 second TikTok for a fintech app").aspect).toBe("9:16");
    const { doc } = await M.ai.generateVideo({ format: "1:1", duration: 12, brand: { name: "NewBrand", primaryColor: "#22d3ee" }, scenes: ["hook", "problem", "solution", "cta"] });
    expect(doc.width).toBe(1080); expect(doc.scenes.map((s) => s.type)).toEqual(["hook", "problem", "product", "cta"]);
  });
  it("auto-selects libraries", () => {
    expect(M.ai.selectLibrary("Make this text cinematic").layer).toContain("typography");
    expect(M.ai.selectLibrary("Make this product 3D").layer).toContain("Three");
    expect(M.ai.selectLibrary("Make this into a video").layer).toContain("Mediabunny");
    expect(M.ai.selectLibrary("Add a professional transition").layer).toContain("transition");
  });
});

describe("rendering (real compositor, mock 2D context)", () => {
  it("renders every template across its duration without throwing", () => {
    for (const id of Object.keys(M.tpl.TEMPLATES)) {
      const d = M.tpl.buildTemplate(id, {});
      const total = M.sg.docDuration(d);
      for (let k = 0; k < 6; k++) { const log: CallLog = []; const ctx = makeCtx(640, 360, log); M.comp.renderFrame(ctx, d, Math.floor((k / 6) * total), { quality: "low" }); expect(log.length, `${id}@${k}`).toBeGreaterThan(5); }
    }
  });
  it("is frame-deterministic (same frame → identical draw calls)", () => {
    const d = M.tpl.buildTemplate("futuristicAd", {});
    for (const f of [0, 37, 200, 400]) {
      const a: CallLog = [], b: CallLog = [];
      M.comp.renderFrame(makeCtx(640, 360, a), d, f, { quality: "medium" });
      M.comp.renderFrame(makeCtx(640, 360, b), d, 123, { quality: "medium" }); // render something else in between
      const c: CallLog = []; M.comp.renderFrame(makeCtx(640, 360, c), d, f, { quality: "medium" });
      expect(c.join("|")).toBe(a.join("|"));
      void b;
    }
  });
  it("renders every registered asset preview", () => {
    for (const a of M.core.allAssets()) { if (!a.preview) continue; const d = a.preview(); const log: CallLog = []; M.comp.renderFrame(makeCtx(320, 180, log), d, Math.floor(M.sg.docDuration(d) / 2), { quality: "low" }); expect(log.length, a.id).toBeGreaterThan(0); }
  });
});

describe.skipIf(!process.env.WRITE_CATALOG)("catalog generation", () => {
  it("writes ASSET_CATALOG.md from the live registry", () => {
    const all = M.core.allAssets();
    const kinds = [...new Set(all.map((a) => a.kind))].sort();
    const c = M.reg.catalogCounts();
    let md = `# ASSET_CATALOG.md\n\nGenerated from the live registry (\`WRITE_CATALOG=1 npx vitest run src/tests/system.test.ts\`). **${c.total} registered assets.** Counts are real registrations — no duplicated placeholder entries.\n\n| Kind | Count |\n|---|---|\n`;
    for (const k of kinds) md += `| ${k} | ${all.filter((a) => a.kind === k).length} |\n`;
    md += `\nAdditional: ${c.entranceMotion} entrance + ${c.loopMotion} loop motion presets; ${c.chartAnimationVariants} chart×animation variants; exits reuse any entrance preset.\n`;
    for (const k of kinds) { md += `\n## ${k}\n\n`; for (const a of all.filter((x) => x.kind === k)) md += `- \`${a.id}\` — **${a.name}**: ${a.description} _(cpu ${a.performance.cpu}, gpu ${a.performance.gpu}; ${a.tags.slice(0, 5).join(", ")})_\n`; }
    writeFileSync("ASSET_CATALOG.md", md);
  });
});
