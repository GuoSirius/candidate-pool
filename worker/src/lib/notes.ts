import type { GroupDetail, GroupMember, NoteType, StockNote, WatchGroup } from '../types.js';
import { queryAll, queryOne } from './db.js';
import { BizError, conflict, notFound } from './errors.js';
import { nowBeijing } from './time.js';

/**
 * 评论（备注）与分组的写入能力。
 *
 * 表结构早已在 db/schema.sql 建好（stock_note / watch_group / pick_group_rel），
 * 本模块只补「写」的部分，不新增表、不改结构。
 *
 * 时间字段统一由 nowBeijing() 生成「北京时间字符串」，与库内既有口径一致。
 *
 * 失败一律抛 BizError（见 lib/errors.ts），由路由层翻译成统一信封，
 * 因此本模块不返回 { ok, code } 这类结果对象。
 */

// ---------------------------------------------------------------------------
// 分组
// ---------------------------------------------------------------------------

/** 分组名唯一性：exceptId 用于「改名时不与自己冲突」。 */
async function assertNameFree(db: D1Database, name: string, exceptId?: number): Promise<void> {
  const dup = await queryOne<{ id: number }>(db, 'SELECT id FROM watch_group WHERE name = ?', [name]);
  if (dup && dup.id !== exceptId) throw conflict(`分组名「${name}」已存在`);
}

async function mustGetGroup(db: D1Database, id: number): Promise<WatchGroup> {
  const group = await queryOne<WatchGroup>(db, 'SELECT * FROM watch_group WHERE id = ?', [id]);
  if (!group) throw notFound(`未找到分组 ${id}`);
  return group;
}

/** 分组详情：组信息 + 成员（带股票名称/行业，便于前端直接展示）。 */
export async function getGroupDetail(db: D1Database, id: number): Promise<GroupDetail> {
  const group = await mustGetGroup(db, id);
  const members = await queryAll<GroupMember>(
    db,
    `SELECT r.code,
            b.name    AS name,
            b.sector  AS sector,
            r.note    AS note,
            r.created_at AS created_at
       FROM pick_group_rel r
       LEFT JOIN stock_base b ON b.code = r.code
      WHERE r.group_id = ?
      ORDER BY r.created_at DESC, r.code ASC`,
    [id],
  );
  return { group, members };
}

export async function createGroup(
  db: D1Database,
  input: { name: string; color: string | null; description: string | null },
): Promise<WatchGroup> {
  await assertNameFree(db, input.name);
  const res = await db
    .prepare('INSERT INTO watch_group (name, color, description, created_at) VALUES (?, ?, ?, ?)')
    .bind(input.name, input.color, input.description, nowBeijing())
    .run();
  const created = await queryOne<WatchGroup>(db, 'SELECT * FROM watch_group WHERE id = ?', [
    res.meta.last_row_id,
  ]);
  if (!created) throw new BizError('分组已写入但回读失败，请刷新后重试');
  return created;
}

/** 局部更新：字段为 undefined 表示「未提供，保持原值」；显式传 null 表示清空。 */
export async function updateGroup(
  db: D1Database,
  id: number,
  patch: { name?: string; color?: string | null; description?: string | null },
): Promise<WatchGroup> {
  await mustGetGroup(db, id);

  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    await assertNameFree(db, patch.name, id);
    sets.push('name = ?');
    params.push(patch.name);
  }
  if (patch.color !== undefined) {
    sets.push('color = ?');
    params.push(patch.color);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    params.push(patch.description);
  }
  if (sets.length) {
    await db
      .prepare(`UPDATE watch_group SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...params, id)
      .run();
  }
  return mustGetGroup(db, id);
}

/** 删除分组：同时解除票-组关联（**不删票**，票本身的入选记录与备注不受影响）。 */
export async function deleteGroup(
  db: D1Database,
  id: number,
): Promise<{ removed: boolean; unlinked: number }> {
  await mustGetGroup(db, id);
  const cnt = await queryOne<{ n: number }>(
    db,
    'SELECT COUNT(*) AS n FROM pick_group_rel WHERE group_id = ?',
    [id],
  );
  // 先清关联再删组，避免留下悬空关联（该表没有外键级联）
  await db.prepare('DELETE FROM pick_group_rel WHERE group_id = ?').bind(id).run();
  await db.prepare('DELETE FROM watch_group WHERE id = ?').bind(id).run();
  return { removed: true, unlinked: cnt?.n ?? 0 };
}

/** 把票加入分组：已存在则只更新组内备注（按主键 (code, group_id) upsert）。 */
export async function addStockToGroup(
  db: D1Database,
  groupId: number,
  code: string,
  note: string | null,
): Promise<{ ok: true }> {
  await mustGetGroup(db, groupId);
  await db
    .prepare(
      `INSERT INTO pick_group_rel (code, group_id, note, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(code, group_id) DO UPDATE SET note = excluded.note`,
    )
    .bind(code, groupId, note, nowBeijing())
    .run();
  return { ok: true };
}

/** 把票移出分组（不删票、不删组；移出后再加入会刷新入组时间）。 */
export async function removeStockFromGroup(
  db: D1Database,
  groupId: number,
  code: string,
): Promise<{ removed: boolean }> {
  const res = await db
    .prepare('DELETE FROM pick_group_rel WHERE group_id = ? AND code = ?')
    .bind(groupId, code)
    .run();
  return { removed: (res.meta.changes ?? 0) > 0 };
}

// ---------------------------------------------------------------------------
// 评论 / 备忘
// ---------------------------------------------------------------------------

async function mustGetNote(db: D1Database, id: number): Promise<StockNote> {
  const note = await queryOne<StockNote>(db, 'SELECT * FROM stock_note WHERE id = ?', [id]);
  if (!note) throw notFound(`未找到备注 ${id}`);
  return note;
}

export async function createNote(
  db: D1Database,
  input: { code: string; content: string; type: NoteType; anchorDate: string | null },
): Promise<StockNote> {
  const res = await db
    .prepare('INSERT INTO stock_note (code, anchor_date, type, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(input.code, input.anchorDate, input.type, input.content, nowBeijing())
    .run();
  const created = await queryOne<StockNote>(db, 'SELECT * FROM stock_note WHERE id = ?', [
    res.meta.last_row_id,
  ]);
  if (!created) throw new BizError('备注已写入但回读失败，请刷新后重试');
  return created;
}

export async function updateNote(
  db: D1Database,
  id: number,
  patch: { content?: string; type?: NoteType; anchorDate?: string | null },
): Promise<StockNote> {
  await mustGetNote(db, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.content !== undefined) {
    sets.push('content = ?');
    params.push(patch.content);
  }
  if (patch.type !== undefined) {
    sets.push('type = ?');
    params.push(patch.type);
  }
  if (patch.anchorDate !== undefined) {
    sets.push('anchor_date = ?');
    params.push(patch.anchorDate);
  }
  if (sets.length) {
    await db
      .prepare(`UPDATE stock_note SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...params, id)
      .run();
  }
  return mustGetNote(db, id);
}

export async function deleteNote(db: D1Database, id: number): Promise<{ removed: boolean }> {
  const res = await db.prepare('DELETE FROM stock_note WHERE id = ?').bind(id).run();
  if (!(res.meta.changes ?? 0)) throw notFound(`未找到备注 ${id}`);
  return { removed: true };
}

/** 备注列表（全量，带股票名称/行业，供「我的备注」页直接展示，不必逐股再查）。 */
export async function listNotes(
  db: D1Database,
  limit = 300,
): Promise<Array<StockNote & { name: string | null; sector: string | null }>> {
  const n = Math.min(Math.max(limit, 1), 1000);
  return queryAll(db,
    `SELECT n.id, n.code, b.name AS name, b.sector AS sector,
            n.anchor_date, n.type, n.content, n.created_at
       FROM stock_note n
       LEFT JOIN stock_base b ON b.code = n.code
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ?`,
    [n],
  );
}
