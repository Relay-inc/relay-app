import { css } from "lit";

/** What the browser drew for markdown in the right panel (PR, note and card text) before Tailwind's reset took it away:
 *  bold sized headings, a 40px list indent, bold table heads, links in the link colour. Add it after `tw` next to `md-panel`. */
export const mdDefaults = css`
  .md-panel h1 {
    font-size: 2em;
    font-weight: 700;
  }
  .md-panel h2 {
    font-size: 1.5em;
    font-weight: 700;
  }
  .md-panel h3 {
    font-size: 1.17em;
    font-weight: 700;
  }
  .md-panel h4 {
    font-weight: 700;
  }
  .md-panel h5 {
    font-size: 0.83em;
    font-weight: 700;
  }
  .md-panel h6 {
    font-size: 0.67em;
    font-weight: 700;
  }
  .md-panel ul,
  .md-panel ol {
    padding-left: 40px;
  }
  .md-panel th {
    font-weight: 700;
    text-align: center;
  }
  .md-panel a {
    color: -webkit-link;
    text-decoration: underline;
  }
`;
