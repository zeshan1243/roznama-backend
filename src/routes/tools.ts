import { Router, Response } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';

/**
 * The account-owned "My Life" tools. Each tool has its own table
 * (`public.tool_<name>`) and its own REST endpoints under `/api/<name>` (e.g.
 * `/api/todos`, `/api/expenses`). Records store their full item as `data` jsonb,
 * keyed by the client-generated `id`. Every route requires auth; user_id is
 * always taken from the verified token, never the client, so a user can only
 * ever touch their own rows.
 */
export const toolsRouter = Router();
toolsRouter.use(requireAuth);

const db = () => supabaseAdmin();

function fail(res: Response, error: { message: string } | null): boolean {
  if (error) {
    res.status(400).json({ error: error.message });
    return true;
  }
  return false;
}

/**
 * Wire CRUD for a list-of-records tool: GET (list), POST (create),
 * PUT /:id (create-or-update), DELETE /:id. Each record is a JSON object that
 * carries its own `id`.
 */
function crud(name: string): void {
  const table = `tool_${name}`;

  toolsRouter.get(
    `/${name}`,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { data, error } = await db()
        .from(table)
        .select('data')
        .eq('user_id', req.userId!)
        .order('updated_at', { ascending: true });
      if (fail(res, error)) return;
      res.json((data ?? []).map((r) => r.data));
    }),
  );

  toolsRouter.post(
    `/${name}`,
    asyncHandler(async (req: AuthedRequest, res) => {
      const item = req.body ?? {};
      const id = item.id;
      if (!id) return void res.status(400).json({ error: 'Missing "id"' });
      const { error } = await db()
        .from(table)
        .insert({ user_id: req.userId!, id, data: item });
      if (fail(res, error)) return;
      res.status(201).end();
    }),
  );

  toolsRouter.put(
    `/${name}/:id`,
    asyncHandler(async (req: AuthedRequest, res) => {
      const item = req.body ?? {};
      const { error } = await db()
        .from(table)
        .upsert({
          user_id: req.userId!,
          id: req.params.id,
          data: item,
          updated_at: new Date().toISOString(),
        });
      if (fail(res, error)) return;
      res.status(204).end();
    }),
  );

  toolsRouter.delete(
    `/${name}/:id`,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { error } = await db()
        .from(table)
        .delete()
        .eq('user_id', req.userId!)
        .eq('id', req.params.id);
      if (fail(res, error)) return;
      res.status(204).end();
    }),
  );
}

/**
 * Wire a singleton tool (one row per user): GET (object or null) + PUT (upsert).
 */
function singleton(name: string): void {
  const table = `tool_${name}`;

  toolsRouter.get(
    `/${name}`,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { data, error } = await db()
        .from(table)
        .select('data')
        .eq('user_id', req.userId!)
        .maybeSingle();
      if (fail(res, error)) return;
      res.json(data?.data ?? null);
    }),
  );

  toolsRouter.put(
    `/${name}`,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { error } = await db()
        .from(table)
        .upsert({
          user_id: req.userId!,
          data: req.body ?? {},
          updated_at: new Date().toISOString(),
        });
      if (fail(res, error)) return;
      res.status(204).end();
    }),
  );
}

// List tools (one row per record).
for (const name of [
  'todos', 'notes', 'reminders', 'grocery', 'grocery_lists', 'occasions',
  'recipes', 'alarms', 'learning', 'documents', 'games', 'habits', 'expenses',
  'medications', 'udhaar', 'installments', 'committee',
]) {
  crud(name);
}

// Singleton tools (one row per user).
for (const name of ['streak', 'water', 'baby_budget']) {
  singleton(name);
}
