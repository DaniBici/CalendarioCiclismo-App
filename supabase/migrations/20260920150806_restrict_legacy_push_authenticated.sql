-- Las RPC anteriores a v4 siguen disponibles para instalaciones antiguas sin
-- elevar su alcance al rol authenticated. La app actual mantiene anon + auth en v4.
REVOKE EXECUTE ON FUNCTION public.set_push_subscription_full(text, text, boolean, text, text[], text[], text[])
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_push_subscription_v2(text, text, boolean, text, text, text[], text[], text[])
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_push_subscription_v2(text, text, boolean, text, text, text[], text[], text[], text[])
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_push_subscription_v3(text, text, boolean, text, text, text, text[], text[], text[], text[])
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_push_subscription_with_categories(text, text, boolean, text, text[])
  FROM authenticated;

NOTIFY pgrst, 'reload schema';
