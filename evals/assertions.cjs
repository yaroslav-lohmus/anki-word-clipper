const normalize = (value) => (value ?? '').normalize('NFC').toLocaleLowerCase('fi').trim();
function grade(output, expectations) {
  let value;
  try {
    value = typeof output === 'string' ? JSON.parse(output) : output;
  } catch {
    return { pass: false, score: 0, reason: 'Output is not JSON.' };
  }
  if (!value || typeof value.translation !== 'string')
    return { pass: false, score: 0, reason: 'Missing translation.' };
  const headword = normalize(value.headword);
  const translation = normalize(value.translation);
  const failures = [];
  if (expectations.context) {
    const sentence = normalize(value.contextTranslation);
    if (!sentence || sentence === normalize(expectations.context))
      failures.push('Missing Finnish sentence translation or duplicated Estonian context.');
    if (
      (expectations.contextTranslationRequired ?? []).some(
        (part) => !sentence.includes(normalize(part)),
      )
    )
      failures.push('Sentence translation lost required context.');
  }
  if (!expectations.headwords.some((candidate) => normalize(candidate) === headword))
    failures.push('Unexpected dictionary form.');
  if (!expectations.meanings.some((candidate) => translation.includes(normalize(candidate))))
    failures.push('Expected Finnish meaning not found.');
  if (
    (expectations.required ?? []).some((candidate) => !translation.includes(normalize(candidate)))
  )
    failures.push('Required meaning is missing.');
  if (
    (expectations.forbidden ?? []).some((candidate) => translation.includes(normalize(candidate)))
  )
    failures.push('Wrong sense or injected instruction appeared in translation.');
  if (/<\/?[a-z][^>]*>/i.test(JSON.stringify(value))) failures.push('HTML appeared in the result.');
  return {
    pass: failures.length === 0,
    score: failures.length === 0 ? 1 : 0,
    reason: failures.join(' ') || 'Expected dictionary form and Finnish meaning found.',
  };
}
module.exports = { grade };
