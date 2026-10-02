export type ResultTableData = { title: string; columns: string[]; rows: string[][]; links: (string | null)[]; note?: string };

/** A table of Jira results. Cells are text; the first cell links to the issue in Jira when there is a link. */
export function ResultTable({ table }: { table: ResultTableData }) {
  return <figure className="result">
    <figcaption>{table.title}</figcaption>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`${table.title} table`}>
      <table>
        <thead><tr>{table.columns.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>{table.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} className={cell.length <= 16 ? 'short' : undefined}>{c === 0 && table.links[r] ? <a href={table.links[r]!} target="_blank" rel="noreferrer">{cell}</a> : cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {table.note && <p className="muted result-note">{table.note}</p>}
  </figure>;
}
