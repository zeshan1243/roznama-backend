import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';

/**
 * Productivity resources (tasks, notes, events, planner blocks). Every row is
 * owned by the authenticated user; all queries are scoped by user_id.
 */
export const productivityRouter = Router();
productivityRouter.use(requireAuth);

const db = () => supabaseAdmin();

/** Pick only allowed fields from a request body. */
function pick(body: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (body?.[f] !== undefined) out[f] = body[f];
  return out;
}

interface CrudOpts {
  table: string;
  fields: string[];
  orderBy?: { column: string; ascending?: boolean };
}

/** Wire GET (list) / POST / PUT :id / DELETE :id for an owner-scoped table. */
function crud(path: string, opts: CrudOpts): void {
  const { table, fields, orderBy } = opts;

  productivityRouter.get(
    path,
    asyncHandler(async (req: AuthedRequest, res) => {
      let q = db().from(table).select('*').eq('user_id', req.userId!);
      if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending ?? true });
      const { data, error } = await q;
      if (error) return void res.status(400).json({ error: error.message });
      res.json(data);
    }),
  );

  productivityRouter.post(
    path,
    asyncHandler(async (req: AuthedRequest, res) => {
      const row = { ...pick(req.body ?? {}, fields), user_id: req.userId! };
      const { data, error } = await db().from(table).insert(row).select().single();
      if (error) return void res.status(400).json({ error: error.message });
      res.status(201).json(data);
    }),
  );

  productivityRouter.put(
    `${path}/:id`,
    asyncHandler(async (req: AuthedRequest, res) => {
      const patch = pick(req.body ?? {}, fields);
      const { data, error } = await db()
        .from(table)
        .update(patch)
        .eq('id', req.params.id)
        .eq('user_id', req.userId!)
        .select()
        .single();
      if (error) return void res.status(400).json({ error: error.message });
      res.json(data);
    }),
  );

  productivityRouter.delete(
    `${path}/:id`,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { error } = await db()
        .from(table)
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.userId!);
      if (error) return void res.status(400).json({ error: error.message });
      res.status(204).end();
    }),
  );
}

crud('/tasks', {
  table: 'tasks',
  fields: ['title', 'notes', 'due_date', 'priority', 'status', 'position'],
  orderBy: { column: 'position', ascending: true },
});

crud('/notes', {
  table: 'notes',
  fields: ['title', 'body', 'color', 'pinned'],
  orderBy: { column: 'updated_at', ascending: false },
});

crud('/events', {
  table: 'events',
  fields: ['title', 'description', 'start_at', 'end_at', 'all_day', 'color'],
  orderBy: { column: 'start_at', ascending: true },
});

crud('/planner', {
  table: 'planner_blocks',
  fields: ['day', 'start_min', 'end_min', 'title', 'task_id', 'color'],
  orderBy: { column: 'start_min', ascending: true },
});
