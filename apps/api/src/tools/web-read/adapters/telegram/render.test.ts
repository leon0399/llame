import { describe, expect, it } from 'vitest';

import {
  renderChannelPage,
  renderWidgetPost,
  type TelegramRender,
} from './render';

const CDN = 'https://cdn4.telesco.pe/file/token.jpg';
const OWNER =
  '<div class="tgme_widget_message_author"><a class="tgme_widget_message_owner_name" href="https://t.me/durov"><span dir="auto">Pavel Durov</span></a></div>';
const HIDDEN =
  '<div class="media_not_supported_cont"><div class="message_media_not_supported_wrap"><div class="message_media_not_supported_label">Please open Telegram to view this post</div></div></div>';
const HEADER =
  '<div class="tgme_channel_info"><div class="tgme_channel_info_header_title"><span dir="auto">Pavel Durov</span></div><div class="tgme_channel_info_header_username"><a href="https://t.me/durov">@durov</a></div></div>';

function message(post: string, bubble: string, classes = ''): string {
  return `<div class="tgme_widget_message${classes}" data-post="${post}"><div class="tgme_widget_message_bubble">${bubble}</div></div>`;
}

function footer(post: string, meta = ''): string {
  return `<div class="tgme_widget_message_footer"><span class="tgme_widget_message_meta">${meta}<a class="tgme_widget_message_date" href="https://t.me/${post}"><time datetime="2026-10-08T15:40:10+00:00">Oct 8</time></a></span></div>`;
}

function text(html: string): string {
  return `<div class="tgme_widget_message_text">${html}</div>`;
}

/** A channel post with the owner, the given bubble content, and a footer. */
function post(id: number, bubble: string, classes = ''): string {
  return message(
    `durov/${id}`,
    `${OWNER}${bubble}${footer(`durov/${id}`)}`,
    classes,
  );
}

function widget(body: string): string {
  return `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;
}

function page(posts: Array<string>, head = '', header = HEADER): string {
  const wraps = posts
    .map((item) => `<div class="tgme_widget_message_wrap">${item}</div>`)
    .join('');
  return `<!DOCTYPE html><html><head>${head}</head><body>${header}<section>${wraps}</section></body></html>`;
}

function content(render: TelegramRender): string {
  if (!('content' in render)) throw new Error(`failed: ${render.failure}`);
  return render.content;
}

describe('Telegram post entry', () => {
  it('renders a channel post with its metadata and bare emoji', () => {
    const html = widget(
      message(
        'durov/400',
        [
          OWNER,
          `<div class="media_supported_cont"><a class="tgme_widget_message_photo_wrap" href="https://t.me/durov/400" style="background-image:url('${CDN}')"></a>`,
          text(
            `Hello <tg-emoji emoji-id="1"><i class="emoji" style="background-image:url('//telegram.org/img/emoji/40/F09F918B.png')"><b>👋</b></i></tg-emoji> world <i class="emoji"><b>🔥</b></i>`,
          ),
          '</div>',
          HIDDEN,
          '<div class="tgme_widget_message_reactions">',
          '<span class="tgme_reaction tgme_reaction_paid"><i class="icon icon-telegram-stars"></i>16.8K</span>',
          '<span class="tgme_reaction"><i class="emoji"><b>👍</b></i>1.2K</span>',
          '<span class="tgme_reaction"><tg-emoji emoji-id="5190660975866437599"></tg-emoji>194K</span>',
          '</div>',
          '<div class="tgme_widget_message_info"><span class="tgme_widget_message_views">35.6K</span><span class="copyonly"> views</span></div>',
          footer(
            'durov/400',
            '<span class="tgme_widget_message_from_author">Alice</span>,&nbsp;edited &nbsp;',
          ),
        ].join(''),
      ),
    );

    const rendered = content(renderWidgetPost(html));
    expect(rendered).toBe(
      [
        '## Post · 1/1 — Pavel Durov (@durov)',
        '',
        'Hello 👋 world 🔥',
        '',
        '> [photo]',
        '',
        'Signed: Alice',
        'Views: 35.6K',
        'Reactions: ⭐ 16.8K, 👍 1.2K, custom 194K',
        'Edited',
        'Source: https://t.me/durov/400',
        'Date: 2026-10-08T15:40:10+00:00',
      ].join('\n'),
    );
    expect(rendered).not.toContain('telesco.pe');
  });

  it('renders only the lines the markup carries', () => {
    const html = widget(post(5, text('Plain')));

    expect(content(renderWidgetPost(html))).toBe(
      [
        '## Post · 1/1 — Pavel Durov (@durov)',
        '',
        'Plain',
        '',
        'Source: https://t.me/durov/5',
        'Date: 2026-10-08T15:40:10+00:00',
      ].join('\n'),
    );
  });

  it('renders hashtag search links as text and resolves relative links', () => {
    const html = page([
      post(
        7,
        text(
          '<a href="?q=%23iOS">#iOS</a> see <a href="/durov/1">first</a>, <a href="https://example.com/x">site</a> and <tg-spoiler>secret</tg-spoiler>',
        ),
      ),
    ]);

    const rendered = content(renderChannelPage(html, 'https://t.me/s/durov'));
    expect(rendered).toContain(
      '\n\n#iOS see [first](https://t.me/durov/1), [site](https://example.com/x) and secret\n\n',
    );
    expect(rendered).not.toContain('?q=');
  });

  it('renders a forwarded reply with its origin and parent snippet', () => {
    const html = widget(
      post(
        63,
        [
          '<div class="tgme_widget_message_forwarded_from">Forwarded from <a class="tgme_widget_message_forwarded_from_name" href="https://t.me/telegram/310"><span dir="auto">Telegram</span></a></div>',
          '<a class="tgme_widget_message_reply" href="https://t.me/durov/398"><div class="tgme_widget_message_author"><span class="tgme_widget_message_author_name">Pavel Durov</span></div><div class="tgme_widget_message_text js-message_reply_text">First lines<br>of the parent…</div></a>',
          text('The reply'),
        ].join(''),
      ),
    );

    expect(content(renderWidgetPost(html))).toBe(
      [
        '## Post · 1/1 — Pavel Durov (@durov)',
        '',
        '> Forwarded from: Telegram (https://t.me/telegram/310)',
        '> Replying to Pavel Durov: First lines of the parent… (https://t.me/durov/398)',
        '',
        'The reply',
        '',
        'Source: https://t.me/durov/63',
        'Date: 2026-10-08T15:40:10+00:00',
      ].join('\n'),
    );
  });

  it('names a public-group sender with the sender link', () => {
    const html = widget(
      message(
        'golang_ru/100000',
        [
          '<div class="tgme_widget_message_author"><a class="tgme_widget_message_author_name" href="https://t.me/a5201852b512af86"><span dir="auto">Alexander</span></a> in <a class="tgme_widget_message_owner_name" href="https://t.me/golang_ru"><span dir="auto">Golang Developers</span></a></div>',
          '<a class="tgme_widget_message_reply" href="https://t.me/golang_ru/99996"><div class="tgme_widget_message_author"><span class="tgme_widget_message_author_name">A. M.</span></div><div class="tgme_widget_message_text">Parent</div></a>',
          text('Message'),
          footer('golang_ru/100000'),
        ].join(''),
      ),
    );

    const rendered = content(renderWidgetPost(html));
    expect(rendered.split('\n')[0]).toBe(
      '## Post · 1/1 — Alexander (https://t.me/a5201852b512af86)',
    );
    expect(rendered).toContain(
      '> Replying to A. M.: Parent (https://t.me/golang_ru/99996)\n\nMessage\n\n',
    );
  });

  it('names a group sender without a link by display name', () => {
    const html = widget(
      message(
        'golang_ru/7',
        '<div class="tgme_widget_message_author"><span class="tgme_widget_message_author_name">Hidden User</span> in <a class="tgme_widget_message_owner_name" href="https://t.me/golang_ru">Golang</a></div>',
      ),
    );

    expect(content(renderWidgetPost(html))).toBe(
      [
        '## Post · 1/1 — Hidden User',
        '',
        'Source: https://t.me/golang_ru/7',
      ].join('\n'),
    );
  });

  it('renders one note per media item with its type and detail', () => {
    const html = widget(
      post(
        70,
        [
          '<div class="media_supported_cont"><div class="tgme_widget_message_one_media"><div class="tgme_widget_message_grouped_wrap"><div class="tgme_widget_message_grouped"><div class="tgme_widget_message_grouped_layer">',
          `<a class="tgme_widget_message_photo_wrap grouped_media_wrap" href="https://t.me/durov/70?single" style="background-image:url('${CDN}')"></a>`,
          `<a class="tgme_widget_message_photo_wrap grouped_media_wrap" href="https://t.me/durov/71?single" style="background-image:url('${CDN}')"></a>`,
          '</div></div></div></div></div>',
          `<a class="tgme_widget_message_video_player" href="https://t.me/durov/72"><i class="tgme_widget_message_video_thumb" style="background-image:url('${CDN}')"></i><time class="message_video_duration">0:42</time></a>`,
          '<a class="tgme_widget_message_roundvideo_player"><time class="tgme_widget_message_roundvideo_duration">0:15</time></a>',
          '<a class="tgme_widget_message_voice_player"><time class="tgme_widget_message_voice_duration">1:05</time></a>',
          `<div class="tgme_widget_message_sticker_wrap media_supported_cont"><i class="tgme_widget_message_sticker" data-webp="${CDN}"></i></div>`,
          '<a class="tgme_widget_message_location_wrap" href="https://maps.example/x"><div class="tgme_widget_message_location"></div></a>',
          '<div class="tgme_widget_message_poll"><div class="tgme_widget_message_poll_question">Tea or coffee?</div><div class="tgme_widget_message_poll_options">Tea</div></div>',
          '<a class="tgme_widget_message_document_wrap"><div class="tgme_widget_message_document_icon audio"></div><div class="tgme_widget_message_document_title">Song</div><div class="tgme_widget_message_document_extra">Band</div></a>',
          '<a class="tgme_widget_message_document_wrap"><div class="tgme_widget_message_document_icon"></div><div class="tgme_widget_message_document_title">report.pdf</div><div class="tgme_widget_message_document_extra">1.2 MB</div></a>',
          '<div class="message_media_not_supported_wrap"><div class="message_media_not_supported_label">Please open Telegram to view this post</div></div>',
          '<div class="tgme_widget_message_contact_wrap">Alice</div>',
        ].join(''),
      ),
    );

    const rendered = content(renderWidgetPost(html));
    expect(rendered).toBe(
      [
        '## Post · 1/1 — Pavel Durov (@durov)',
        '',
        '> [photo]',
        '> [photo]',
        '> [video 0:42]',
        '> [video message 0:15]',
        '> [voice 1:05]',
        '> [sticker]',
        '> [location]',
        '> [poll: Tea or coffee?]',
        '> [audio: Song — Band]',
        '> [document: report.pdf]',
        '> [unsupported media]',
        '> [unsupported media]',
        '',
        'Source: https://t.me/durov/70',
        'Date: 2026-10-08T15:40:10+00:00',
      ].join('\n'),
    );
    expect(rendered).not.toContain('telesco.pe');
  });

  it('renders nothing for hidden fallback blocks', () => {
    const html = page([
      post(
        1,
        `<div class="media_supported_cont">${text('Text')}</div>${HIDDEN}`,
      ),
      post(
        2,
        `<div class="message_media_not_supported_wrap media_not_supported_cont"><div class="message_media_not_supported_label">This media is not supported in your browser</div></div><div class="tgme_widget_message_sticker_wrap media_supported_cont"><i class="tgme_widget_message_sticker"></i></div>`,
      ),
      post(
        3,
        '<a class="tgme_widget_message_video_player"><time class="message_video_duration">0:28</time><div class="message_media_not_supported_wrap"><div class="message_media_not_supported_label">This media is not supported in your browser</div></div></a>',
      ),
    ]);

    const rendered = content(renderChannelPage(html, 'https://t.me/s/durov'));
    expect(rendered).not.toContain('[unsupported media]');
    expect(rendered).not.toContain('Please open Telegram');
    expect(rendered).toContain('\n\n> [video 0:28]\n\n');
    expect(rendered).toContain('\n\n> [sticker]\n\n');
  });

  it('renders the full link-preview card on one line', () => {
    const html = widget(
      post(
        9,
        [
          text('<a href="https://telegram.org/blog/x">Read</a>'),
          '<a class="tgme_widget_message_link_preview" href="https://telegram.org/blog/x">',
          '<div class="link_preview_site_name">Telegram</div>',
          `<i class="link_preview_image" style="background-image:url('${CDN}')"></i>`,
          '<div class="link_preview_title">Title</div>',
          '<div class="link_preview_description">Line one<br>line <i class="emoji"><b>🧠</b></i> two</div>',
          '</a>',
        ].join(''),
      ),
    );

    const rendered = content(renderWidgetPost(html));
    expect(rendered).toContain(
      '[Read](https://telegram.org/blog/x)\n\n> Link: Telegram — Title: Line one line 🧠 two (https://telegram.org/blog/x)\n\nSource:',
    );
    expect(rendered).not.toContain('telesco.pe');
  });

  it('renders an image-only link-preview card as its URL', () => {
    const html = widget(
      post(
        9,
        [
          '<a class="tgme_widget_message_link_preview" href="https://telegra.ph/file/x.png">',
          `<i class="link_preview_image" style="background-image:url('${CDN}')"></i>`,
          '</a>',
        ].join(''),
      ),
    );

    expect(content(renderWidgetPost(html))).toContain(
      '\n\n> Link: https://telegra.ph/file/x.png\n\n',
    );
  });
});

describe('Telegram widget failures', () => {
  it('maps the widget error element to empty', () => {
    const html = widget(
      '<div class="tgme_widget_message err_message"><div class="tgme_widget_message_bubble"><div class="tgme_widget_message_error">Post not found</div></div></div>',
    );

    expect(renderWidgetPost(html)).toStrictEqual({ failure: 'empty' });
  });

  it('maps a widget service message to empty', () => {
    const html = widget(
      post(
        1,
        '<div class="message_media_not_supported_wrap"><div class="message_media_not_supported"><div class="message_media_not_supported_label">Service message</div></div></div>',
      ),
    );

    expect(renderWidgetPost(html)).toStrictEqual({ failure: 'empty' });
  });

  it('maps a widget with neither a message nor an error to parse', () => {
    expect(renderWidgetPost(widget('<p>Telegram</p>'))).toStrictEqual({
      failure: 'parse',
    });
    expect(
      renderWidgetPost(
        widget('<div class="tgme_widget_message">No post id</div>'),
      ),
    ).toStrictEqual({ failure: 'parse' });
  });
});

describe('Telegram channel page', () => {
  const FULL_HEADER =
    '<div class="tgme_channel_info"><div class="tgme_channel_info_header_title"><span dir="auto">Pavel Durov</span></div><div class="tgme_channel_info_header_username"><a href="https://t.me/durov">@durov</a></div><div class="tgme_channel_info_counters"><div class="tgme_channel_info_counter"><span class="counter_value">102</span> <span class="counter_type">photos</span></div><div class="tgme_channel_info_counter"><span class="counter_value">10.5M</span> <span class="counter_type">subscribers</span></div></div><div class="tgme_channel_info_description">Founder of <a href="https://telegram.org">Telegram</a>.</div></div>';

  it('lists posts newest first with both cursors under the header', () => {
    const html = page(
      [
        message(
          'durov/1',
          `${OWNER}${text('Channel created')}${footer('durov/1')}`,
          ' service_message',
        ),
        post(529, text('Older post')),
        post(530, text('Middle post')),
        post(531, text('Newest post')),
      ],
      '<link rel="prev" href="/s/durov?before=528"><link rel="canonical" href="/s/durov?before=532"><link rel="next" href="/s/durov?after=531">',
      FULL_HEADER,
    );

    expect(
      content(renderChannelPage(html, 'https://t.me/s/durov?before=532')),
    ).toBe(
      [
        '# Pavel Durov (@durov)',
        '',
        'Founder of [Telegram](https://telegram.org).',
        '',
        'Subscribers: 10.5M',
        'URL: https://t.me/s/durov?before=532',
        'Older: https://t.me/s/durov?before=528',
        'Newer: https://t.me/s/durov?after=531',
        '',
        '---',
        '',
        '## Post · 1/3 — Pavel Durov (@durov)',
        '',
        'Newest post',
        '',
        'Source: https://t.me/durov/531',
        'Date: 2026-10-08T15:40:10+00:00',
        '',
        '---',
        '',
        '## Post · 2/3 — Pavel Durov (@durov)',
        '',
        'Middle post',
        '',
        'Source: https://t.me/durov/530',
        'Date: 2026-10-08T15:40:10+00:00',
        '',
        '---',
        '',
        '## Post · 3/3 — Pavel Durov (@durov)',
        '',
        'Older post',
        '',
        'Source: https://t.me/durov/529',
        'Date: 2026-10-08T15:40:10+00:00',
      ].join('\n'),
    );
  });

  it('renders only the older cursor when Telegram links only the previous page', () => {
    const html = page(
      [post(549, text('Latest'))],
      '<link rel="prev" href="/s/durov?before=528">',
    );

    const rendered = content(renderChannelPage(html, 'https://t.me/s/durov'));
    expect(rendered).toContain(
      'URL: https://t.me/s/durov\nOlder: https://t.me/s/durov?before=528\n\n---\n\n## Post · 1/1 — Pavel Durov (@durov)',
    );
    expect(rendered).not.toContain('Newer:');
  });

  it('renders the header alone for an empty page with dead cursors', () => {
    const html = page(
      [
        '<div class="tgme_widget_message_centered"><div class="tme_no_messages_found">No posts found</div></div>',
      ],
      '<link rel="prev" href="/s/durov?before=0"><link rel="next" href="/s/durov?after=">',
    );

    expect(
      content(renderChannelPage(html, 'https://t.me/s/durov?before=1')),
    ).toBe(
      ['# Pavel Durov (@durov)', '', 'URL: https://t.me/s/durov?before=1'].join(
        '\n',
      ),
    );
  });

  it('maps a preview without the channel header to parse', () => {
    expect(
      renderChannelPage(
        page([post(1, text('x'))], '', ''),
        'https://t.me/s/durov',
      ),
    ).toStrictEqual({ failure: 'parse' });
  });
});
