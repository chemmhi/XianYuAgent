DO $$
DECLARE
  has_legacy_column boolean;
  has_knowledge_base_column boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'products'
      AND table_name = 'products'
      AND column_name = 'ai_prompt'
  ) INTO has_legacy_column;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'products'
      AND table_name = 'products'
      AND column_name = 'knowledge_base'
  ) INTO has_knowledge_base_column;

  IF has_legacy_column AND has_knowledge_base_column THEN
    RAISE EXCEPTION 'products.products contains both ai_prompt and knowledge_base; resolve schema before migrating';
  ELSIF has_legacy_column THEN
    ALTER TABLE products.products RENAME COLUMN ai_prompt TO knowledge_base;
  END IF;
END $$;
