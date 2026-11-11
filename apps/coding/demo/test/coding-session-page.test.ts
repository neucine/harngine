import { expect, test } from 'vitest';
import { codingSessionPage } from '../src/coding-session-page.js';

test('coding Session page explains the generated contract and recorded open tool loop', () => {
  const html = codingSessionPage('test-token');
  expect(html).toContain('A coding harness without a coded workflow');
  expect(html).toContain('Framework-generated response schema');
  expect(html).toContain('Selected Session context');
  expect(html).toContain('Recorded Agent loop');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  expect(() => new Function(script!)).not.toThrow();
});
