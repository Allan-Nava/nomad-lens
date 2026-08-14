// Periodic force (NOM-35) and parameterized dispatch (NOM-36): pure guards and
// the dispatch request model. NO 'vscode' import — the prompts, base64 encoding
// and confirmation live in the glue.

/** A job is periodic when its spec carries a `Periodic` block. */
export function isPeriodic(job: { Periodic?: unknown | null }): boolean {
  return job.Periodic != null;
}

/** A job is parameterized (dispatchable) when its spec carries `ParameterizedJob`. */
export function isParameterized(job: { ParameterizedJob?: unknown | null }): boolean {
  return job.ParameterizedJob != null;
}

export interface DispatchMeta {
  required: string[];
  optional: string[];
}

/** The meta keys a parameterized job accepts, from its spec. */
export function parameterizedMeta(job: {
  ParameterizedJob?: { MetaRequired?: string[] | null; MetaOptional?: string[] | null } | null;
}): DispatchMeta {
  const p = job.ParameterizedJob;
  return { required: p?.MetaRequired ?? [], optional: p?.MetaOptional ?? [] };
}

/** Required meta keys that are missing or empty in the supplied values. */
export function missingMeta(required: string[], meta: Record<string, string>): string[] {
  return required.filter((k) => !(k in meta) || meta[k] === '');
}

export interface DispatchBody {
  Meta?: Record<string, string>;
  Payload?: string;
}

/** Body for `POST /v1/job/:id/dispatch`. `payloadBase64` is encoded by the caller. */
export function dispatchBody(meta: Record<string, string>, payloadBase64?: string): DispatchBody {
  const body: DispatchBody = {};
  if (Object.keys(meta).length) body.Meta = meta;
  if (payloadBase64) body.Payload = payloadBase64;
  return body;
}
