// ══════════════════════════════════════════════════════════════
// Products Cost Check — Worker
// EcomModa — v2.6.0
// skills: worker-builder v4.2.0 · constants v6.0.1 — 20-11-2026
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════
const TOOL_NAME      = 'products_cost_check';   // tool value in D1 logs table (== log-values.json "tool")
const WORKER_VERSION = '2.6.0';
const API_VERSION    = '2026-10';              // ecommoda-constants §1 — القيمة الرسمية، ممنوع "latest"

// ─── سلسلة السقوف التلاتة (Step 5A ⑪) — ولا رقم منهم يتقال لوحده ───
// ① الواجهة    CHUNK = 20       ← وقت: ~0.5 ث/عنصر (ميوتيشن شوبيفاي + كتابة D1) × 20 ≈ 10 ث للنداء
// ② الـ Worker  MAX_BULK_UPDATE = 100 ← حارس لصق + سقف subrequests (Paid: 10k) — أكبر دفعة مقيسة: غير مقيسة بعد
// ③ شوبيفاي     get_variants بيسحب 250 variant/صفحة — مصدر الحالة: «كل variant مخزونه > 0» = **متراكمة**
//               بتكبر مع الكتالوج (مش عابرة)، فالسحب بيتقسّم صفحات والفشل كلّه أو ولا حاجة.
//               تكلفة الصفحة الواقعية بتتقرا من `queryCost` في رد get_variants وفي ?action=diag.
const MAX_BULK_UPDATE = 100;                   // safety cap per bulk_update_cost call (CLAUDE.md)
const MAX_VARIANT_PAGES = 400;                 // 400 × 250 = 100k variant — أي أكتر = فشل صريح مش نتيجة ناقصة

// ════════════════════════════════════════════════════════════
// §LOG-REG — الحارس الديناميكي لقيم اللوج (الطبقة ٥)
// ════════════════════════════════════════════════════════════
// قطعة الأداة دي بس من log-values.json اللي جنبها — بتتحدّث معاه في
// نفس الـ commit. ممنوع شحن السجل الكامل بتاع كل الأدوات هنا (Step 7-ب
// عن ليه: قيمة مزروعة في ٣٣ ملف = نفس مشكلة السكيل القديمة).
const LOG_REGISTRY = {
  products_cost_check: new Set(['login', 'logout', 'cost_update', 'cost_update_rejected']),
};

const isRegisteredLogValue = (tool, type) => !!LOG_REGISTRY[tool]?.has(type);

// UPSERT على (source_tool, tool, type) — صف واحد لكل قيمة، hits بيعدّ.
// الحدث الكامل مش بيضيع: الصف الأصلي موجود في logs وعليه _unregistered،
// والجدول ده فهرس مش سجل تاني — عشان كده dedupe مش صف لكل حدث.
const LOG_ALERT_SQL = `
  INSERT INTO log_value_alerts
    (source_tool, tool, type, first_seen, last_seen, hits,
     worker_version, sample_order_name, sample_employee, sample_notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_tool, tool, type) DO UPDATE SET
    last_seen         = excluded.last_seen,
    hits              = log_value_alerts.hits + excluded.hits,
    worker_version    = excluded.worker_version,
    sample_order_name = excluded.sample_order_name,
    sample_employee   = excluded.sample_employee,
    sample_notes      = excluded.sample_notes,
    status            = CASE WHEN log_value_alerts.status = 'ignored'
                             THEN 'ignored' ELSE 'open' END
`;

// فشل التنبيه ممنوع يأثر على أي حاجة — try/catch صامت. بتجمّع التكرار
// جوّه نفس الدفعة في صف واحد (hits) قبل ما تكتب.
async function noteUnregisteredLogValues(db, entries) {
  const byPair = new Map();
  for (const e of entries) {
    const key = `${e.tool}\u0000${e.type}`;
    const acc = byPair.get(key);
    if (acc) { acc.hits++; continue; }
    byPair.set(key, { entry: e, hits: 1 });
  }
  const now = new Date().toISOString();
  for (const { entry, hits } of byPair.values()) {
    try {
      await db.prepare(LOG_ALERT_SQL).bind(
        TOOL_NAME, entry.tool ?? '(بدون tool)', entry.type ?? '(بدون type)',
        now, now, hits, WORKER_VERSION ?? null,
        entry.orderName ?? null, entry.employee ?? null,
        entry.notes ? String(entry.notes).slice(0, 200) : null,
      ).run();
    } catch (e) { /* متعمّد: التنبيه فهرس، وفشله أهون من تعطيل الأداة */ }
  }
}

// ══════════════════════════════════════════════════════
// §CORS  (Option B — strict, write tool: modifies Shopify cost/inventory data)
// ══════════════════════════════════════════════════════
const ALLOWED_ORIGINS = [
  'https://ecommoda-dev.github.io',
];
function getCORS(request) {
  const origin  = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ══════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════
function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, request ? getCORS(request) : { 'Access-Control-Allow-Origin': '*' });
  return new Response(JSON.stringify(data), { status, headers });
}

// ─── §HELPERS::auth-apps — واجهة واحدة بس (Step 4) ───
// قايمة بيضاء مقفولة: appId جاي من العميل وجدول logs مشترك بين الستاك كله.
const AUTH_APPS = new Set([TOOL_NAME]);
function resolveAuthTool(appId) { return AUTH_APPS.has(appId) ? appId : TOOL_NAME; }

// ─── §HELPERS::assertEnv ───
// متغير ناقص لازم يوقف العملية برسالة باسمه. LOCATION_ID الناقص مثلاً بيتحوّل
// لـ "gid://shopify/Location/undefined" ويفشل بصمت (أو يرجّع صفر منتجات من غير أي خطأ).
const ENV_REQUIRED = {
  shopify: ['SHOP_DOMAIN', 'CLIENT_ID', 'CLIENT_SECRET'],
  stock:   ['LOCATION_ID'],
};
function assertEnv(env, ...groups) {
  const missing = [];
  for (const g of groups) {
    for (const key of (ENV_REQUIRED[g] || [])) {
      if (env[key] === undefined || env[key] === null || String(env[key]).trim() === '') missing.push(key);
    }
  }
  if (!env.DB) missing.push('DB (D1 binding)');
  if (missing.length) {
    const err = new Error(
      `متغيرات ناقصة في الـ Worker: ${missing.join('، ')} — ضِفها (vars في wrangler.toml / أسرار في الداشبورد) ` +
      `ثم Promote النسخة. (شغّل ?action=diag)`
    );
    err.step = 'env';
    throw err;
  }
}

// ══════════════════════════════════════════════════════
// §SHARED — copy verbatim — never modify
// ══════════════════════════════════════════════════════
// (نسخة references/shared-functions.md v1.3.0 بالحرف — الاستثناء الوحيد: حارس الطبقة ٥ جوّه writeLog، Step 7-ج)
// ═══════════════════════════════════════════════════════════════
// §SHARED — Auth & Logging Functions — EcomModa D1 Pattern v1.3.0
// Copy this block VERBATIM into every Worker — no modifications
// Place BEFORE the export default { } block
// ═══════════════════════════════════════════════════════════════

/**
 * Verify employee and return display_name if correct.
 * Updates last_login automatically.
 * Returns: string (display_name) or null if wrong PIN.
 * Throws: Error if account is suspended.
 */
async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?'
  ).bind(username, pin).first();

  if (!row) return null;

  if (!row.is_active) {
    throw new Error('الحساب موقوف — تواصل مع المسؤول');
  }

  db.prepare('UPDATE employees SET last_login = ? WHERE username = ?')
    .bind(new Date().toISOString(), username)
    .run()
    .catch(() => {});

  return row.display_name;
}

/**
 * Check if employee exists and has a PIN registered.
 * Used in Login screen to decide: normal login vs first-time PIN setup.
 */
async function checkEmployee(db, username) {
  const row = await db.prepare(
    'SELECT is_active, pin FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row) return { exists: false, hasPin: false, isActive: false };
  return {
    exists:   true,
    hasPin:   !!row.pin,
    isActive: !!row.is_active,
  };
}

/**
 * Register PIN for the first time.
 * Throws if: user not found / suspended / already has PIN.
 */
async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row)           throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin)        throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');

  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?')
    .bind(pin, username)
    .run();

  return true;
}

/**
 * Write a log entry to D1.
 * Only tool and type are required. All other fields optional (null if not provided).
 */
async function writeLog(db, entry) {
  const unregistered = !isRegisteredLogValue(entry.tool, entry.type);
  const extra = unregistered
    ? { ...(entry.extra || {}), _unregistered: true }
    : entry.extra;

  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    extra ? JSON.stringify(extra) : null
  ).run();

  if (unregistered) await noteUnregisteredLogValues(db, [entry]);  // بعد الكتابة، مش قبلها
}

const LOG_EXPORT_MAX = 2000;   // سقف التصدير — بيرجع للواجهة كـ `cap`

/**
 * بنّاء شرط الفلترة الموحّد للسجل — التلات دوال تحته بتستخدمه، فمفيش SQL
 * مكرر يتعتّق في واحدة منهم ويسيب التانية.
 *
 * كل الباراميترات **اختيارية**، والسلوك من غيرها **مطابق للنسخة القديمة
 * بالحرف** — الإضافة متوافقة رجوعيًا ١٠٠٪:
 *   employees[] / types[]  → قوايم. multi-select إلزامي في أي شاشة فيها جدول
 *                            (`ecommoda-html-builder` → data-table-standard.md
 *                            بند ٢١)، والسجل بقى جدول (بند ٢٦).
 *   employee / type        → قيمة واحدة — متسابة للتوافق مع واجهات قديمة.
 *   dateFrom / dateTo      → بيتقارنوا بـ substr(timestamp,1,10) — يعني **UTC**،
 *                            والعرض بتوقيت القاهرة (UTC+2 شتاءً / +3 صيفًا).
 *                            الفرق ممكن يحط عملية بعد ١٠ مساءً (٩ صيفًا) في يوم
 *                            UTC اللي بعده. مقبول لفلتر بالأيام — **بس مكتوب**،
 *                            عشان مايتكتشفش كباج بعدين.
 * login/logout مستثنيين في SQL دايمًا — مش client-side.
 */
function buildLogFilterSQL(select, {
  tool      = null,
  employee  = null, employees = null,
  type      = null, types     = null,
  search    = null,
  dateFrom  = null, dateTo    = null,
} = {}) {
  let sql = `${select} FROM logs WHERE type NOT IN ('login','logout')`;
  const b = [];

  const emps = Array.isArray(employees) && employees.length ? employees : (employee ? [employee] : []);
  const typs = Array.isArray(types)     && types.length     ? types     : (type     ? [type]     : []);

  if (tool) { sql += ' AND tool = ?'; b.push(tool); }
  if (emps.length) {
    sql += ` AND employee IN (${emps.map(() => '?').join(',')})`; b.push(...emps);
  }
  if (typs.length) {
    sql += ` AND type IN (${typs.map(() => '?').join(',')})`; b.push(...typs);
  }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }
  if (dateFrom) { sql += ' AND substr(timestamp, 1, 10) >= ?'; b.push(dateFrom); }
  if (dateTo)   { sql += ' AND substr(timestamp, 1, 10) <= ?'; b.push(dateTo); }

  return { sql, b };
}

/**
 * Fetch logs from D1 with server-side filtering + pagination.
 * Used for paginated display in the log tab (100 rows per page).
 * Max limit per page: 100 (enforced server-side).
 *
 * ⚠️ Do NOT use this for XLSX export — use getLogsExport() instead.
 */
async function getLogs(db, { limit = 100, offset = 0, sortBy, sortDir, ...filters } = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT *', filters);
  const q = sql + orderByClause(sortBy, sortDir) + ' LIMIT ? OFFSET ?';
  return (await db.prepare(q)
    .bind(...b, Math.min(limit, 100), Math.max(offset, 0)).all()).results;
}

// ⚠️ قائمة **مقفولة** — القيمة جاية من العميل وبتتلزق في نص SQL مباشرةً
//    (ORDER BY مابيقبلش bind). أي قيمة بره القايمة بترجع للافتراضي بدون خطأ.
// ⚠️ المفاتيح لازم تطابق `data-sort-key` في الواجهة **حرفيًا** — مفتاح مش في
//    القايمة بيرجع للافتراضي في صمت، فالعمود يبان إنه اترتّب وهو مااترتّبش.
const LOG_SORT_COLUMNS = {
  date: 'timestamp', time: 'timestamp', employee: 'employee', orderName: 'order_name',
  machine: `json_extract(extra, '$.machine')`, result: `json_extract(extra, '$.result')`,
};

function orderByClause(sortBy, sortDir) {
  const col = LOG_SORT_COLUMNS[String(sortBy || '')] || 'timestamp';
  const dir = String(sortDir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // 🔴 كاسر تعادل إلزامي: من غيره صفوف نفس القيمة بترتيب عشوائي بين الصفحات،
  //    والصف الواحد ممكن يظهر في صفحتين **أو مايظهرش خالص**.
  return col === 'timestamp' ? ` ORDER BY timestamp ${dir}`
                             : ` ORDER BY ${col} ${dir}, timestamp DESC`;
}

/**
 * Count total matching log rows.
 * Call in parallel with getLogs() (pagination UI) — and with getLogsExport()
 * (عشان الواجهة تعرف إن التصدير اتقص).
 */
async function getLogsCount(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT COUNT(*) as total', filters);
  const row = await db.prepare(sql).bind(...b).first();
  return row?.total ?? 0;
}

/**
 * Fetch all matching logs for XLSX export — up to LOG_EXPORT_MAX rows.
 * Never use getLogs() for export — it's limited to 100 rows per page.
 *
 * ⚠️ الدالة دي **بتقص في السكوت** بطبيعتها. المسؤولية اللي جنبها إلزامية:
 * الـ endpoint لازم يرجّع `cap` و`total` و`truncated` كمان — شوف تحت.
 */
async function getLogsExport(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT *', filters);
  // ⚠️ التصدير والعدّ **بيتجاهلوا الترتيب عن قصد** — العدّ مالوش ترتيب،
  //    والتصدير بياخد ترتيب السيرفر الافتراضي. تمرير sortBy/sortDir ليهم بيفتح
  //    باب اختلاف مصدر الباراميترات بين النداءات = تصدير مش مطابق للشاشة.
  const q = sql + ' ORDER BY timestamp DESC LIMIT ?';
  return (await db.prepare(q).bind(...b, LOG_EXPORT_MAX).all()).results;
}

/**
 * بيقرا فلاتر السجل من الـ query string — CSV للقوايم
 * (employees=ahmed,sara · types=cancel,cancel_failed).
 * الاسم المفرد لسه مقبول للتوافق الرجعي.
 */
function logParamsFrom(url, tool) {
  const csv = (k) => (url.searchParams.get(k) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const employees = csv('employees'), types = csv('types');
  return {
    tool,
    employees: employees.length ? employees : null,
    employee:  url.searchParams.get('employee') || null,
    types:     types.length ? types : null,
    type:      url.searchParams.get('type')     || null,
    search:    url.searchParams.get('search')   || null,
    dateFrom:  url.searchParams.get('dateFrom') || null,
    dateTo:    url.searchParams.get('dateTo')   || null,
  };
}

// ═══════════════════════════════════════════════════════════════
// END SHARED BLOCK
// ═══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// §LOGS-PCC — امتداد سجل الأداة دي (برّه كتلة §SHARED عمدًا — الكتلة بتفضل نسخة حرفية)
// ══════════════════════════════════════════════════════
// سجل الأداة دي صفوفه **مفيهاش order_name** — هويّتها SKU + اسم المنتج. buildLogFilterSQL
// بيبحث في order_name/notes بس، فالبحث بالـ SKU والعنوان بيتضاف هنا فوق ناتجه (من غير تعديل عليه).
// + فلتر زمني بحدود يوم القاهرة الحقيقية (tsFrom/tsTo — ISO UTC من cairoDayBoundsUTC في الواجهة)
//   بدل dateFrom/dateTo اللي بيقارنوا بتاريخ UTC (Step 6: فرق ٢-٣ ساعات).
function pccLogQuery(select, filters, url) {
  const { search, ...rest } = filters;
  const { sql, b } = buildLogFilterSQL(select, rest);
  let q = sql;
  const params = [...b];
  if (search) {
    q += ' AND (sku LIKE ? OR product_title LIKE ? OR notes LIKE ?)';
    const s = `%${search}%`; params.push(s, s, s);
  }
  const tsFrom = url.searchParams.get('tsFrom'), tsTo = url.searchParams.get('tsTo');
  if (tsFrom) { q += ' AND timestamp >= ?'; params.push(tsFrom); }
  if (tsTo)   { q += ' AND timestamp <= ?'; params.push(tsTo); }

  // فلاتر التكلفة قبل/بعد (قايمة قيم CSV أو نطاق) ونوع التحديث (up/down/same) — كلها server-side
  // عشان صف «النتائج» والتصدير والصفحات يتبنوا على نفس الفلتر (Log Filter Model v2).
  const csvNums = (k) => (url.searchParams.get(k) || '').split(',').map(s => s.trim()).filter(s => s !== '' && Number.isFinite(Number(s))).map(Number);
  const num = (k) => { const v = url.searchParams.get(k); return (v !== null && v !== '' && Number.isFinite(Number(v))) ? Number(v) : null; };
  for (const [col, listK, minK, maxK] of [['value_before', 'before', 'beforeMin', 'beforeMax'], ['value_after', 'after', 'afterMin', 'afterMax']]) {
    const list = csvNums(listK);
    if (list.length) { q += ` AND ${col} IN (${list.map(() => '?').join(',')})`; params.push(...list); }
    const mn = num(minK), mx = num(maxK);
    if (mn !== null) { q += ` AND ${col} >= ?`; params.push(mn); }
    if (mx !== null) { q += ` AND ${col} <= ?`; params.push(mx); }
  }
  const upd = (url.searchParams.get('updTypes') || '').split(',').filter(k => ['up', 'down', 'same'].includes(k));
  if (upd.length) {
    // up/down بس للصفوف اللي اتنفّذت فعلاً (success أو صف قديم من غير extra.result) — الفاشل/المرفوض/المتعمل خلاص
    // التكلفة ماتغيّرتش فيه، فبيتحسب «بدون تغيير» (نفس منطق computeUpdateType في الواجهة).
    const okRow = `COALESCE(json_extract(extra, '$.result'), 'success') = 'success'`;
    const conds = upd.map(k => k === 'up' ? `(${okRow} AND value_before IS NOT NULL AND value_after > value_before)`
                              : k === 'down' ? `(${okRow} AND value_before IS NOT NULL AND value_after < value_before)`
                              : `(NOT (${okRow}) OR value_before IS NULL OR value_after IS NULL OR value_after = value_before)`);
    q += ` AND (${conds.join(' OR ')})`;
  }
  return { sql: q, b: params };
}

// ⚠️ قايمة **مقفولة** — القيمة جاية من العميل وبتتلزق في SQL (ORDER BY مابيقبلش bind).
// المفاتيح لازم تطابق data-sort-key في الواجهة حرفيًا — مفتاح مش في القايمة = الافتراضي في صمت.
const PCC_LOG_SORT = {
  date: 'timestamp', time: 'timestamp', employee: 'employee', sku: 'sku',
  productTitle: 'product_title', valueBefore: 'value_before', valueAfter: 'value_after',
  result: `json_extract(extra, '$.result')`,
};
function pccOrderBy(sortBy, sortDir) {
  const col = PCC_LOG_SORT[String(sortBy || '')] || 'timestamp';
  const dir = String(sortDir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // كاسر تعادل إلزامي — من غيره صفوف نفس القيمة بترتيب عشوائي بين الصفحات
  return col === 'timestamp' ? ` ORDER BY timestamp ${dir}` : ` ORDER BY ${col} ${dir}, timestamp DESC`;
}

async function getPccLogs(db, url, filters, limit, offset, sortBy, sortDir) {
  const { sql, b } = pccLogQuery('SELECT *', filters, url);
  return (await db.prepare(sql + pccOrderBy(sortBy, sortDir) + ' LIMIT ? OFFSET ?')
    .bind(...b, limit, offset).all()).results;
}
async function getPccLogsCount(db, url, filters) {
  const { sql, b } = pccLogQuery('SELECT COUNT(*) as total', filters, url);
  return (await db.prepare(sql).bind(...b).first())?.total ?? 0;
}
async function getPccLogsExport(db, url, filters) {
  const { sql, b } = pccLogQuery('SELECT *', filters, url);
  return (await db.prepare(sql + ' ORDER BY timestamp DESC LIMIT ?').bind(...b, LOG_EXPORT_MAX).all()).results;
}

// كتابة سجل آمنة: فشل D1 ما يضيّعش نتيجة عملية حصلت فعلاً — بيرجّع { logged, logError } (Step 5A ⑦)
async function safeWriteLog(db, entry) {
  try { await writeLog(db, entry); return { logged: true, logError: null }; }
  catch (e) { return { logged: false, logError: e.message || String(e) }; }
}

// ══════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════
// ⚠️ التوكن مشترك بين كل Workers الستاك (نفس الـ Custom App) — ومعاه نفس
//    ميزانية تكلفة GraphQL. فشل OAuth عابر لازم يتعافى بدل ما يتحوّل لفشل كامل. → Step 5A ⑯
const OAUTH_MAX_ATTEMPTS = 3;

async function getAccessToken(env) {
  let lastErr = null;
  for (let attempt = 1; attempt <= OAUTH_MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(
        `https://${env.SHOP_DOMAIN}/admin/oauth/access_token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id:     env.CLIENT_ID,
            client_secret: env.CLIENT_SECRET,
            grant_type:    'client_credentials',
          }),
        }
      );
      if (!resp.ok) {
        const retriable = resp.status === 429 || resp.status >= 500;
        lastErr = new Error(`OAuth failed: ${resp.status}`);
        if (retriable && attempt < OAUTH_MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 700 * attempt)); continue; }
        throw lastErr;
      }
      const data = await resp.json();
      if (!data.access_token) throw new Error('No access_token in response');
      return data.access_token;
    } catch (e) {
      lastErr = e;
      if (attempt < OAUTH_MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 400 * attempt)); continue; }
      throw lastErr;
    }
  }
  throw lastErr || new Error('OAuth: فشل غير معروف');
}

// ─── §SHOPIFY::shopifyGQL — العقد الإلزامي (Step 5A ①)، نسخة المهارة بالحرف ───
// أي فشل بيترمي. مفيش رد بيعدّي وهو فاشل:
//   ① فشل شبكة  ② HTTP status  ③ رد مش JSON  ④ data.errors  ⑤ data فاضية
// ⚠️ ④ هو الخطير: لما ميوتيشن تترفض على مستوى الحقل (صلاحية ناقصة مثلاً)
// شوبيفاي بترد {"errors":[…],"data":null} — والـ userErrors بتبقى [] لأن مفيش
// payload أصلاً. كود بيفحص userErrors بس بيقرا ده **نجاح**.
// ⚠️ تكلفة الاستعلام — الرصيد المتبقي و«النداء ده كلّف كام» رقمان مختلفان. → Step 5A ⑮
let _lastThrottle = null, _lastQueryCost = null;

async function shopifyGQL(env, token, query, variables = {}, opName = 'shopify', costLog = null) {
  const MAX_ATTEMPTS = 3;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp, text;
    try {
      resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body:    JSON.stringify({ query, variables }),
      });
      text = await resp.text();
    } catch (e) {
      lastErr = new Error(`${opName}: فشل الاتصال بشوبيفاي — ${e.message}`);
      if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 400 * attempt)); continue; }
      throw lastErr;
    }

    if (!resp.ok) {
      const retriable = resp.status === 429 || resp.status >= 500;
      lastErr = new Error(`${opName}: شوبيفاي ردّت HTTP ${resp.status} — ${text.slice(0, 180)}`);
      if (retriable && attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 700 * attempt)); continue; }
      throw lastErr;
    }

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`${opName}: رد شوبيفاي مش JSON صالح — ${text.slice(0, 180)}`); }

    if (Array.isArray(data.errors) && data.errors.length) {
      const codes = data.errors.map(e => e?.extensions?.code).filter(Boolean);
      lastErr = new Error(
        `${opName}: ${data.errors.map(e => e.message).join(' | ')}` +
        (codes.length ? ` [${codes.join(',')}]` : '')
      );
      if (codes.includes('THROTTLED') && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 1200 * attempt)); continue;
      }
      throw lastErr;
    }

    if (!data.data) throw new Error(`${opName}: رد شوبيفاي بدون data — ${text.slice(0, 180)}`);

    if (data.extensions?.cost) {
      const c = data.extensions.cost;
      if (c.throttleStatus) _lastThrottle = c.throttleStatus;
      _lastQueryCost = { op: opName, requested: c.requestedQueryCost ?? null, actual: c.actualQueryCost ?? null };
      if (costLog) costLog.push({ op: opName, requested: c.requestedQueryCost ?? null, actual: c.actualQueryCost ?? null });
    }
    return data;
  }
  throw lastErr || new Error(`${opName}: فشل غير معروف`);
}

// ─── §SHOPIFY::fetchAndClassifyVariants ───
// Server-side filtered scan: only variants with inventory_quantity:>0 are pulled.
// بيرجّع كل الـ variants اللي مخزونها > 0 في array واحد، وكل صف بياخد `costType`:
//   'empty' → التكلفة null أو 0   · 'below' → price < cost   · 'above' → price >= cost
// الفشل كلّه أو ولا حاجة: أي صفحة تفشل = الطلب كله يفشل (step: graphql_page_N) — مفيش نتيجة جزئية أبدًا.
// مفيش كاش — بيمسح شوبيفاي لايف في كل نداء.
// ⚠️ مصدر الحالة (Step 5A ⑪ ⑤): «مخزون > 0» حالة **متراكمة** مع حجم الكتالوج — مش عابرة. لو
//    الصفحات عدّت MAX_VARIANT_PAGES الطلب بيفشل صراحةً (مش بيرجّع قايمة ناقصة).
// ⚠️ cost === 0 = 'empty': شوبيفاي بيرجّع unitCost.amount = "0.00" كقيمة رقمية حقيقية مش null، ومن غير
//    الاستثناء الشرط price < cost (يعني price < 0) مستحيل يتحقق والمنتج يختفي من فلتر "تكلفة فاضية" (v2.1.1).
async function fetchAndClassifyVariants(env, token, costLog) {
  const locationGid = `gid://shopify/Location/${env.LOCATION_ID}`;
  const products = [];
  let cursor = null, hasNext = true, page = 0, scanned = 0;

  const QUERY = `
    query($cursor: String, $locationId: ID!) {
      productVariants(first: 250, after: $cursor, query: "inventory_quantity:>0") {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            legacyResourceId
            sku
            title
            price
            product {
              legacyResourceId
              title
              status
              featuredMedia { preview { image { url altText } } }
            }
            inventoryItem {
              id
              legacyResourceId
              unitCost { amount }
              inventoryLevel(locationId: $locationId) {
                quantities(names: ["available"]) { name quantity }
              }
            }
          }
        }
      }
    }`;

  while (hasNext) {
    page++;
    if (page > MAX_VARIANT_PAGES) {
      const err = new Error(`عدد الصفحات تخطّى الحد (${MAX_VARIANT_PAGES}) — الطلب اتوقف بدل ما يرجّع قايمة ناقصة`);
      err.step = `graphql_page_${page}`;
      throw err;
    }
    let result;
    try {
      result = await shopifyGQL(env, token, QUERY, { cursor, locationId: locationGid }, `variants_page_${page}`, costLog);
    } catch (e) {
      const err = new Error(`فشل جلب الصفحة ${page} من المنتجات — ${e.message}`);
      err.step = `graphql_page_${page}`;
      throw err;
    }

    const conn = result?.data?.productVariants;
    if (!conn) {
      const err = new Error('Shopify لم يرجع بيانات المنتجات');
      err.step = `graphql_page_${page}`;
      throw err;
    }
    const nextCursor = conn.pageInfo.endCursor;
    if (conn.pageInfo.hasNextPage && (!nextCursor || nextCursor === cursor)) {
      const err = new Error('Pagination stuck — الـ cursor لم يتقدم');
      err.step = `graphql_page_${page}`;
      throw err;
    }

    for (const { node } of conn.edges) {
      scanned++;
      const availEntry = node.inventoryItem?.inventoryLevel?.quantities?.find(q => q.name === 'available');
      const available   = availEntry ? availEntry.quantity : 0;
      if (available <= 0) continue; // الفلتر على مستوى المتجر كله — ده بيفحص الموقع المحدد

      const price   = parseFloat(node.price);
      const costRaw = node.inventoryItem?.unitCost?.amount;
      const cost    = (costRaw !== null && costRaw !== undefined) ? parseFloat(costRaw) : null;
      const costType = (cost === null || cost === 0) ? 'empty' : (price < cost ? 'below' : 'above');

      products.push({
        variantId:       node.legacyResourceId,
        inventoryItemId: node.inventoryItem?.id || null,
        productId:       node.product?.legacyResourceId || null,
        productTitle:    node.product?.title || '',
        productStatus:   node.product?.status || null, // ACTIVE · DRAFT · ARCHIVED
        imageUrl:        node.product?.featuredMedia?.preview?.image?.url || null,   // 2026-10: featuredImage مُهمَل → featuredMedia
        imageAlt:        node.product?.featuredMedia?.preview?.image?.altText || node.product?.title || '',
        variantTitle:    node.title || '',
        sku:             node.sku || '',
        available,
        price,
        cost,
        costType, // 'empty' | 'below' | 'above'
      });
    }

    cursor  = nextCursor;
    hasNext = conn.pageInfo.hasNextPage;
  }

  return { products, scanned, pages: page };
}

// ─── §PRODUCTS::updateOneCost — ميوتيشن واحدة بالتلات فحوصات (Step 5A ②) ───
// inventoryItemUpdate مش من الـ١٥ ميوتيشن اللي محتاجة @idempotent على 2026-10 — إعادة المحاولة على THROTTLED آمنة.
const COST_MUTATION = `
  mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { id unitCost { amount } }
      userErrors { field message }
    }
  }`;

async function updateOneCost(env, token, inventoryItemId, newCostNum) {
  const data   = await shopifyGQL(env, token, COST_MUTATION,
    { id: inventoryItemId, input: { cost: newCostNum.toFixed(2) } }, 'inventoryItemUpdate');   // ① top-level
  const result = data.data?.inventoryItemUpdate;
  const errs   = result?.userErrors || [];
  if (errs.length) throw new Error('inventoryItemUpdate: ' + errs.map(e => e.message).join(' | '));   // ②
  if (!result?.inventoryItem) throw new Error('inventoryItemUpdate: شوبيفاي ما أكدتش العملية');       // ③ payload
  // دليل إضافي (Rule 6): التكلفة اللي شوبيفاي رجّعتها لازم تساوي اللي طلبناها — مش بس «رجّعت inventoryItem»
  const echoed = parseFloat(result.inventoryItem.unitCost?.amount);
  if (!Number.isFinite(echoed) || Math.abs(echoed - newCostNum) > 0.005) {
    throw new Error(`inventoryItemUpdate: شوبيفاي رجّعت تكلفة مختلفة (${result.inventoryItem.unitCost?.amount ?? '—'}) عن المطلوبة (${newCostNum.toFixed(2)})`);
  }
  return echoed;
}

// ══════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    // 1. CORS Preflight — ALWAYS first
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCORS(request) });
    }

    // 2. حارس السر الغايب — قبل فحص الـ auth (Step 8). من غيره WORKER_SECRET الناقص
    //    بيخلّي القالب ينتج «Bearer undefined» وأي طلب بالهيدر ده يعدّي.
    if (typeof env.WORKER_SECRET !== 'string' || !env.WORKER_SECRET.trim()) {
      return json({ ok: false, error: 'WORKER_SECRET غير مضبوط على الـ Worker', step: 'env' }, 500, request);
    }

    // 3. WORKER_SECRET check
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: getCORS(request),
      });
    }

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {

      // ─── §AUTH ────────────────────────────────────────────────────
      if (action === 'check_employee') {
        const username = url.searchParams.get('username');
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);
        const result = await checkEmployee(env.DB, username);
        return json({ ok: true, ...result }, 200, request);
      }

      if (action === 'register_pin') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        await registerPin(env.DB, username, pin);
        return json({ ok: true }, 200, request);
      }

      if (action === 'verify_employee') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin, appId } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);

        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401, request);

        // الدخول نفسه نجح — فشل D1 بعد كده = logged:false مش 500 (Step 5A ⑦)
        let logged = true;
        try {
          await writeLog(env.DB, {
            tool:     resolveAuthTool(appId),
            type:     'login',
            employee: username,
            notes:    `دخول: ${displayName}`,
          });
        } catch (e) {
          logged = false;
        }
        return json({ ok: true, displayName, logged }, 200, request);
      }

      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        const appId    = url.searchParams.get('appId');
        let logged = true;
        if (username) {
          try {
            await writeLog(env.DB, {
              tool:     resolveAuthTool(appId),
              type:     'logout',
              employee: username,
              notes:    `خروج: ${username.replace(/_/g, ' ')}`,
            });
          } catch (e) {
            logged = false;
          }
        }
        return json({ ok: true, logged }, 200, request);
      }

      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results }, 200, request);
      }
      // ──────────────────────────────────────────────────────────────

      // ─── §DIAG — فحص ذاتي بدون أي كتابة (Step 5A ⑨) ───────────────
      // ممنوع يرجّع قيمة أي سر — أسماء الـ bindings وأطوال القيم بس.
      if (action === 'get_config') {
        return json({ ok: true, version: WORKER_VERSION, tool: TOOL_NAME, apiVersion: API_VERSION }, 200, request);
      }

      if (action === 'diag') {
        const checks = [];
        const add = (ok, label, detail) => checks.push({ ok: !!ok, label, detail: detail ?? '' });

        // الأسماء والأطوال — بيكشف المسافة المخفية في اسم المتغير
        const keys = Object.keys(env);
        const required = ['WORKER_SECRET', 'CLIENT_ID', 'CLIENT_SECRET', 'SHOP_DOMAIN', 'LOCATION_ID', 'DB'];
        const missing  = required.filter(k => !keys.includes(k) || (typeof env[k] === 'string' && !env[k].trim()));
        const oddKeys  = keys.filter(k => k !== k.trim());
        add(!missing.length && !oddKeys.length, 'المتغيرات والأسرار',
          (missing.length ? `ناقص: ${missing.join('، ')} · ` : '') +
          (oddKeys.length ? `اسم فيه مسافة مخفية: ${oddKeys.map(k => JSON.stringify(k)).join('، ')} · ` : '') +
          keys.map(k => `${k}${typeof env[k] === 'string' ? `(${env[k].length})` : ''}`).join(' · '));

        // الـ Origin
        const origin = request.headers.get('Origin') || '';
        add(!origin || ALLOWED_ORIGINS.includes(origin), 'الـ Origin',
          origin ? (ALLOWED_ORIGINS.includes(origin) ? origin : `${origin} — مش في ALLOWED_ORIGINS`) : 'بدون Origin (نداء مباشر)');

        // D1
        try { await env.DB.prepare('SELECT 1').first(); add(true, 'D1 (DB)', 'متصل'); }
        catch (e) { add(false, 'D1 (DB)', e.message); }

        // Shopify: OAuth + الصلاحيات + الموقع + التكلفة
        let token = null;
        try { assertEnv(env, 'shopify', 'stock'); token = await getAccessToken(env); add(true, 'OAuth شوبيفاي', 'تم الحصول على توكن'); }
        catch (e) { add(false, 'OAuth شوبيفاي', e.message); }

        if (token) {
          try {
            const q = await shopifyGQL(env, token,
              `query($loc: ID!) { currentAppInstallation { accessScopes { handle } } location(id: $loc) { id name isActive } }`,
              { loc: `gid://shopify/Location/${env.LOCATION_ID}` }, 'diag');
            const scopes = (q.data?.currentAppInstallation?.accessScopes || []).map(s => s.handle);
            const need   = ['read_products', 'read_inventory', 'write_inventory'];
            const lacks  = need.filter(s => !scopes.includes(s));
            // read_all_orders: معلومة بس — الأداة دي مابتقراش أوردرات، لكن غيابها بيخلّي أي أداة تانية بتقرا أوردر أقدم من ٦٠ يوم
            // تشوف «غير موجود» بدل خطأ صلاحية (shopify-graphql-helper §3.2) — فبتظهر هنا للتشخيص.
            add(true, 'read_all_orders (معلومة — مش مطلوبة للأداة دي)', scopes.includes('read_all_orders') ? 'موجودة' : 'غير موجودة');
            add(!lacks.length, 'صلاحيات التطبيق', lacks.length ? `ناقص: ${lacks.join('، ')}` : `${scopes.length} صلاحية (المطلوبة موجودة)`);
            const loc = q.data?.location;
            add(!!loc, 'LOCATION_ID', loc ? `${loc.name}${loc.isActive ? '' : ' — ⚠️ الموقع غير نشط'}` : 'LOCATION_ID مش بيتحل لموقع حقيقي');
          } catch (e) { add(false, 'صلاحيات التطبيق / الموقع', e.message); }

          // البندين منفصلين (⑮): الرصيد المتبقي ≠ تكلفة آخر نداء
          if (_lastThrottle) {
            add(true, 'throttleStatus (الرصيد المتبقي)',
              `${_lastThrottle.currentlyAvailable} من ${_lastThrottle.maximumAvailable} · استرجاع ${_lastThrottle.restoreRate}/ث`);
          }
          if (_lastQueryCost) {
            add(true, 'actualQueryCost (تكلفة آخر نداء)',
              `${_lastQueryCost.op}: ${_lastQueryCost.actual ?? '—'} (المطلوب ${_lastQueryCost.requested ?? '—'})`);
          }
        }
        return json({ ok: true, version: WORKER_VERSION, apiVersion: API_VERSION, checks }, 200, request);
      }
      // ──────────────────────────────────────────────────────────────

      // ─── §PRODUCTS ──────────────────────────────────────────────────
      // §PRODUCTS::get_variants
      // No caching — always scans Shopify live, every call.
      if (action === 'get_variants') {
        assertEnv(env, 'shopify', 'stock');   // LOCATION_ID ناقص = صفر منتجات من غير أي خطأ — يوقف هنا
        const token   = await getAccessToken(env);
        const costLog = [];                   // ⑮ تفصيل التكلفة لكل صفحة — للقياس بس، الواجهة مابتعتمدش عليه
        let scan;
        try {
          scan = await fetchAndClassifyVariants(env, token, costLog);
        } catch (e) {
          return json({
            ok: false,
            error: e.message || 'فشل جلب بيانات المنتجات من شوبيفاي',
            step:  e.step || 'graphql',
          }, 502, request);
        }

        return json({
          ok: true,
          products:    scan.products,
          scanned:     scan.scanned,
          lastUpdated: new Date().toISOString(),
          source:      'shopify',
          queryCost: {
            pages:        scan.pages,
            totalActual:  costLog.reduce((s, c) => s + (c.actual || 0), 0),
            perPage:      costLog,
            throttle:     _lastThrottle,
          },
        }, 200, request);
      }

      // §PRODUCTS::bulk_update_cost
      // 📋 عقد الترتيب (Step 5A ⑬): `results[]` فيها نتيجة واحدة لكل عنصر في `updates`، **بنفس الترتيب**،
      //    في كل الفروع — الواجهة بتطابق بالفهرس. أي `continue` من غير push بيزحلق كل اللي بعده.
      // الحالات الأربع (⑭): success · error (اتبعتت واترفضت) · rejected (اتوقفت قبل أي نداء) · already (القيمة هي هي).
      if (action === 'bulk_update_cost') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { employee, updates } = await request.json().catch(() => ({}));

        if (!Array.isArray(updates) || updates.length === 0) {
          return json({ ok: false, error: 'لا توجد تحديثات مرسلة' }, 400, request);
        }
        if (updates.length > MAX_BULK_UPDATE) {
          return json({
            ok: false,
            error: `الحد الأقصى ${MAX_BULK_UPDATE} تحديث في المرة الواحدة — قسّم العملية على دفعات`,
          }, 400, request);
        }

        assertEnv(env, 'shopify');
        const token = await getAccessToken(env);
        const results = [];
        const seenItems = new Set();   // ⑫ حارس التكرار بالكيان (inventoryItemId) مش بالمدخل

        for (const u of updates) {
          const base = { sku: u.sku || null, variantId: u.variantId || null, inventoryItemId: u.inventoryItemId || null };
          const oldCostNum = (u.oldCost === null || u.oldCost === undefined || u.oldCost === '') ? null : parseFloat(u.oldCost);
          let status = 'success', error = null, shopifyCost = null;
          let newCostNum = NaN;

          // ── ما قبل أي نداء: التحقق كله هنا (⑩ ①) ──────────────────
          if (!u.inventoryItemId || u.newCost === undefined || u.newCost === null || u.newCost === '') {
            status = 'rejected'; error = 'بيانات ناقصة';
          } else {
            newCostNum = parseFloat(u.newCost);
            if (isNaN(newCostNum) || newCostNum < 0) { status = 'rejected'; error = 'قيمة التكلفة غير صحيحة'; }
            else if (seenItems.has(u.inventoryItemId)) { status = 'rejected'; error = 'اتنفّذ فعلاً في نفس الدفعة'; }
            else if (oldCostNum !== null && Number.isFinite(oldCostNum) && Math.abs(oldCostNum - newCostNum) < 0.005) {
              status = 'already'; error = null;   // التكلفة الحالية هي المطلوبة — مفيش حاجة كانت مطلوبة
            }
          }
          if (u.inventoryItemId) seenItems.add(u.inventoryItemId);

          // ── النداء ─────────────────────────────────────────────────
          if (status === 'success') {
            try { shopifyCost = await updateOneCost(env, token, u.inventoryItemId, newCostNum); }
            catch (e) { status = 'error'; error = e.message || 'فشل غير معروف'; }
          }

          // ── السجل: صف واحد لكل عنصر، يا cost_update يا cost_update_rejected (⑭) ──
          const attempted = status === 'success' || status === 'error';
          const { logged, logError } = await safeWriteLog(env.DB, {
            tool:         TOOL_NAME,
            type:         attempted ? 'cost_update' : 'cost_update_rejected',
            employee:     employee || null,
            sku:          u.sku || null,
            productTitle: u.productTitle || null,
            valueBefore:  Number.isFinite(oldCostNum) ? oldCostNum : null,
            valueAfter:   status === 'success' ? shopifyCost : (Number.isFinite(newCostNum) ? newCostNum : null),
            notes:        status === 'success' ? `تحديث التكلفة — Variant ID ${u.variantId || '—'}`
                        : status === 'already' ? `التكلفة مطابقة أصلاً — Variant ID ${u.variantId || '—'}`
                        : `${status === 'error' ? 'فشل تحديث التكلفة' : 'اترفض قبل التنفيذ'} — ${error}`,
            extra:        {
              result: status, stage: attempted ? 'write' : 'preflight',
              variantId: u.variantId || null, productId: u.productId || null, inventoryItemId: u.inventoryItemId || null,
              ...(error ? { error } : {}),
            },
          });

          results.push({
            ...base, status, ok: status === 'success', error, logged,
            ...(logError ? { logError } : {}),
          });
        }

        const count = (s) => results.filter(r => r.status === s).length;
        return json({
          ok: true, results,
          updatedCount: count('success'),
          failedCount:  count('error') + count('rejected'),
          alreadyCount: count('already'),
          loggedFailedCount: results.filter(r => !r.logged).length,
        }, 200, request);
      }
      // ──────────────────────────────────────────────────────────────

      // ─── §LOG-ENDPOINTS ───────────────────────────────────
      // الفلاتر المقبولة على التلاتة (نفس المجموعة): employees · types · search · tsFrom/tsTo (حدود يوم القاهرة)
      if (action === 'get_logs') {
        const p = logParamsFrom(url, TOOL_NAME);
        // parseInt('abc') → NaN → بيوصل لـ D1 كـ bind — الحراسة إلزامية
        const limitRaw  = parseInt(url.searchParams.get('limit')  || '100', 10);
        const offsetRaw = parseInt(url.searchParams.get('offset') || '0',   10);
        const limit  = Number.isFinite(limitRaw)  ? Math.min(Math.max(limitRaw, 1), 100) : 100;
        const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
        const entries = await getPccLogs(env.DB, url, p, limit, offset,
          url.searchParams.get('sortBy'), url.searchParams.get('sortDir'));
        return json({ ok: true, entries }, 200, request);
      }

      if (action === 'get_logs_count') {
        const total = await getPccLogsCount(env.DB, url, logParamsFrom(url, TOOL_NAME));
        return json({ ok: true, total }, 200, request);
      }

      // قيم التكلفة قبل/بعد المميّزة — بتبني قوائم فلتر الرقمي (القيم مش في الصفحة الحالية بس)
      if (action === 'get_log_values') {
        const rows = (await env.DB.prepare(
          `SELECT DISTINCT value_before AS v, 'before' AS k FROM logs WHERE tool = ? AND type = 'cost_update' AND value_before IS NOT NULL
           UNION SELECT DISTINCT value_after, 'after' FROM logs WHERE tool = ? AND type = 'cost_update' AND value_after IS NOT NULL
           ORDER BY v LIMIT 4000`
        ).bind(TOOL_NAME, TOOL_NAME).all()).results;
        return json({ ok: true,
          before: rows.filter(r => r.k === 'before').map(r => r.v),
          after:  rows.filter(r => r.k === 'after').map(r => r.v) }, 200, request);
      }

      // 🔴 عقد التصدير: الصفوف **والحقيقة** مع بعض — cap/total/truncated (الواجهة بتعرض بانر لو الملف اتقص)
      if (action === 'get_logs_export') {
        const p = logParamsFrom(url, TOOL_NAME);
        const [entries, total] = await Promise.all([
          getPccLogsExport(env.DB, url, p),
          getPccLogsCount(env.DB, url, p),    // نفس الفلاتر بالظبط
        ]);
        return json({ ok: true, entries, cap: LOG_EXPORT_MAX, total, truncated: total > LOG_EXPORT_MAX }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      return json({ ok: false, error: `Unknown action: ${action}` }, 400, request);

    } catch (e) {
      return json({ ok: false, error: e.message || 'خطأ غير متوقع', step: e.step || null }, 500, request);
    }
  }
};
