import { expect, test } from 'vitest';
import { createModelOutputTextPreview } from '../src/index.js';

test('model output preview extracts escaped text across arbitrary stream chunks', () => {
  const preview = createModelOutputTextPreview();
  const source = JSON.stringify({
    items: [
      {
        type: 'text',
        text: 'Hello "world"\n',
        providerCallId: null,
        tool: null,
        input: { text: 'nested tool input' },
        value: null,
      },
      {
        type: 'text',
        text: '第二段',
        providerCallId: null,
        tool: null,
        input: null,
        value: null,
      },
    ],
    finishReason: 'stop',
  });
  const output: string[] = [];
  for (let index = 0; index < source.length; index += 2)
    output.push(...preview.push(source.slice(index, index + 2)));
  expect(output.join('')).toBe('Hello "world"\n第二段');
  expect(output.join('')).not.toContain('nested tool input');
});

test('model output preview honors its character bound', () => {
  const preview = createModelOutputTextPreview({ maxCharacters: 5 });
  const output: string[] = [];
  output.push(...preview.push('{"items":[{"type":"text","text":"abcdef"}'));
  output.push(...preview.push(']}'));
  expect(output.join('')).toBe('abcde');
});
