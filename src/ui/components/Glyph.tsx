/** A provider's own glyph: a package's static SVG body (trusted, it ships with the app), 16×16 unless `viewBox` says
 *  otherwise. `className` sizes it: the `glyph` utility only sets fill and stroke. */
export function Glyph({
  svg,
  className = "glyph",
  viewBox = "0 0 16 16",
}: {
  svg: string;
  className?: string;
  viewBox?: string;
}) {
  return <svg className={className} viewBox={viewBox} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}
