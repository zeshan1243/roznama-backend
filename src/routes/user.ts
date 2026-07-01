import { Router, Response } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const userRouter = Router();
userRouter.use(requireAuth);

const db = () => supabaseAdmin();

function fail(res: Response, error: { message: string } | null): boolean {
  if (error) {
    res.status(400).json({ error: error.message });
    return true;
  }
  return false;
}

/* ------------------------- Profile / settings ------------------------- */
// One row per user; created on first read (upsert with defaults).
userRouter.get(
  '/profile',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await db()
      .from('profiles')
      .select('*')
      .eq('id', req.userId!)
      .maybeSingle();
    if (fail(res, error)) return;
    if (!data) {
      const { data: created, error: e2 } = await db()
        .from('profiles')
        .insert({ id: req.userId!, email: req.userEmail })
        .select()
        .single();
      if (fail(res, e2)) return;
      res.json(created);
      return;
    }
    res.json(data);
  }),
);

userRouter.put(
  '/profile',
  asyncHandler(async (req: AuthedRequest, res) => {
    const patch = req.body ?? {};
    delete patch.id;
    const { data, error } = await db()
      .from('profiles')
      .upsert({ id: req.userId!, email: req.userEmail, ...patch })
      .select()
      .single();
    if (fail(res, error)) return;
    res.json(data);
  }),
);

/* ------------------------------- Bills -------------------------------- */
userRouter.get(
  '/bills',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await db()
      .from('bills')
      .select('*')
      .eq('user_id', req.userId!)
      .order('due_day', { ascending: true });
    if (fail(res, error)) return;
    res.json(data);
  }),
);
userRouter.post(
  '/bills',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { name, due_day, amount, notify_hour, notify_minute } = req.body ?? {};
    const { data, error } = await db()
      .from('bills')
      .insert({ user_id: req.userId!, name, due_day, amount, notify_hour, notify_minute })
      .select()
      .single();
    if (fail(res, error)) return;
    res.status(201).json(data);
  }),
);
userRouter.put(
  '/bills/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const patch = { ...req.body };
    delete patch.id;
    delete patch.user_id;
    const { data, error } = await db()
      .from('bills')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.userId!)
      .select()
      .single();
    if (fail(res, error)) return;
    res.json(data);
  }),
);
userRouter.delete(
  '/bills/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { error } = await db()
      .from('bills')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId!);
    if (fail(res, error)) return;
    res.status(204).end();
  }),
);

/* --------------------------- Zakat records ---------------------------- */
userRouter.get(
  '/zakat',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await db()
      .from('zakat_records')
      .select('*')
      .eq('user_id', req.userId!)
      .order('saved_at', { ascending: false })
      .limit(24);
    if (fail(res, error)) return;
    res.json(data);
  }),
);
userRouter.post(
  '/zakat',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body ?? {};
    const { data, error } = await db()
      .from('zakat_records')
      .insert({
        user_id: req.userId!,
        saved_at: body.saved_at ?? new Date().toISOString(),
        total_assets_pkr: body.total_assets_pkr,
        total_liabilities_pkr: body.total_liabilities_pkr,
        nisab_pkr: body.nisab_pkr,
        zakat_payable_pkr: body.zakat_payable_pkr,
        breakdown: body.breakdown ?? null,
      })
      .select()
      .single();
    if (fail(res, error)) return;
    res.status(201).json(data);
  }),
);
userRouter.delete(
  '/zakat/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { error } = await db()
      .from('zakat_records')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId!);
    if (fail(res, error)) return;
    res.status(204).end();
  }),
);

/* ------------------------------ Tasbih -------------------------------- */
userRouter.get(
  '/tasbih',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await db()
      .from('tasbih_state')
      .select('*')
      .eq('user_id', req.userId!)
      .maybeSingle();
    if (fail(res, error)) return;
    res.json(data ?? { user_id: req.userId, lifetime_count: 0, loops: 0, target: 33 });
  }),
);
userRouter.put(
  '/tasbih',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { lifetime_count, loops, target } = req.body ?? {};
    const { data, error } = await db()
      .from('tasbih_state')
      .upsert({ user_id: req.userId!, lifetime_count, loops, target })
      .select()
      .single();
    if (fail(res, error)) return;
    res.json(data);
  }),
);

/* ----------------------------- Bookmarks ------------------------------ */
userRouter.get(
  '/bookmarks',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await db()
      .from('bookmarks')
      .select('*')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false });
    if (fail(res, error)) return;
    res.json(data);
  }),
);
userRouter.post(
  '/bookmarks',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { link, title, source, image_url, published_at } = req.body ?? {};
    const { data, error } = await db()
      .from('bookmarks')
      .upsert(
        { user_id: req.userId!, link, title, source, image_url, published_at },
        { onConflict: 'user_id,link' },
      )
      .select()
      .single();
    if (fail(res, error)) return;
    res.status(201).json(data);
  }),
);
userRouter.delete(
  '/bookmarks',
  asyncHandler(async (req: AuthedRequest, res) => {
    const link = req.query.link as string;
    const { error } = await db()
      .from('bookmarks')
      .delete()
      .eq('user_id', req.userId!)
      .eq('link', link);
    if (fail(res, error)) return;
    res.status(204).end();
  }),
);

/* --------------------------- News prefs ------------------------------- */
userRouter.get(
  '/news-prefs',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await db()
      .from('news_prefs')
      .select('*')
      .eq('user_id', req.userId!)
      .maybeSingle();
    if (fail(res, error)) return;
    res.json(data ?? { user_id: req.userId, subscribed_categories: [], disabled_sources: [] });
  }),
);
userRouter.put(
  '/news-prefs',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { subscribed_categories, disabled_sources } = req.body ?? {};
    const { data, error } = await db()
      .from('news_prefs')
      .upsert({ user_id: req.userId!, subscribed_categories, disabled_sources })
      .select()
      .single();
    if (fail(res, error)) return;
    res.json(data);
  }),
);

/* ---------------------- Loadshedding presets -------------------------- */
userRouter.get(
  '/ls-presets',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await db()
      .from('loadshedding_presets')
      .select('*')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: true });
    if (fail(res, error)) return;
    res.json(data);
  }),
);
userRouter.post(
  '/ls-presets',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { disco, area, label } = req.body ?? {};
    const { data, error } = await db()
      .from('loadshedding_presets')
      .insert({ user_id: req.userId!, disco, area, label })
      .select()
      .single();
    if (fail(res, error)) return;
    res.status(201).json(data);
  }),
);
userRouter.delete(
  '/ls-presets/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { error } = await db()
      .from('loadshedding_presets')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId!);
    if (fail(res, error)) return;
    res.status(204).end();
  }),
);

/* ----------------------------- FX alerts ------------------------------ */
userRouter.get(
  '/fx-alerts',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data, error } = await db()
      .from('fx_alerts')
      .select('*')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false });
    if (fail(res, error)) return;
    res.json(data);
  }),
);
userRouter.post(
  '/fx-alerts',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { pair, direction, threshold } = req.body ?? {};
    const { data, error } = await db()
      .from('fx_alerts')
      .insert({ user_id: req.userId!, pair, direction, threshold })
      .select()
      .single();
    if (fail(res, error)) return;
    res.status(201).json(data);
  }),
);
userRouter.delete(
  '/fx-alerts/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { error } = await db()
      .from('fx_alerts')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId!);
    if (fail(res, error)) return;
    res.status(204).end();
  }),
);
