import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
let raw;
let prompts = [];
mock.module('../src/services/openaiService.js', { namedExports: { createChatJson: async messages => {
  prompts.push(messages[1].content);
  return Array.isArray(raw) ? raw.shift() : raw;
} } });
const { rebalanceOptionLengths } = await import('../src/services/questionRepairService.js');
const question = {
  question: 'Señala la respuesta INCORRECTA sobre la combustión:', correct_answer: 'C', explanation: 'Es exotérmica.',
  option_a: 'Es una reacción química de oxidación que desprende energía en forma de calor y luz.',
  option_b: 'Sus reactivos son combustible y comburente.', option_c: 'Es una reacción endotérmica.', option_d: 'Produce dióxido de carbono y agua.',
};

test('rebalances option lengths and keeps the question when the repair does not fit', async () => {
  raw = JSON.stringify({ option_a: 'Es una oxidación que desprende calor y luz.', option_b: 'Sus reactivos son combustible y comburente.', option_c: 'Es una reacción química endotérmica.', option_d: 'Produce dióxido de carbono y agua.', explanation: 'Es exotérmica.' });
  const repaired = await rebalanceOptionLengths(question, { text: 'fragmento' });
  assert.equal(repaired.option_a, 'Es una oxidación que desprende calor y luz.');
  assert.equal(repaired.correct_answer, 'C');
  raw = JSON.stringify({ ...JSON.parse(raw), option_b: 'Sí.' , option_a: 'Es una reacción química de oxidación que desprende energía en forma de calor y de luz visible.' });
  assert.equal(await rebalanceOptionLengths(question, { text: 'fragmento' }), question);
  raw = 'no es JSON';
  assert.equal(await rebalanceOptionLengths(question, { text: 'fragmento' }), question);
});

test('a second repair attempt starts from the first one and is told how far it fell short', async () => {
  const fits = { option_a: 'Es una oxidación que desprende calor y luz.', option_b: 'Sus reactivos son combustible y comburente.', option_c: 'Es una reacción química endotérmica.', option_d: 'Produce dióxido de carbono y agua.', explanation: 'Es exotérmica.' };
  const stillLong = { ...fits, option_a: 'Es una reacción química de oxidación que desprende energía en forma de calor y luz.', option_b: 'Sí.' };
  raw = [JSON.stringify(stillLong), JSON.stringify(fits)];
  prompts = [];
  const repaired = await rebalanceOptionLengths(question, { text: 'fragmento' });
  assert.equal(repaired.option_a, fits.option_a);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Tu intento anterior seguía teniendo 14 palabras de diferencia/);
  assert.match(prompts[1], /B: Sí\./);
});
