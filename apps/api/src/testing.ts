// Test helper: an in-memory stand-in for the Supabase query builder.
export type Row = Record<string, unknown>;

export class FakeQuery implements PromiseLike<{ data: unknown; count: number | null; error: null }> {
  private filters: { col: string; val: unknown }[] = [];
  private inFilters: { col: string; vals: unknown[] }[] = [];
  private nullFilters: string[] = [];
  private ranges: { col: string; op: 'lt' | 'gt'; val: string }[] = [];
  private take: number | null = null;
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Row | Row[] | null = null;
  private wantCount = false;
  private conflict: string | null = null;

  constructor(
    private table: Map<string, Row>,
    private keyOf: (row: Row) => string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (opts?.count) this.wantCount = true;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push({ col, val });
    return this;
  }

  is(col: string, val: null): this {
    if (val === null) this.nullFilters.push(col);
    else this.filters.push({ col, val });
    return this;
  }

  lt(col: string, val: string): this {
    this.ranges.push({ col, op: 'lt', val });
    return this;
  }

  gt(col: string, val: string): this {
    this.ranges.push({ col, op: 'gt', val });
    return this;
  }

  in(col: string, vals: unknown[]): this {
    this.inFilters.push({ col, vals });
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  private orderBy: { col: string; ascending: boolean } | null = null;

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { col, ascending: opts?.ascending ?? true };
    return this;
  }

  limit(n: number): this {
    this.take = n;
    return this;
  }

  insert(row: Row): this {
    this.op = 'insert';
    this.payload = row;
    return this;
  }

  upsert(row: Row, opts?: { onConflict?: string }): this {
    this.op = 'upsert';
    this.payload = row;
    this.conflict = opts?.onConflict ?? null;
    return this;
  }

  update(patch: Row): this {
    this.op = 'update';
    this.payload = patch;
    return this;
  }

  maybeSingle(): PromiseLike<{ data: unknown; count: number | null; error: null }> {
    return Promise.resolve(this.run(true));
  }

  single(): PromiseLike<{ data: unknown; count: number | null; error: null }> {
    return Promise.resolve(this.run(true));
  }

  then<TResult1 = { data: unknown; count: number | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; count: number | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run(false)).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return (
      this.filters.every((f) => row[f.col] === f.val) &&
      this.inFilters.every((f) => f.vals.includes(row[f.col])) &&
      this.nullFilters.every((c) => row[c] == null) &&
      this.ranges.every((r) => {
        const a = new Date(String(row[r.col])).getTime();
        const b = new Date(r.val).getTime();
        return r.op === 'lt' ? a < b : a > b;
      })
    );
  }

  private run(single: boolean): { data: unknown; count: number | null; error: null } {
    if (this.op === 'insert' || this.op === 'upsert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const written: Row[] = [];
      for (const item of rows) {
        const row = { ...item };
        if (row['id'] === undefined) row['id'] = crypto.randomUUID();
        const key = this.keyOf(row);
        const existing = this.table.get(key);
        if (this.op === 'insert' && existing && this.conflict === null) {
          return { data: null, count: null, error: null };
        }
        this.table.set(key, { ...(existing ?? {}), ...row });
        written.push(this.table.get(key) ?? row);
      }
      if (single) return { data: written[written.length - 1] ?? null, count: null, error: null };
      // Like the real client: an array insert always returns a list.
      if (Array.isArray(this.payload)) return { data: written, count: null, error: null };
      return { data: written.length === 1 ? (written[0] ?? null) : written, count: null, error: null };
    }
    if (this.op === 'update') {
      // Match first, like WHERE, then return the updated rows the way
      // RETURNING does — never re-filter on the new values.
      const matched = [...this.table.entries()].filter(([, row]) => this.matches(row));
      for (const [key, row] of matched) this.table.set(key, { ...row, ...(this.payload as Row) });
      const rows = matched.map(([, row]) => ({ ...row, ...(this.payload as Row) }));
      if (single) return { data: rows[0] ?? null, count: null, error: null };
      return { data: rows, count: null, error: null };
    }
    if (this.op === 'delete') {
      for (const [key, row] of this.table.entries()) {
        if (this.matches(row)) this.table.delete(key);
      }
      return { data: null, count: null, error: null };
    }
    let rows = [...this.table.values()].filter((r) => this.matches(r));
    if (this.orderBy) {
      const { col, ascending } = this.orderBy;
      rows = rows.sort((x, y) => {
        const xv = x[col] as number | string;
        const yv = y[col] as number | string;
        return (xv < yv ? -1 : xv > yv ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    if (this.take != null) rows = rows.slice(0, this.take);
    if (this.wantCount) return { data: null, count: rows.length, error: null };
    if (single) return { data: rows[0] ?? null, count: null, error: null };
    return { data: rows, count: null, error: null };
  }
}

