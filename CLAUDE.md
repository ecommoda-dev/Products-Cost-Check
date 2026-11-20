<div dir="rtl" style="text-align: right;">

# Products Cost Check

![version](https://img.shields.io/badge/version-v1.1.0-blue)

> أداة داخلية لـ EcomModa — مراجعة وتصحيح تكلفة المنتجات على شوبيفاي.
> **Worker v2.6.0 · Frontend v2.6.0**

---

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v4.2.0 |
| ecommoda-html-builder | v9.1.1 |
| ecommoda-constants | v6.0.1 |

آخر مطابقة: 20-11-2026 · `index.js` v2.6.0 · `index.html` v2.6.0
🔴 معلّقة: — لا شيء
🟡 مؤجَّلة بقرار (مش كاسرة): ① فلاتر الجدول في رأس العمود (Standards #47 · وصفة `S47`) ② سحب عرض الأعمدة (#51) ③ قفل الهيدر عند السكرول (#33) — كلها إعادة تصميم لجدول الأداة وجدول السجل (فلاتر بقت في قسم فوق الجدول بمعيار قديم) ومخاطرتها أعلى من فايدتها في تسليم واحد؛ تتعمل في جلسة مخصّصة بعد تجربة الإصدار ده.

> `v1.0.0` = **قبل النظام**، مش شهادة مطابقة. → `ecommoda-skill-versioning`

---

## إيه الأداة دي

أداة للموظفين بتفحص **كل الـ variants اللي عندها مخزون > 0** في الفرع المحدّد،
وبتصنّف كل واحد حسب علاقة السعر بالتكلفة، وبتخلّي الموظف يصلّح التكلفة —
فردي أو دفعات — والتعديل بيتكتب على شوبيفاي فورًا وبيتسجّل في D1.

**التصنيف (`costType`) بيتحسب في الـ Worker:**

| القيمة | المعنى |
|---|---|
| `empty` | التكلفة `null` **أو** `0` — صفر بيتعامل كأنه مفيش تكلفة |
| `below` | `price < cost` — بيع بخسارة |
| `above` | `price >= cost` — سليم |

⚠️ **أداة كتابة** — بتعدّل بيانات تكلفة حقيقية على شوبيفاي. الـ CORS strict (قائمة origins مقفولة).

---

## المعمارية — قطعتين

| القطعة | فين | الرابط |
|---|---|---|
| الواجهة (HTML) | GitHub Pages · `main` / root | `https://ecommoda-dev.github.io/Products-Cost-Check/index.html` |
| المنطق (Worker) | Cloudflare | `https://products-cost-check-worker.ecommoda-dev.workers.dev` |

**كل تعديل بينشر عن طريق `git push` على `main`.** مفيش لصق في الداشبورد.

---

## الملفات

```
index.js        منطق الـ Worker (v2.6.0)
check-log-values.mjs   فحص قيم اللوج (`CHECK_VERSION = 'v3.2'`) — `node check-log-values.mjs` لازم يعدّي قبل أي تسليم
log-values.json        سجل قيم `type` للأداة — بيتحدّث في نفس الـ commit اللي بيضيف أي `writeLog`
index.html      الواجهة — الملف الوحيد للأداة (صغيّرة — Pages حسّاس للحروف)
(اتشالت Index.html — 23-09-2026، قرار أحمد. الرابط الوحيد: https://ecommoda-dev.github.io/Products-Cost-Check/)
wrangler.toml   الاسم + bindings + vars
README.md       وصف مختصر للأداة
```

ملفات النسخ القديمة (`1.2.1.html` · `2.0.html` · `2.1.0.html` · `2.1.1.html` · `2.1.2.html`)
**اتشالت** — كانت كلها صفحات لايف للعالم (§B3 في `ecommoda-deploy-runbook`).
محفوظة للأبد في تاريخ git على الـ commit `82707a7` (جدّ مباشر لـ `main`) — للاسترجاع:

```bash
git show 82707a7:<اسم الملف>        # مثال: git show 82707a7:2.1.2.html > /tmp/2.1.2.html
```

وأي نسخة جديدة = **git tag** مش ملف جديد.

---

## الـ Endpoints

كلهم على نفس الرابط بـ `?action=`، وكلهم ورا `Authorization: Bearer <WORKER_SECRET>`.

| `?action=` | Method | بيعمل إيه |
|---|---|---|
| `check_employee` | GET | هل الموظف موجود / نشط / عنده PIN |
| `register_pin` | POST | تسجيل PIN لأول مرة |
| `verify_employee` | POST | تسجيل دخول + لوج `login` |
| `log_logout` | GET | لوج `logout` |
| `get_employees` | GET | قائمة الموظفين النشطين |
| `get_variants` | GET | **مسح حي** لكل الـ variants اللي مخزونها > 0 + التصنيف |
| `bulk_update_cost` | POST | تحديث تكلفة (حد أقصى **100**، والواجهة بتبعت ٢٠) — نتيجة لكل صف `status` + لوج صف واحد لكل عنصر |
| `get_logs` | GET | السجل — صفحة (≤ **100**) · `offset` · `employees` · `updTypes` · `search` · `tsFrom/tsTo` · `before/after(Min/Max)` · `sortBy/sortDir` |
| `get_logs_count` | GET | العدّ المطابق لنفس الفلاتر |
| `get_logs_export` | GET | تصدير — سقف `LOG_EXPORT_MAX = 2000` + `{ cap, total, truncated }` |
| `get_log_values` | GET | قيم التكلفة قبل/بعد المميّزة (قوائم الفلتر) |
| `get_config` | GET | `{ version }` — حارس نسخة الواجهة |
| `diag` | GET | فحص ذاتي بدون كتابة: المتغيرات · D1 · OAuth · الصلاحيات · الموقع · `throttleStatus` و`actualQueryCost` (أسماء وأطوال بس، ولا سر) |

---

## الإعدادات

**الـ Bindings**

```
DB → ecommoda-dev-logs   (D1)
```

**الأسرار** (في Cloudflare — **مش** في الريبو)

```
WORKER_SECRET    قيمة فريدة للأداة دي
CLIENT_ID        تطبيق شوبيفاي المخصص → API credentials
CLIENT_SECRET    نفس التطبيق
```

**الـ Vars** (في `wrangler.toml`)

```
SHOP_DOMAIN = "6c7e1a-53.myshopify.com"   → getAccessToken() + shopifyGQL()
LOCATION_ID = "98849620290"               → gid://shopify/Location/${LOCATION_ID}
```

⚠️ **الاتنين إجباريين.** لو `LOCATION_ID` ناقص، الـ `inventoryLevel` بيرجع فاضي
وكل الـ variants بتتفلتر لـ `available = 0` والنتيجة بتبقى **صفر منتجات من غير أي خطأ**.

**قيمة `tool` في D1:** `products_cost_check` ← لازم تطابق `writeLog()` و`WHERE tool = ?` بالظبط

**Shopify API version:** `2026-10` (ثابت `API_VERSION` في `index.js` — القيمة الرسمية `ecommoda-constants` §1). ⚠️ `Product.featuredImage` مُهمَل على 2026-10 → الأداة بتستخدم `featuredMedia.preview.image`.

---

## قواعد لازمة

- ✅ الواجهة والـ API على دومينين مختلفين → **CORS إجباري**. الـ Worker لازم يرد على
  `OPTIONS` ويرجّع `Access-Control-Allow-Origin: https://ecommoda-dev.github.io`
  (بدون trailing slash). القائمة في `ALLOWED_ORIGINS` — أي origin جديد يتضاف هناك.
- ✅ ملف واحد بس اسمه `index.html`. **الإصدارات = git tags، مش أسماء ملفات.**
  أي `2.1.0.html` في الريبو = صفحة مفتوحة للعالم.
- ✅ بعد إضافة أو تعديل أي سر من الداشبورد: **Promote version** —
  وإلا كل النداءات هترجع `Unauthorized`.
- ✅ `name` في `wrangler.toml` = `products-cost-check-worker` **حرف بحرف** زي الداشبورد،
  وإلا بينشر Worker شبح جديد والأصلي بيتجمّد بصمت.
- ✅ الاختبار النهائي **من صفحة الواجهة**، مش من رابط الـ Worker.
- ❌ **الـ SHARED block في `index.js` (§SHARED → END SHARED BLOCK) بيتنسخ حرفيًا — متعدّلش فيه.**
- ❌ أي سر أو مفتاح في الريبو. الأسرار في Cloudflare بس.

---

## الأمور الخاصة بالأداة دي

- **مفيش كاش خالص.** `get_variants` بيمسح شوبيفاي **لايف** في كل نداء —
  pagination بـ 250/صفحة على فلتر `inventory_quantity:>0`. الطلب بيطول على المتاجر الكبيرة.
- **الفشل كلّه أو ولا حاجة.** أي صفحة تفشل → الطلب كله بيرجع `502` مع `step: graphql_page_N`.
  مفيش نتيجة جزئية أبدًا — عشان الموظف ما يصلّحش تكلفة على أساس قايمة ناقصة.
- **`cost === 0` = `empty` مش `above`.** شوبيفاي بيرجّع `unitCost.amount = "0.00"` كقيمة
  رقمية حقيقية مش `null`. من غير الاستثناء ده الشرط `price < 0` مستحيل يتحقق
  والمنتج كان بيختفي من فلتر "تكلفة فاضية" تمامًا. (v2.1.1 — اتأكد بصريًا من شوبيفاي)
- **سلسلة السقوف:** الواجهة `CHUNK = 20` (وقت) ← الـ Worker `MAX_BULK_UPDATE = 100` (حارس لصق، أكتر منه `400`) ← صفحات شوبيفاي 250/صفحة (`MAX_VARIANT_PAGES = 400` = فشل صريح مش قايمة ناقصة). مصدر الحالة «مخزون > 0» **متراكم** مع الكتالوج.
- **`bulk_update_cost` جزئي بطبعه.** بيرجع `200` مع `results[]` (بنفس ترتيب `updates` — الواجهة بتطابق بالفهرس)
  + `updatedCount` + `failedCount` + `alreadyCount` + `loggedFailedCount`. `ok: true` معناها «الطلب اتعالج» —
  النتيجة الفعلية في `results[].status`: `success` (شوبيفاي رجّعت نفس التكلفة المطلوبة) · `error` (اتبعتت واترفضت) ·
  `rejected` (اتوقفت قبل أي نداء: بيانات ناقصة/قيمة غلط/تكرار في الدفعة) · `already` (التكلفة هي هي — مفيش حاجة كانت مطلوبة، **مش فشل**).
- **لوج صف واحد لكل عنصر:** `cost_update` (`extra.result` = success/error، `stage: write`) أو `cost_update_rejected` (rejected/already، `stage: preflight`).
  أي استعلام خط أساس لازم يفلتر على `json_extract(extra,'$.result') = 'success'` — `type` لوحده بيقيس المحاولات.
- **سجل العمليات server-side بالكامل** (v2.6.0): فلاتر + ترتيب + صفحات (100) + عدّ. التصدير سقفه 2000 ويرجّع `truncated` والواجهة بتعرض بانر. الفلتر الزمني بحدود يوم القاهرة (`tsFrom/tsTo` من `cairoDayBoundsUTC`) مش تاريخ UTC.
- **امتداد السجل برّه الـ SHARED block:** سجل الأداة مفيهوش `order_name` (هويّته SKU + اسم المنتج)، فبحث/فلاتر/ترتيب الأداة في §LOGS-PCC (`pccLogQuery` فوق `buildLogFilterSQL` من غير تعديل عليه).
- **الخروج:** يدوي فوري بلا تأكيد، وتلقائي بعد 60 د عدم نشاط (Standards #52).
- **`WORKER_URL` constant في الواجهة** (مش حقل إعدادات) — `WORKER SECRET` وحده في `localStorage` (`pcc_worker_secret`).
- **`MIN_WORKER_VERSION = '2.6.0'`** في الواجهة (حد أدنى، مش تطابق). أي action/حقل جديد الواجهة بتقراه = ارفعه في نفس التسليم. مالهاش علاقة بـ `TOOL_VERSION`.
- **`getLogs` بيستبعد `login`/`logout`** — دول بيتسجّلوا بس ومش بيظهروا في السجل.
- **الأخطاء بالعربي.** رسايل الـ Worker موجّهة للموظف مباشرة — حافظ على ده في أي كود جديد.

---

## اقرا الأول

| قبل ما تعمل | اقرا |
|---|---|
| أي شغل نشر أو ريبو | `ecommoda-deploy-runbook` |
| منطق Worker | `ecommoda-worker-builder` |
| واجهة HTML | `ecommoda-html-builder` |
| نداء Shopify | `shopify-graphql-helper` |
| أي عطل | `ecommoda-debugger` |

آخر تحديث: 20-11-2026 — 13:33

</div>
