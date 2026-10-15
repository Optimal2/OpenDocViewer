// Mutate actual statement extents, preserving the production file on disk.
import assert from 'node:assert/strict';

export function finalFixtures(source, parsed) {
  assert.deepEqual(parsed.parseErrors, []);
  const { nodes } = parsed;
  const one = (predicate) => {
    const matches = nodes.filter(predicate);
    assert.equal(matches.length, 1, 'fixture anchor must be unique');
    return matches[0];
  };
  const echo = one((n) => n.type === 'ForEachStatementAst' && n.text.startsWith('foreach ($line in @($agentDocsOutput))'));
  const output = one((n) => n.type === 'AssignmentStatementAst' && n.text.startsWith('$agentDocsOutput = & node'));
  const captureSiblings = nodes.filter((n) => n.parentId === output.parentId).sort((a, b) => a.start - b.start);
  const reset = captureSiblings[captureSiblings.findIndex((n) => n.id === output.id) - 1];
  assert.equal(reset.text, '$global:LASTEXITCODE = 0');
  const gate = one((n) => n.type === 'IfStatementAst' && n.text.startsWith('if ($agentDocsExit -eq 0)'));
  const root = one((n) => n.parentId === 0 && n.type === 'ScriptBlockAst');
  const main = one((n) => n.parentId === root.id && n.type === 'NamedBlockAst');
  const firstStatement = nodes.filter((n) => n.parentId === main.id).sort((a, b) => a.start - b.start)[0];
  const catchClause = one((n) => n.type === 'CatchClauseAst' && n.text.includes('Agent documentation freshness step threw an exception:'));
  const catchBlock = one((n) => n.parentId === catchClause.id && n.type === 'StatementBlockAst');
  const moveEcho = (position) => source.slice(0, echo.start) + source.slice(echo.end, position)
    + '\n' + echo.text + '\n' + source.slice(position);
  const inCatch = (statement) => source.slice(0, catchBlock.start + 1) + `\n${statement}\n` + source.slice(catchBlock.start + 1);
  return [
    { name: 'echo-before-captures', reason: /echo order:/,
      text: source.slice(0, reset.start) + echo.text + '\n' + source.slice(reset.start, echo.start) + source.slice(echo.end) },
    { name: 'echo-after-verdict', reason: /echo order:/, text: moveEcho(gate.end) },
    { name: 'early-exit-zero', reason: /silent termination: constant-zero exit/,
      text: source.slice(0, firstStatement.start) + 'exit 0\n' + source.slice(firstStatement.start) },
    ...['return', 'break', 'continue', 'exit 0'].map((statement) => ({
      name: `catch-${statement.replace(' ', '-')}`, reason: /silent termination:/, text: inCatch(statement),
    })),
  ];
}
