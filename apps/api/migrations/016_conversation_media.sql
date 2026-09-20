ALTER TABLE messages.conversations
  ADD COLUMN IF NOT EXISTS buyer_avatar_url text,
  ADD COLUMN IF NOT EXISTS item_image_url text;
