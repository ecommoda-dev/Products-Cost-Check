// ══════════════════════════════════════════════════════════════
// Products Cost Check — Worker
// EcomModa — v2.5.0
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════
const TOOL_NAME     = 'products_cost_check';   // tool value in D1 logs table
const API_VERSION   = '2026-01';
const MAX_BULK_UPDATE = 100;                   // safety cap per bulk_update_cost call

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

// ══════════════════════════════════════════════════════
// §SHARED — copy verbatim — never modify
// ══════════════════════════════════════════════════════
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

async function writeLog(db, entry) {
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
    entry.extra ? JSON.stringify(entry.extra) : null
  ).run();
}

async function getLogs(db, {
  tool     = null,
  employee = null,
  type     = null,
  search   = null,
  limit    = 100,
  offset   = 0,
} = {}) {
  let sql = "SELECT * FROM logs WHERE type NOT IN ('login','logout')";
  const b = [];

  if (tool)     { sql += ' AND tool = ?';     b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (type)     { sql += ' AND type = ?';     b.push(type); }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ? OR sku LIKE ? OR product_title LIKE ?)';
    b.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  // v2.5.0: الحد الأقصى رفع من 100 لـ 2000 — الأداة بقت بتجيب دفعة واحدة (حد أقصى 2000)
  // وتعمل كل الفلترة/الترتيب client-side عليها (راجع references/data-table-standard.md
  // §9). الكاب القديم (100) كان بيقطع الطلب برضه حتى لو الـ HTML طلب limit=2000.
  b.push(Math.min(limit, 2000), offset);

  return (await db.prepare(sql).bind(...b).all()).results;
}

async function getLogsCount(db, {
  tool     = null,
  employee = null,
  search   = null,
} = {}) {
  let sql = "SELECT COUNT(*) as total FROM logs WHERE type NOT IN ('login','logout')";
  const b = [];

  if (tool)     { sql += ' AND tool = ?';     b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ? OR sku LIKE ? OR product_title LIKE ?)';
    b.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const row = await db.prepare(sql).bind(...b).first();
  return row?.total ?? 0;
}

async function getLogsExport(db, {
  tool     = null,
  employee = null,
  search   = null,
} = {}) {
  let sql = "SELECT * FROM logs WHERE type NOT IN ('login','logout')";
  const b = [];

  if (tool)     { sql += ' AND tool = ?';     b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ? OR sku LIKE ? OR product_title LIKE ?)';
    b.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY timestamp DESC LIMIT 2000';

  return (await db.prepare(sql).bind(...b).all()).results;
}
// ══════════════════════════════════════════════════════
// END SHARED BLOCK
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════
async function getAccessToken(env) {
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
  if (!resp.ok) throw new Error(`OAuth failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.access_token) throw new Error('No access_token in response');
  return data.access_token;
}

async function shopifyGQL(env, token, query, variables = {}) {
  const resp = await fetch(
    `https://${env.SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  return resp.json();
}

// Throttle-aware wrapper — retries only on THROTTLED, fails fast on real errors
async function shopifyGQLWithRetry(env, token, query, variables = {}, maxRetries = 3) {
  for (let i = 0; i <= maxRetries; i++) {
    const data = await shopifyGQL(env, token, query, variables);
    const throttled = data?.errors?.some(e => e.extensions?.code === 'THROTTLED');

    if (!throttled) {
      if (data?.errors?.length) {
        throw new Error(data.errors.map(e => e.message).join('; '));
      }
      return data;
    }
    if (i === maxRetries) throw new Error('Shopify throttled — استُنفدت المحاولات');

    const restore = data.extensions?.cost?.throttleStatus?.restoreRate;
    const wait = restore
      ? Math.ceil(data.extensions.cost.throttleStatus.maximumAvailable / restore) * 1000
      : 2000 * (i + 1);
    await new Promise(r => setTimeout(r, wait));
  }
}

// ─── §SHOPIFY::fetchAndClassifyVariants ───
// Server-side filtered scan: only variants with inventory_quantity:>0 are pulled
// (verified filter — see shopify-graphql-helper skill / dashboard query-cost-guide).
// v2.0.0: returns ALL in-stock variants in one flat array — no more splitting
// into emptyCost/priceLtCost buckets. Each row gets a computed `costType`:
//   'empty' → cost is null/missing
//   'below' → price < cost
//   'above' → price >= cost (healthy — was previously hidden from the tool entirely)
// Fails the whole request on any page error — never returns a partial result.
// No caching — this always runs live against Shopify on every get_variants call.
// v2.1.0: also returns product.featuredImage (imageUrl/imageAlt) for the HTML's
// image column — no extra request, same query, same subrequest cost.
// v2.1.1: costType now treats cost === 0 as 'empty' too (see inline comment below) —
// a Shopify unitCost of exactly "0.00" is a real value (not null), so it was silently
// falling into 'above' and never showing up in the "empty cost" bucket/filter/count.
async function fetchAndClassifyVariants(env, token) {
  const locationGid = `gid://shopify/Location/${env.LOCATION_ID}`;
  const products = [];
  let cursor = null, prevCursor = undefined, hasNext = true, page = 0, scanned = 0;

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
              featuredImage { url altText }
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
    let result;
    try {
      result = await shopifyGQLWithRetry(env, token, QUERY, { cursor, locationId: locationGid });
    } catch (e) {
      const err = new Error(`فشل جلب الصفحة ${page} من المنتجات — ${e.message}`);
      err.step = `graphql_page_${page}`;
      throw err;
    }

    const conn = result?.data?.productVariants;
    if (!conn) throw new Error('Shopify لم يرجع بيانات المنتجات');
    if (cursor !== undefined && conn.pageInfo.endCursor === prevCursor) {
      throw new Error('Pagination stuck — الـ cursor لم يتقدم');
    }

    for (const { node } of conn.edges) {
      scanned++;
      const availEntry = node.inventoryItem?.inventoryLevel?.quantities?.find(q => q.name === 'available');
      const available   = availEntry ? availEntry.quantity : 0;
      if (available <= 0) continue; // extra guard — filter is store-wide, this checks the specific location

      const price   = parseFloat(node.price);
      const costRaw = node.inventoryItem?.unitCost?.amount;
      const cost    = (costRaw !== null && costRaw !== undefined) ? parseFloat(costRaw) : null;

      // cost === 0 معناها عملياً "مفيش تكلفة حقيقية متسجّلة" تماماً زي cost === null —
      // شوبيفاي بيرجّع unitCost.amount = "0.00" (قيمة رقمية حقيقية، مش null) لو حد سجّل صفر
      // صراحةً أو باستيراد بيانات قديم. من غير الاستثناء ده، الشرط price < cost (يعني price < 0)
      // مستحيل يتحقق، فالمنتج كان بيتصنّف 'above' غلط ومايظهرش تحت "تكلفة فاضية" أبداً.
      // (اتأكد السبب من الكود + تأكيد بصري من شوبيفاي — 20-08-2026)
      const costType = (cost === null || cost === 0) ? 'empty' : (price < cost ? 'below' : 'above');

      const row = {
        variantId:       node.legacyResourceId,
        inventoryItemId: node.inventoryItem?.id || null,
        productId:       node.product?.legacyResourceId || null,
        productTitle:    node.product?.title || '',
        productStatus:   node.product?.status || null, // ACTIVE · DRAFT · ARCHIVED
        imageUrl:        node.product?.featuredImage?.url || null,
        imageAlt:        node.product?.featuredImage?.altText || node.product?.title || '',
        variantTitle:    node.title || '',
        sku:             node.sku || '',
        available,
        price,
        cost,
        costType, // 'empty' | 'below' | 'above'
      };

      products.push(row);
    }

    prevCursor = cursor;
    cursor     = conn.pageInfo.endCursor;
    hasNext    = conn.pageInfo.hasNextPage;
  }

  return { products, scanned };
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

    // 2. WORKER_SECRET check — ALWAYS second
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: getCORS(request),
      });
    }

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {

      // ─── §AUTH ────────────────────────────────────────────
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
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);

        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401, request);

        await writeLog(env.DB, {
          tool:     TOOL_NAME,
          type:     'login',
          employee: username,
          notes:    `دخول: ${displayName}`,
        });
        return json({ ok: true, displayName }, 200, request);
      }

      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        if (username) {
          await writeLog(env.DB, {
            tool:     TOOL_NAME,
            type:     'logout',
            employee: username,
            notes:    `خروج: ${username.replace(/_/g, ' ')}`,
          });
        }
        return json({ ok: true }, 200, request);
      }

      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      // ─── §PRODUCTS ──────────────────────────────────────────
      // §PRODUCTS::get_variants
      // No caching — always scans Shopify live, every call.
      if (action === 'get_variants') {
        const token = await getAccessToken(env);
        let scan;
        try {
          scan = await fetchAndClassifyVariants(env, token);
        } catch (e) {
          return json({
            ok: false,
            error: e.message || 'فشل جلب بيانات المنتجات من شوبيفاي',
            step:  e.step || 'graphql',
          }, 502, request);
        }

        const lastUpdated = new Date().toISOString();
        const payload = {
          products: scan.products,
          scanned:  scan.scanned,
          lastUpdated,
        };

        return json({ ok: true, ...payload, source: 'shopify' }, 200, request);
      }

      // §PRODUCTS::bulk_update_cost
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

        const token = await getAccessToken(env);
        const results = [];

        for (const u of updates) {
          if (!u.inventoryItemId || u.newCost === undefined || u.newCost === null || u.newCost === '') {
            results.push({ sku: u.sku || null, variantId: u.variantId || null, ok: false, error: 'بيانات ناقصة' });
            continue;
          }
          const newCostNum = parseFloat(u.newCost);
          if (isNaN(newCostNum) || newCostNum < 0) {
            results.push({ sku: u.sku || null, variantId: u.variantId || null, ok: false, error: 'قيمة التكلفة غير صحيحة' });
            continue;
          }

          try {
            const mutation = `
              mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
                inventoryItemUpdate(id: $id, input: $input) {
                  inventoryItem { id unitCost { amount } }
                  userErrors { field message }
                }
              }`;
            // shopifyGQLWithRetry — retries automatically on THROTTLED errors and
            // throws with the real Shopify error message on any other top-level
            // GraphQL error, instead of silently falling through to a generic
            // "unexpected response" message (previous bug — see v1.0.0).
            const resp = await shopifyGQLWithRetry(env, token, mutation, {
              id:    u.inventoryItemId,
              input: { cost: newCostNum.toFixed(2) },
            });

            const uerr = resp?.data?.inventoryItemUpdate?.userErrors;
            if (uerr && uerr.length) {
              results.push({ sku: u.sku || null, variantId: u.variantId || null, ok: false, error: uerr.map(x => x.message).join('; ') });
              continue;
            }
            if (!resp?.data?.inventoryItemUpdate?.inventoryItem) {
              results.push({ sku: u.sku || null, variantId: u.variantId || null, ok: false, error: 'استجابة غير متوقعة من شوبيفاي (لا userErrors ولا inventoryItem)' });
              continue;
            }

            await writeLog(env.DB, {
              tool:         TOOL_NAME,
              type:         'cost_update',
              employee:     employee || null,
              sku:          u.sku || null,
              productTitle: u.productTitle || null,
              valueBefore:  (u.oldCost ?? null),
              valueAfter:   newCostNum,
              notes:        `تحديث التكلفة — Variant ID ${u.variantId || '—'}`,
              extra:        { variantId: u.variantId, productId: u.productId, inventoryItemId: u.inventoryItemId },
            });

            results.push({ sku: u.sku || null, variantId: u.variantId || null, ok: true });
          } catch (e) {
            // shopifyGQLWithRetry throws with the real Shopify error message
            // (e.g. "Throttled", or an actual GraphQL validation error) —
            // surface it as-is instead of a generic fallback.
            results.push({ sku: u.sku || null, variantId: u.variantId || null, ok: false, error: e.message });
          }
        }

        const updatedCount = results.filter(r => r.ok).length;
        const failedCount  = results.length - updatedCount;
        return json({ ok: true, results, updatedCount, failedCount }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      // ─── §LOG-ENDPOINTS ───────────────────────────────────
      if (action === 'get_logs') {
        const employee = url.searchParams.get('employee') || null;
        const search   = url.searchParams.get('search')   || null;
        const limit    = Math.min(parseInt(url.searchParams.get('limit')  || '100'), 2000);
        const offset   = Math.max(parseInt(url.searchParams.get('offset') || '0'),    0);
        const entries  = await getLogs(env.DB, { tool: TOOL_NAME, employee, search, limit, offset });
        return json({ ok: true, entries }, 200, request);
      }

      if (action === 'get_logs_count') {
        const employee = url.searchParams.get('employee') || null;
        const search   = url.searchParams.get('search')   || null;
        const total    = await getLogsCount(env.DB, { tool: TOOL_NAME, employee, search });
        return json({ ok: true, total }, 200, request);
      }

      if (action === 'get_logs_export') {
        const employee = url.searchParams.get('employee') || null;
        const search   = url.searchParams.get('search')   || null;
        const entries  = await getLogsExport(env.DB, { tool: TOOL_NAME, employee, search });
        return json({ ok: true, entries }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      return json({ ok: false, error: `Unknown action: ${action}` }, 400, request);

    } catch (e) {
      return json({ ok: false, error: e.message || 'خطأ غير متوقع', step: e.step || null }, 500, request);
    }
  }
};