import { parseChatCommand, validateCompactCommand } from './parse-chat-command';

describe('parseChatCommand', () => {
  it('recognizes rename and trims its argument', () => {
    expect(
      parseChatCommand([{ type: 'text', text: '/rename  A name  ' }]),
    ).toEqual({
      name: 'rename',
      argument: 'A name',
    });
  });
  it('does not parse text that lacks the leading slash', () => {
    expect(
      parseChatCommand([{ type: 'text', text: 'xrename files are missing' }]),
    ).toBeNull();
  });

  it('recognizes a bare rename with an empty argument', () => {
    expect(parseChatCommand([{ type: 'text', text: '/rename' }])).toEqual({
      name: 'rename',
      argument: '',
    });
  });

  it('Text with a space before the slash is a message', () => {
    expect(
      parseChatCommand([{ type: 'text', text: ' /rename Foo' }]),
    ).toBeNull();
  });

  it('A path is a message', () => {
    expect(
      parseChatCommand([{ type: 'text', text: '/etc/hosts is broken' }]),
    ).toBeNull();
  });

  it('An unknown name is a message', () => {
    expect(
      parseChatCommand([{ type: 'text', text: '/summarize the chat' }]),
    ).toBeNull();
  });

  it('A longer word is not a command', () => {
    expect(
      parseChatCommand([{ type: 'text', text: '/renamed files are missing' }]),
    ).toBeNull();
  });

  it('recognizes compact and trims its unsupported focus', () => {
    expect(
      parseChatCommand([{ type: 'text', text: '/compact  migration plan  ' }]),
    ).toEqual({ name: 'compact', argument: 'migration plan' });
  });

  it('parses a command with a file part so the service can reject it', () => {
    expect(
      parseChatCommand([
        { type: 'text', text: '/rename Foo' },
        { type: 'file' },
      ]),
    ).toEqual({ name: 'rename', argument: 'Foo' });
    expect(parseChatCommand([{ type: 'file' }])).toBeNull();
  });

  it('ignores a text part whose text value is not a string', () => {
    expect(parseChatCommand([{ type: 'text', text: 42 }])).toBeNull();
  });
});

describe('validateCompactCommand', () => {
  it('rejects any file part without validating text content', () => {
    expect(() =>
      validateCompactCommand(
        [{ type: 'text', text: '/compact' }, { type: 'file' }],
        '',
      ),
    ).toThrow('A command cannot include an attachment.');
  });

  it('accepts text-only parts and returns the focus or null when empty', () => {
    expect(
      validateCompactCommand([{ type: 'text', text: '/compact' }], ''),
    ).toBeNull();
    expect(
      validateCompactCommand([{ type: 'text', text: '/compact plan' }], 'plan'),
    ).toBe('plan');
  });

  it('counts focus in code points and rejects more than 1,000', () => {
    expect(validateCompactCommand([], '😀'.repeat(1000))).toBe(
      '😀'.repeat(1000),
    );
    expect(() => validateCompactCommand([], '😀'.repeat(1001))).toThrow(
      'Compact focus must be 1,000 characters or fewer.',
    );
  });
});
