export async function shareLyraContent({ title, text, url }: { title: string; text: string; url?: string }) {
  const payload = { title, text, ...(url ? { url } : {}) };
  if (navigator.share) {
    await navigator.share(payload);
    return 'shared';
  }
  await navigator.clipboard?.writeText([text, url].filter(Boolean).join('\n'));
  return 'copied';
}
