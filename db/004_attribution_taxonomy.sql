CREATE OR REPLACE FUNCTION minilytics_normalize_attribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  detail text := lower(regexp_replace(COALESCE(NEW.source_detail, ''), '^www\.', ''));
BEGIN
  -- Same-site landings are not a useful acquisition channel. The collector
  -- already marks these as internal, so canonicalize them to direct.
  IF NEW.source = 'internal' THEN
    NEW.source := 'direct';
    NEW.medium := 'direct';
    NEW.source_detail := NULL;
    RETURN NEW;
  END IF;

  -- AI assistants / answer engines are organic discovery rather than paid campaigns.
  IF detail IN ('chatgpt', 'chatgpt.com', 'chat.openai.com', 'openai', 'openai.com') THEN
    NEW.source := 'organic'; NEW.medium := 'ai'; NEW.source_detail := 'chatgpt';
  ELSIF detail IN ('perplexity', 'perplexity.ai', 'perplexity.com') THEN
    NEW.source := 'organic'; NEW.medium := 'ai'; NEW.source_detail := 'perplexity';
  ELSIF detail IN ('copilot', 'copilot.com', 'copilot.microsoft.com') THEN
    NEW.source := 'organic'; NEW.medium := 'ai'; NEW.source_detail := 'copilot';
  ELSIF detail IN ('claude', 'claude.ai', 'anthropic', 'anthropic.com') THEN
    NEW.source := 'organic'; NEW.medium := 'ai'; NEW.source_detail := 'claude';
  ELSIF detail IN ('gemini', 'gemini.google.com', 'bard.google.com') THEN
    NEW.source := 'organic'; NEW.medium := 'ai'; NEW.source_detail := 'gemini';
  ELSIF detail IN ('grok', 'grok.com') THEN
    NEW.source := 'organic'; NEW.medium := 'ai'; NEW.source_detail := 'grok';
  ELSIF detail IN ('you.com', 'you') THEN
    NEW.source := 'organic'; NEW.medium := 'ai'; NEW.source_detail := 'you.com';
  ELSIF detail IN ('phind', 'phind.com') THEN
    NEW.source := 'organic'; NEW.medium := 'ai'; NEW.source_detail := 'phind';
  ELSIF detail IN ('mistral', 'mistral.ai', 'chat.mistral.ai') THEN
    NEW.source := 'organic'; NEW.medium := 'ai'; NEW.source_detail := 'mistral';

  -- Search engines that previously fell through to referral.
  ELSIF detail IN ('baidu.com', 'm.baidu.com', 'www.baidu.com', 'baidu') THEN
    NEW.source := 'organic'; NEW.medium := 'search'; NEW.source_detail := 'baidu';
  ELSIF detail IN ('startpage.com', 'www.startpage.com', 'startpage') THEN
    NEW.source := 'organic'; NEW.medium := 'search'; NEW.source_detail := 'startpage';
  ELSIF detail IN ('swisscows.com', 'www.swisscows.com', 'swisscows') THEN
    NEW.source := 'organic'; NEW.medium := 'search'; NEW.source_detail := 'swisscows';
  ELSIF detail IN ('suche.web.de', 'web.de') THEN
    NEW.source := 'organic'; NEW.medium := 'search'; NEW.source_detail := 'web.de';
  ELSIF detail IN ('search.brave.com', 'brave.com', 'brave') THEN
    NEW.source := 'organic'; NEW.medium := 'search'; NEW.source_detail := 'brave';
  ELSIF detail IN ('qwant.com', 'www.qwant.com', 'qwant') THEN
    NEW.source := 'organic'; NEW.medium := 'search'; NEW.source_detail := 'qwant';
  ELSIF detail IN ('kagi.com', 'www.kagi.com', 'kagi') THEN
    NEW.source := 'organic'; NEW.medium := 'search'; NEW.source_detail := 'kagi';
  ELSIF detail IN ('mojeek.com', 'www.mojeek.com', 'mojeek') THEN
    NEW.source := 'organic'; NEW.medium := 'search'; NEW.source_detail := 'mojeek';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_normalize_attribution ON events;
CREATE TRIGGER events_normalize_attribution
BEFORE INSERT OR UPDATE OF source, medium, source_detail, site_id
ON events
FOR EACH ROW
EXECUTE FUNCTION minilytics_normalize_attribution();

-- Re-run canonicalization only for rows that can be affected. This still scans
-- the table once, but avoids rewriting unrelated events and the associated
-- row locks, WAL volume, table bloat and autovacuum work.
UPDATE events
SET source = source,
    medium = medium,
    source_detail = source_detail
WHERE source = 'internal'
   OR lower(regexp_replace(COALESCE(source_detail, ''), '^www\.', '')) IN (
     'chatgpt', 'chatgpt.com', 'chat.openai.com', 'openai', 'openai.com',
     'perplexity', 'perplexity.ai', 'perplexity.com',
     'copilot', 'copilot.com', 'copilot.microsoft.com',
     'claude', 'claude.ai', 'anthropic', 'anthropic.com',
     'gemini', 'gemini.google.com', 'bard.google.com',
     'grok', 'grok.com', 'you.com', 'you', 'phind', 'phind.com',
     'mistral', 'mistral.ai', 'chat.mistral.ai',
     'baidu.com', 'm.baidu.com', 'www.baidu.com', 'baidu',
     'startpage.com', 'www.startpage.com', 'startpage',
     'swisscows.com', 'www.swisscows.com', 'swisscows',
     'suche.web.de', 'web.de', 'search.brave.com', 'brave.com', 'brave',
     'qwant.com', 'www.qwant.com', 'qwant',
     'kagi.com', 'www.kagi.com', 'kagi',
     'mojeek.com', 'www.mojeek.com', 'mojeek'
   );
