<div dir="rtl" style="text-align: right;">

# Products Cost Check

![version](https://img.shields.io/badge/version-v1.1.0-blue)

أداة داخلية لـ EcomModa لفحص وتصحيح **تكلفة المنتجات** على شوبيفاي.

بتمسح كل الـ variants اللي مخزونها > 0، وبتصنّف كل واحد حسب علاقة السعر بالتكلفة
(تكلفة فاضية · بيع بخسارة · سليم)، وبتخلّي الموظف يصلّح التكلفة فرديًا أو دفعات —
والتعديل بيتكتب على شوبيفاي فورًا وبيتسجّل في D1.

## المعمارية — قطعتين

| القطعة | فين | الرابط |
|---|---|---|
| الواجهة (HTML) | GitHub Pages · `main` / root | `https://ecommoda-dev.github.io/Products-Cost-Check/` |
| المنطق (Worker) | Cloudflare Workers | `https://products-cost-check-worker.ecommoda-dev.workers.dev` |

**كل تعديل بينشر عن طريق `git push` على `main`** — Workers Builds بينشر الـ Worker،
و GitHub Pages بتنشر الواجهة. مفيش لصق في الداشبورد.

## الملفات

```
index.js        منطق الـ Worker (v2.6.0)
index.html      الواجهة
wrangler.toml   الاسم + bindings + vars
CLAUDE.md       قواعد الأداة الكاملة — اقراه قبل أي تعديل
```

⚠️ أداة كتابة — بتعدّل بيانات تكلفة حقيقية على شوبيفاي. الأسرار في Cloudflare بس، مش في الريبو.

آخر تحديث: 20-11-2026 — 13:33

</div>
