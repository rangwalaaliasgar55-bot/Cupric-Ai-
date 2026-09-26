# TEMPLATE_SPEC.md
A template is a **pure generator** `(input: TemplateInput) => VideoDoc`:
```ts
TemplateInput { aspect, brand { name, primary, secondary, accent, logoText }, headline, subtitle, features[], cta, duration, style, theme }
```
* Built from story scene builders (HOOK, TITLE, PROBLEM, STATEMENT, PRODUCT, FEATURE, DEMO, COMPARISON, STATISTIC, TESTIMONIAL, PROCESS, RESULT, CTA, OUTRO, LOGO).
* Every scene follows HOOK → INFORMATION → VISUAL CHANGE → FOCUS → PAYOFF → CTA rhythm.
* Responsive: scene builders receive a `Layout` (w,h,isPortrait,isSquare, safe area, type scale) and place text/product in a row (landscape) or a stack (portrait).
* Output is ordinary editable JSON — after generation there is no difference between a template and a hand-built project.
* Exported `template.json` = VideoDoc + `meta { templateId, input }`; external assets referenced by URL.
