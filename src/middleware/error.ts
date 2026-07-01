import { NextFunction, Request, Response } from 'express';

/** Wraps async route handlers so thrown errors reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : 'Internal error';
  const status = (err as { status?: number })?.status ?? 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: message });
}
