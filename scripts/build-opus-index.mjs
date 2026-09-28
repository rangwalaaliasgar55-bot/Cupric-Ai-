#!/usr/bin/env node
// Structured retrieval index over the Opus 5.5 case catalogue
// (resources/opus55/data/cases.json, MIT, https://github.com/chuspeeism/awesome-opus-5-5-videos).
//
// Honesty rules:
//  - Only facts stated in the case text are recorded. Every derived tag keeps
//    the matched evidence phrase, so a reviewer can check it.
//  - A field the source doesn't state is null. Nothing is guessed: shot count,
//    pacing and hook are almost never published, so they stay null unless stated.
//  - The index is used for retrieval and citation only. It isn't training data,
//    and cases are adapted structurally, never copied.
//
//   node scripts/build-opus-index.mjs → resources/opus55/data/index.json
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const cases = JSON.parse(readFileSync(path.join(root, 'resources/opus55/data/cases.json'), 'utf8'))
const skillsDef = JSON.parse(readFileSync(path.join(root, 'resources/opus55/skills.json'), 'utf8'))

const CATEGORY_EN = { '叙事与音乐': 'story-music', '品牌与产品': 'brand-product', '动效与片头': 'motion-intro', '知识与教学': 'education', '三维与空间': '3d-space' }

// [tag, regex] — regexes run over title + summary + prompt (original language).
const RULES = {
  videoType: [
    ['ad', /广告|宣传片|推广|promo|\bad\b/i],
    ['launch', /发布|上线|launch|预告/i],
    ['product-demo', /产品演示|演示|demo|功能展示|界面/i],
    ['saas-walkthrough', /SaaS|软件|应用|App|网站|dashboard|仪表盘/i],
    ['explainer', /讲解|解释|科普|原理|教学|教程|explain/i],
    ['tutorial', /教程|步骤|如何|how to|tutorial/i],
    ['music-video', /音乐视频|MV|歌曲|歌词|music video/i],
    ['narrative', /故事|叙事|短片|剧情|角色/i],
    ['logo-reveal', /logo|标志|片头|开场|intro/i],
    ['data-explainer', /数据|图表|统计|可视化|chart/i],
    ['comparison', /对比|比较|vs\b|versus/i],
    ['3d', /三维|3D|Three\.js|three\.js|WebGL|Blender/i],
    ['game', /游戏|game/i],
    ['founder', /创始人|创业|founder|startup/i],
    ['trailer', /预告片|trailer/i],
  ],
  techniques: [
    ['remotion', /Remotion/i], ['threejs', /Three\.js|three\.js/i], ['html-canvas', /HTML|Canvas|canvas/], ['javascript-frames', /JavaScript|逐帧/i],
    ['svg', /SVG/i], ['shader', /shader|着色器|WebGL/i], ['p5', /p5\.js|p5/i], ['gsap', /GSAP/i], ['blender', /Blender/i],
    ['after-effects', /After Effects|AE\b/], ['kinetic-typography', /文字动画|字体|排版|typography|kinetic/i], ['particles', /粒子|particle/i],
    ['camera-move', /镜头|运镜|camera/i], ['transitions', /转场|过渡|transition/i], ['physics', /物理|physics/i], ['pixel-art', /像素|pixel/i],
  ],
  audio: [
    ['music', /配乐|音乐|BGM|歌曲|soundtrack/i], ['voiceover', /配音|旁白|解说|narrat|voice ?over|TTS|ElevenLabs/i], ['sfx', /音效|sound effect|SFX/i],
  ],
  text: [
    ['captions', /字幕|caption|subtitle/i], ['on-screen-type', /文字|标题|文案|title|text/i],
  ],
  visualStyle: [
    ['minimal', /极简|简洁|minimal/i], ['futuristic', /未来|科幻|赛博|futur|sci-fi|cyber/i], ['cinematic', /电影|影院|cinematic|史诗/i],
    ['retro', /复古|怀旧|retro|vintage/i], ['hand-drawn', /手绘|涂鸦|hand-drawn/i], ['playful', /可爱|卡通|趣味|playful|cartoon/i],
    ['premium', /高端|质感|奢华|premium|luxury/i], ['dark', /暗色|黑色|dark/i],
  ],
  industries: [
    ['software', /SaaS|软件|应用|App|开发者|代码|编程|AI/i], ['startup', /创业|startup|融资/i], ['education', /教育|教学|课程|学习|科普/i],
    ['science', /物理|数学|化学|生物|天文|宇宙|科学/i], ['music', /音乐|歌曲|乐队/i], ['gaming', /游戏/i], ['consumer-brand', /品牌|产品|brand/i],
    ['finance', /金融|投资|股票|加密|crypto/i], ['health', /健康|医疗|健身/i], ['travel', /旅行|城市|旅游/i],
  ],
}

function evidence(text, re) {
  const m = text.match(re)
  if (!m) return null
  const i = Math.max(0, (m.index ?? 0) - 12)
  return text.slice(i, (m.index ?? 0) + m[0].length + 12).replace(/\s+/g, ' ').trim()
}

function tagsFor(text, rules) {
  const out = []
  for (const [tag, re] of rules) {
    const ev = evidence(text, re)
    if (ev) out.push({ tag, evidence: ev })
  }
  return out
}

function durationSec(text) {
  // Only lengths the text frames as the film's own duration. Production time
  // ("在 15 分钟内", "模型约 15 分钟", "不到 30 分钟") and beat lengths are rejected.
  const re = /(\d+(?:\.\d+)?)\s*(秒|分钟|分|s\b|sec\b|min\b)/gi
  let m
  while ((m = re.exec(text))) {
    const n = Number(m[1])
    const unit = m[2]
    const before = text.slice(Math.max(0, m.index - 8), m.index)
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 6)
    const isMin = /分|min/i.test(unit)
    if (/在|不到|用了?|花了?|耗时|模型|生成|渲染了?/.test(before.slice(-4))) continue
    if (isMin && !(/时长|长达|全长/.test(before) || /^(的|长)?(视频|短片|动画|影片|MV|广告|电影|纪录)/.test(after))) continue
    if (!isMin && n < 5) continue
    if (/[/.\d]$/.test(before)) continue
    return { sec: isMin ? n * 60 : n, evidence: (before + m[0] + after).replace(/\s+/g, ' ').trim() }
  }
  return null
}

const idFor = (entry) => new URL(entry.sourceUrl).pathname.split('/').filter(Boolean).pop()

const rows = cases.map((entry, index) => {
  const text = `${entry.title}\n${entry.summary}\n${entry.prompt}`
  const promptPublished = !/未公开/.test(entry.prompt)
  const t = Object.fromEntries(Object.entries(RULES).map(([k, rules]) => [k, tagsFor(text, rules)]))
  const dur = durationSec(text)
  return {
    caseId: idFor(entry),
    packItemId: `opus55-case-${String(index + 1).padStart(3, '0')}`,
    title: entry.title,
    summary: entry.summary,
    category: entry.category,
    categoryEn: CATEGORY_EN[entry.category] ?? 'other',
    sourceUrl: entry.sourceUrl,
    caseFile: `resources/opus55/cases/${idFor(entry)}.md`,
    author: entry.sourceAuthor ?? null,
    date: entry.sourcePublishedAt ?? null,
    publishedOn: /x\.com|twitter\.com/.test(entry.sourceUrl) ? 'X' : null,
    targetPlatform: null,
    promptPublished,
    prompt: promptPublished ? entry.prompt : null,
    durationSec: dur?.sec ?? null,
    durationEvidence: dur?.evidence ?? null,
    videoType: t.videoType,
    techniques: t.techniques,
    audio: t.audio,
    voiceover: t.audio.some((a) => a.tag === 'voiceover') ? 'stated' : null,
    textPatterns: t.text,
    visualStyle: t.visualStyle,
    industries: t.industries,
    // Not published in the catalogue for (almost) any case. Kept explicit so
    // nothing downstream mistakes absence for a measured value.
    shotCount: null,
    hookPattern: null,
    storyStructure: null,
    pacingProfile: null,
    ctaPattern: null,
    githubVideos: entry.githubVideos ?? [],
    attribution: `Case by @${entry.sourceAuthor ?? 'unknown'} (${entry.sourceUrl}), catalogued in awesome-opus-5-5-videos (MIT). Media and wording remain the author's.`,
    similar: [],
    skills: [],
  }
})

// Similar cases: Jaccard over the tag set plus same category.
const tagSet = (r) => new Set([`cat:${r.categoryEn}`, ...['videoType', 'techniques', 'audio', 'visualStyle', 'industries'].flatMap((k) => r[k].map((x) => `${k}:${x.tag}`))])
const sets = rows.map(tagSet)
rows.forEach((r, i) => {
  r.similar = rows
    .map((o, j) => {
      if (i === j) return null
      const a = sets[i], b = sets[j]
      const inter = [...a].filter((x) => b.has(x)).length
      const score = inter / (a.size + b.size - inter || 1)
      return score > 0 ? { caseId: o.caseId, score: Math.round(score * 100) / 100 } : null
    })
    .filter(Boolean)
    .sort((x, y) => y.score - x.score || x.caseId.localeCompare(y.caseId))
    .slice(0, 5)
})

// Skills ← evidence cases (tags any-of). A skill with no evidence says so.
const skills = skillsDef.skills.map((s) => {
  const ev = rows.filter((r) => s.matchTags.some((mt) => {
    const [k, v] = mt.split(':')
    return k === 'cat' ? r.categoryEn === v : Array.isArray(r[k]) && r[k].some((x) => x.tag === v)
  }))
  ev.forEach((r) => r.skills.push(s.id))
  return { ...s, evidenceCaseIds: ev.map((r) => r.caseId), evidenceCount: ev.length }
})

const out = {
  generatedBy: 'scripts/build-opus-index.mjs',
  source: 'https://github.com/chuspeeism/awesome-opus-5-5-videos',
  license: 'MIT (catalogue); media and quoted material retain their authors\' rights',
  policy: 'Retrieval and citation index. Not training data. Adapt structure to the user\'s own inputs; never copy a case verbatim or borrow its claims.',
  total: rows.length,
  coverage: {
    durationStated: rows.filter((r) => r.durationSec !== null).length,
    promptPublished: rows.filter((r) => r.promptPublished).length,
    voiceoverStated: rows.filter((r) => r.voiceover).length,
    withVideoType: rows.filter((r) => r.videoType.length).length,
  },
  skills,
  cases: rows,
}
writeFileSync(path.join(root, 'resources/opus55/data/index.json'), `${JSON.stringify(out)}\n`)
console.log(`opus index: ${rows.length} cases · coverage ${JSON.stringify(out.coverage)} · ${skills.length} skills (${skills.filter((s) => s.evidenceCount === 0).length} without catalogue evidence)`)
