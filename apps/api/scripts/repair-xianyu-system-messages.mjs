import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value?.startsWith('--')) continue;
  const [key, inline] = value.slice(2).split('=', 2);
  args.set(key, inline ?? process.argv[index + 1]);
  if (inline === undefined) index += 1;
}

const accountId = args.get('account-id');
const buyerRef = args.get('buyer-ref');
const conversationRef = args.get('conversation-ref');
const apply = args.has('apply');

if (!accountId) throw new Error('--account-id is required');

const candidatePredicate = `(
  m.body_text like '温馨提醒：商品信息近期有过变更%'
  or m.body_text like '恭喜新手卖家，您的宝贝有人来询单啦！%'
  or m.body_text in ('已收到小红花', '快给ta一个评价吧～')
  or m.body_text in ('[未付款，买家关闭了订单]', '[未付款，你关闭了订单]', '[你当前宝贝拍下未付款]', '[卖家已发货]', '[你已确认收货，交易成功]', '[我完成了评价]', '[我已修改价格，等待你付款]')
  or (m.body_text like '[我设置了小刀优惠，能刀多少就看你的本事啦!]')
)`;

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
try {
  const params = [accountId];
  const filters = ['c.account_id=$1', "m.direction='inbound'", "m.sender_role='buyer'", "m.body_type='text'", candidatePredicate];
  if (buyerRef) { params.push(buyerRef); filters.push(`c.buyer_ref=$${params.length}`); }
  if (conversationRef) { params.push(conversationRef); filters.push(`c.external_conversation_ref=$${params.length}`); }
  const candidateResult = await client.query(`
    select m.id,m.conversation_id,m.account_id,m.external_message_ref,m.sender_role,m.body_type,m.body_text,m.body_ref,m.created_at,m.risk_flags,
           c.external_conversation_ref,c.buyer_ref,c.buyer_display_name,
           i.id as inbox_id,i.status as inbox_status,
           r.id as run_id,r.status as run_status,r.decision as run_decision,r.risk_flags as run_risk_flags,
           r.failure_code as run_failure_code,r.sender_outcome,r.outbound_message_id
    from messages.messages m
    join messages.conversations c on c.id=m.conversation_id
    left join messages.auto_reply_inbound_inbox i on i.inbound_message_id=m.id
    left join messages.auto_reply_runs r on r.inbound_message_id=m.id
    where ${filters.join(' and ')}
    order by m.created_at asc,m.id asc`, params);

  const candidates = candidateResult.rows;
  const preview = candidates.map((row) => ({
    externalConversationRef: String(row.external_conversation_ref),
    externalMessageRef: String(row.external_message_ref),
    bodyText: String(row.body_text ?? ''),
    inboxStatus: row.inbox_status ? String(row.inbox_status) : undefined,
    runStatus: row.run_status ? String(row.run_status) : undefined,
    runDecision: row.run_decision ? String(row.run_decision) : undefined,
  }));
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', accountId, buyerRef: buyerRef ?? null, conversationRef: conversationRef ?? null, candidateCount: candidates.length, candidates: preview }, null, 2));
  if (!apply || candidates.length === 0) {
    client.release();
    await pool.end();
    process.exit(0);
  }

  await client.query('begin');
  let messagesUpdated = 0;
  let eventsCreated = 0;
  let inboxClosed = 0;
  let runsAnnotated = 0;
  let runsSkipped = 0;
  const runStage = (status) => ({ received: 'gateway_received', classified: 'intent_recognition', context_loaded: 'context_read', generated: 'reply_generation', simulated: 'sending', persisted: 'persisted', handoff: 'handoff', skipped: 'skipped', failed: 'failed' }[status] ?? 'skipped');

  for (const row of candidates) {
    const currentFlags = Array.isArray(row.risk_flags) ? row.risk_flags.map(String) : [];
    const nextFlags = [...new Set([...currentFlags, 'xianyu_system_message'])];
    const messageChanged = String(row.sender_role ?? 'buyer') !== 'system' || String(row.body_type ?? 'text') !== 'system' || nextFlags.length !== currentFlags.length;
    if (messageChanged) {
      const updated = await client.query(`update messages.messages
        set sender_role='system',body_type='system',source='system',risk_flags=$2::jsonb
        where id=$1 and direction='inbound'
        returning *`, [row.id, JSON.stringify(nextFlags)]);
      if (updated.rows[0]) {
        messagesUpdated += 1;
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [row.conversation_id]);
        const conversation = (await client.query('update messages.conversations set version=version+1,updated_at=now() where id=$1 returning *', [row.conversation_id])).rows[0];
        const cursor = Number((await client.query('select coalesce(max(cursor),0)::bigint+1 as cursor from messages.events where conversation_id=$1', [row.conversation_id])).rows[0]?.cursor ?? 1);
        const eventId = crypto.randomUUID();
        const occurredAt = new Date().toISOString();
        const message = updated.rows[0];
        const payload = {
          message: {
            messageId: String(message.id),
            conversationId: String(message.conversation_id),
            accountId: String(message.account_id),
            direction: String(message.direction),
            senderRole: 'system',
            bodyType: 'system',
            bodyText: message.body_text ? String(message.body_text) : undefined,
            bodyRef: message.body_ref ? String(message.body_ref) : undefined,
            externalMessageRef: message.external_message_ref ? String(message.external_message_ref) : undefined,
            source: 'system',
            riskFlags: nextFlags,
            createdAt: new Date(String(message.created_at)).toISOString(),
          },
          conversation: conversation ? { conversationId: String(conversation.id), accountId: String(conversation.account_id), version: Number(conversation.version) } : undefined,
        };
        await client.query(`insert into messages.events (event_id,conversation_id,account_id,cursor,type,occurred_at,trace_id,payload_json)
          values ($1,$2,$3,$4,'chat.message.updated',$5,$6,$7::jsonb)`, [eventId, row.conversation_id, row.account_id, cursor, occurredAt, `repair:xianyu-system:${row.external_message_ref}`, JSON.stringify(payload)]);
        eventsCreated += 1;
      }
    }

    if (row.inbox_id && ['pending', 'processing', 'retryable'].includes(String(row.inbox_status))) {
      const inboxUpdate = await client.query(`update messages.auto_reply_inbound_inbox
        set status='dead_lettered',locked_at=null,lease_expires_at=null,lease_owner=null,
            last_error_code='XIANYU_SYSTEM_MESSAGE_RECLASSIFIED',last_error_digest='xianyu-system-message-repair',last_error_at=now(),updated_at=now()
        where id=$1 and status in ('pending','processing','retryable')`, [row.inbox_id]);
      inboxClosed += Number(inboxUpdate.rowCount ?? 0);
    }

    if (row.run_id) {
      const runFlags = Array.isArray(row.run_risk_flags) ? row.run_risk_flags.map(String) : [];
      const nextRunFlags = [...new Set([...runFlags, 'xianyu_system_message'])];
      const currentStatus = String(row.run_status);
      const isProcessing = ['received', 'classified', 'context_loaded', 'generated', 'simulated'].includes(currentStatus);
      const nextStatus = isProcessing ? 'skipped' : currentStatus;
      const nextDecision = isProcessing ? 'skipped' : String(row.run_decision);
      const runUpdate = await client.query(`update messages.auto_reply_runs
        set status=$2,decision=$3,risk_flags=$4::jsonb,
            failure_code=coalesce(failure_code,'XIANYU_SYSTEM_MESSAGE_RECLASSIFIED'),updated_at=now()
        where id=$1`, [row.run_id, nextStatus, nextDecision, JSON.stringify(nextRunFlags)]);
      if (Number(runUpdate.rowCount ?? 0) > 0) {
        runsAnnotated += 1;
        if (isProcessing) runsSkipped += 1;
        const sequence = Number((await client.query('select coalesce(max(sequence),0)::int+1 as sequence from messages.auto_reply_run_events where run_id=$1', [row.run_id])).rows[0]?.sequence ?? 1);
        await client.query(`insert into messages.auto_reply_run_events (id,run_id,account_id,sequence,event_type,stage,status,occurred_at,trace_id,payload_json)
          values ($1,$2,$3,$4,'run.reconciled','${runStage(nextStatus)}',$5,now(),$6,$7::jsonb)`, [crypto.randomUUID(), row.run_id, row.account_id, sequence, nextStatus, `repair:xianyu-system:${row.external_message_ref}`, JSON.stringify({ reason: 'XIANYU_SYSTEM_MESSAGE_RECLASSIFIED', externalMessageRef: row.external_message_ref, outboundMessageId: row.outbound_message_id ?? null })]);
      }
    }
  }

  await client.query('commit');
  console.log(JSON.stringify({ messagesUpdated, eventsCreated, inboxClosed, runsAnnotated, runsSkipped }, null, 2));
} catch (error) {
  try { await client.query('rollback'); } catch { /* ignore rollback failure */ }
  throw error;
} finally {
  client.release();
  await pool.end();
}
