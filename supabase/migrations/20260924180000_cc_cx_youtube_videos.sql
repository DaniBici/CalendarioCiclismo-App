-- Los vídeos editoriales CX se publican como enlaces canónicos de YouTube.
ALTER TABLE public.cx_videos
  ADD CONSTRAINT cx_videos_youtube_watch_url_check
  CHECK (url ~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$');
