/** A column's name: the app's own for the ones it knows (Date, Title, Stage), else the frontmatter key as it is. `any`
 *  is `useT().any`, which answers a key it does not know with the key. */
export const columnLabel = (any: (key: string) => string, key: string) => {
  const known = `coll.col.${key}`;
  const label = any(known);
  return label === known ? key : label;
};
