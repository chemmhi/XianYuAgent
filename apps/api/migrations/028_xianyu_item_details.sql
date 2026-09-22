-- 商品详情同步的可审计元数据落库；图片二进制不进入 PostgreSQL。
ALTER TABLE products.asset_refs
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS asset_refs_product_source_url_idx
  ON products.asset_refs (product_id, source_url)
  WHERE source_url IS NOT NULL;

COMMENT ON COLUMN products.asset_refs.storage_key IS 'S3/MinIO object key; 不存图片二进制';
COMMENT ON COLUMN products.asset_refs.source_url IS '闲鱼详情接口返回的原始图片 URL';
