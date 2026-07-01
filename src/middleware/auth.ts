import { NextFunction, Request, Response } from 'express';
import { supabaseAnon } from '../lib/supabase.js';

export interface AuthedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

/**
 * Verifies the `Authorization: Bearer <supabase-access-token>` header and
 * attaches `userId` to the request. Rejects with 401 when missing/invalid.
 */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  try {
    const { data, error } = await supabaseAnon().auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    req.userId = data.user.id;
    req.userEmail = data.user.email ?? undefined;
    next();
  } catch (err) {
    next(err);
  }
}
