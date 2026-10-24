set -eu
cd /home/ubuntu/xianyu-agent-prod
git rev-parse HEAD
docker compose -f compose.prod.yml exec -T -e PGOPTIONS='-c default_transaction_read_only=on' postgres psql -X -v ON_ERROR_STOP=1 -U xianyu -d xianyu_agent -At <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object('observedAt',now(),'readOnly',current_setting('transaction_read_only'),'account',row_to_json(a),'credential',row_to_json(c),'healthSignals',(SELECT json_agg(h) FROM accounts.health_signals h WHERE h.account_id=a.id)) FROM accounts.accounts a LEFT JOIN auth.account_credentials c ON c.account_id=a.id WHERE a.id='1d274de5-38b8-4c9b-83ed-d8ba803685ac' AND a.seller_ref='1903703477';
COMMIT;
SQL
docker compose -f compose.prod.yml ps --format json
