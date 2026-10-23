set -eu
cd /home/ubuntu/xianyu-agent-prod
docker compose -f compose.prod.yml exec -T postgres psql -U xianyu -d xianyu_agent -At -c "SELECT json_build_object('observedAt',now(),'account',row_to_json(a),'credential',row_to_json(c)) FROM accounts.accounts a LEFT JOIN auth.account_credentials c ON c.account_id=a.id WHERE a.seller_ref='1903703477';"
