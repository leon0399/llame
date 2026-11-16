import { parseChatCommand } from './parse-chat-command';

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

  it('does not recognize compact in this layer', () => {
    expect(parseChatCommand([{ type: 'text', text: '/compact' }])).toBeNull();
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
});
