import { hello } from '../src/index.ts';

test('hello greets by name', () => {
  expect(hello('world')).toBe('Hello, world!');
});
