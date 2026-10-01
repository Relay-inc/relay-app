// claude-opus-5-5 as Opus 5.5, claude-haiku-4-5-20251001 as Haiku 4.5, anything else as it is
export const modelName = (id: string) => {
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}` : id;
};
