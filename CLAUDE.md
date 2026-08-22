# Products Cost Check

> أداة داخلية لـ EcomModa — مراجعة وتصحيح تكلفة المنتجات على شوبيفاي.
> **Worker v2.5.0**

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
index.js        منطق الـ Worker (v2.5.0)
index.html      الواجهة — الملف الوحيد للأداة (صغيّرة — Pages حسّاس للحروف)
Index.html      صفحة تحويل بس (meta refresh لـ ./) — للـ bookmarks القديمة. مفيهاش أي منطق
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
| `bulk_update_cost` | POST | تحديث تكلفة (حد أقصى **100**) + لوج `cost_update` لكل صف |
| `get_logs` | GET | السجل (`limit` ≤ 2000 · `offset` · `employee` · `search`) |
| `get_logs_count` | GET | إجمالي عدد صفوف السجل |
| `get_logs_export` | GET | تصدير — حد ثابت 2000 صف |

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

**Shopify API version:** `2026-01` (ثابت `API_VERSION` في `index.js`)

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
- **حد الـ bulk = 100** (`MAX_BULK_UPDATE`). أكتر من كده بيرجع `400` — الواجهة لازم تقسّم دفعات.
- **`bulk_update_cost` جزئي بطبعه.** بيرجع `200` مع `results[]` + `updatedCount` + `failedCount`
  حتى لو كله فشل. الواجهة **لازم** تقرا `failedCount` — `ok: true` مش معناها نجاح.
- **الحد الأقصى للسجل 2000** (v2.5.0). الأداة بتجيب دفعة واحدة وتفلتر client-side.
  الكاب القديم (100) كان بيقطع الطلب حتى لو الـ HTML طلب 2000.
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
