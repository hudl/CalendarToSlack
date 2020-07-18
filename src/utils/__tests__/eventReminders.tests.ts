import { getEventLocationUrl, getAdditionalEventLinks, getUpcomingEventMessage } from '../eventReminders';
import { ShowAs, CalendarEvent } from '../../services/calendar';
import { UserSettings } from '../../services/dynamo';

const baseUserSettings: UserSettings = { email: 'test@email.com', slackToken: 'abc' };
const baseEvent: CalendarEvent = {
  id: '1',
  name: 'Quick Chat',
  body: '',
  startTime: new Date(),
  endTime: new Date(),
  location: '',
  showAs: ShowAs.Free,
};

describe('getEventLocationUrl', () => {
  describe('Given a null event', () => {
    test('Returns null', () => {
      const url = getEventLocationUrl(null, baseUserSettings);

      expect(url).toBeNull();
    });
  });

  describe('Url-only locations', () => {
    const testUrl = 'https://my.test.url';

    test('Url-only returns the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `${testUrl}`,
      };
      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Front-padded url returns just the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `   ${testUrl}`,
      };
      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Back-padded url returns just the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `${testUrl}     `,
      };
      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
  });

  describe('Non-url locations', () => {
    test('Gibberish returns null', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'asdfqweoriu-123-wequio',
      };

      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
    test('Names returns null', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Jane Smith',
      };

      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
    test('Meeting room names return null', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Michael Jordan',
      };

      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
    test('Semicolon-separated names return null', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Michael Jordan; Candace Parker; Bob Smith',
      };

      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
  });

  describe('Mixed locations', () => {
    const testUrl = 'https://my.test.url/stuff?123';
    test('Url-first returns the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `${testUrl} Michael Jordan`,
      };

      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Semicolon-separated returns the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `${testUrl}; Michael Jordan`,
      };

      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Url last returns the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `Michael Jordan; ${testUrl}`,
      };

      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Url last with semicolon returns the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `Michael Jordan; ${testUrl};`,
      };

      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Url middle returns the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `Michael Jordan; ${testUrl}; Scrum Masters;`,
      };

      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
  });
  describe('Bodies with zoom links', () => {
    const testUrl = 'https://my.test.url/stuff?123';
    const testZoomUrl = 'https://hudl.zoom.us/j/1234?param=5678';
    const nonHudlTestZoomUrl = 'https://cats_and_dogs.zoom.us/j/1234?param=5678';

    test('Non-zoom url in body returns null', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Test Location',
        body: `Check out my link ${testUrl}`,
      };
      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
    test('Zoom url in body returns zoom link', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Test Location',
        body: `Check out my link ${testZoomUrl}`,
      };
      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testZoomUrl);
    });
    test('Non-Hudl Zoom url in body returns zoom link', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Test Location',
        body: `Check out my link ${nonHudlTestZoomUrl}`,
      };
      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(nonHudlTestZoomUrl);
    });
    test('Zoom url in html body returns zoom link', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Test Location',
        body: `Check out my <a href="${testZoomUrl}">Link</a>`,
      };
      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testZoomUrl);
    });
    test('Zoom url in html body returns zoom link', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Test Location',
        body: `Join us here <${testZoomUrl}> at 12:00!`,
      };
      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testZoomUrl);
    });
    test('Url in location overrides body', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `Test Location; ${testUrl}`,
        body: `Check out my link ${testZoomUrl}`,
      };
      const url = getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
  });
});

describe('getAdditionalEventLinks', () => {
  describe('Given a null event', () => {
    test('Returns empty list', () => {
      const urls = getAdditionalEventLinks(null);

      expect(urls).toHaveLength(0);
    });
  });

  describe('Given a body', () => {
    describe('With no links', () => {
      test('Returns empty list', () => {
        const body = `<html><head><meta name=\"Generator\" content=\"Microsoft Exchange Server\">\r\n<!-- converted from text -->\r\n<style><!-- .EmailQuote { margin-left: 1pt; padding-left: 4pt; border-left: #800000 2px solid; } --></style></head>\r\n<body>\r\n<font size=\"2\"><span style=\"font-size:11pt;\"><div class=\"PlainText\">&nbsp;</div></span></font>\r\n</body>\r\n</html>\r\n`;
        const ev = { ...baseEvent, body };

        const urls = getAdditionalEventLinks(ev);
        expect(urls).toHaveLength(0);
      });
    });
    describe('With one link', () => {
      test('Returns link', () => {
        const body = `<html>\r\n<head>\r\n<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\">\r\n<meta content=\"text/html; charset=iso-8859-1\">\r\n<meta name=\"Generator\" content=\"Microsoft Word 15 (filtered medium)\">\r\n<style>\r\n<!--\r\n@font-face\r\n\t{font-family:\"Cambria Math\"}\r\n@font-face\r\n\t{font-family:Calibri}\r\np.MsoNormal, li.MsoNormal, div.MsoNormal\r\n\t{margin:0in;\r\n\tmargin-bottom:.0001pt;\r\n\tfont-size:12.0pt;\r\n\tfont-family:\"Calibri\",sans-serif}\r\na:link, span.MsoHyperlink\r\n\t{color:#0563C1;\r\n\ttext-decoration:underline}\r\nspan.EmailStyle17\r\n\t{font-family:\"Calibri\",sans-serif;\r\n\tcolor:windowtext}\r\n.MsoChpDefault\r\n\t{font-size:12.0pt;\r\n\tfont-family:\"Calibri\",sans-serif}\r\n@page WordSection1\r\n\t{margin:1.0in 1.0in 1.0in 1.0in}\r\ndiv.WordSection1\r\n\t{}\r\n-->\r\n</style>\r\n</head>\r\n<body lang=\"EN-US\" link=\"#0563C1\" vlink=\"#954F72\">\r\n<div class=\"WordSection1\">\r\n<p class=\"MsoNormal\"><span style=\"font-size:11.0pt; color:black\">Join the webinar via this\r\n<a href=\"https://hudl.zoom.us/j/12384855\">\r\nlink</a>. Password: xxxxxx</span><span style=\"font-size:11.0pt\"><br>\r\n</span></p>\r\n<p class=\"MsoNormal\"><span style=\"font-size:11.0pt; color:black\">Questions? Ask them in the\r\n<b>#bitsconfasync</b> Slack channel</span><span style=\"font-size:11.0pt; font-family:'Arial',sans-serif; color:black\">.</span><span style=\"font-size:11.0pt\"><br>\r\n</span></p>\r\n<p class=\"MsoNormal\"><span style=\"font-size:11.0pt\"><br>\r\n</span></p>\r\n</div>\r\n</body>\r\n</html>\r\n`;
        const ev = { ...baseEvent, body };

        const urls = getAdditionalEventLinks(ev);
        expect(urls).toHaveLength(1);
        expect(urls[0]).toBe('https://hudl.zoom.us/j/12384855');
      });
    });
    describe('With multiple distinct links', () => {
      test('Returns distinct links', () => {
        const body = `<html>\r\n<head>\r\n<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\">\r\n<meta content=\"text/html; charset=Windows-1252\">\r\n</head>\r\n<body>\r\n<p style=\"margin:10px 0px 0px; text-align:start; color:rgb(23,43,77); background-color:rgb(255,255,255)\">\r\n<span>Please join Betamax squad for this design review:&nbsp;<a href=\"https://sync.hudlnet.com/x/blah\">https://sync.hudlnet.com/x/blah</a></span></p>\r\n<p style=\"margin:10px 0px 0px; text-align:start; color:rgb(23,43,77); background-color:rgb(255,255,255)\">\r\n<span>In seasons past, the worker farm has been high-touch in terms of scaling configuration and cost optimization—aspects of the farm that the Lifeguard service currently manages. We'd like to move away from Lifeguard and toward a system that will reduce the\r\n burden of scaling and cost management on our team and allow us to leverage future AWS features quickly.</span></p>\r\n<p style=\"margin:10px 0px 0px; text-align:start; color:rgb(23,43,77); background-color:rgb(255,255,255)\">\r\n<span style=\"\">In this design review, we propose scaling our workers using </span>\r\n<strong style=\"font-size:inherit; font-style:inherit; font-variant-ligatures:inherit; font-variant-caps:inherit\">EC2 Auto Scaling Groups</strong><span style=\"\">&nbsp;with high spot instance allocation and distribution across many availability zones and instance\r\n types. All of these new workers will live in a</span><span style=\"\">&nbsp;</span><strong style=\"font-size:inherit; font-style:inherit; font-variant-ligatures:inherit; font-variant-caps:inherit\">separate VPC</strong><span style=\"\">&nbsp;</span><span style=\"\">within the\r\n hudl-farm AWS account and will be provisioned using&nbsp;</span><strong style=\"font-size:inherit; font-style:inherit; font-variant-ligatures:inherit; font-variant-caps:inherit\">Terraform</strong><span style=\"\">.</span></p>\r\n<br>\r\n<br>\r\n<font face=\"Calibri\" size=\"1\" color=\"#404040\"><span style=\"\">.........................................................................................................................................</span></font><br>\r\n<font face=\"Calibri\" size=\"4\"><span style=\"font-size:16pt\"><a href=\"https://meet.lync.com/agilesports/jordan.degner/xxxxx\" target=\"_blank\">Join online meeting</a></span></font><br>\r\n<font face=\"Calibri\" size=\"1\" color=\"#404040\"><span style=\"font-size:8pt\">.........................................................................................................................................</span></font><br>\r\n</body>\r\n</html>\r\n`;
        const ev = { ...baseEvent, body };

        const urls = getAdditionalEventLinks(ev);
        expect(urls).toHaveLength(2);
        expect(urls[0]).toBe('https://sync.hudlnet.com/x/blah');
        expect(urls[1]).toBe('https://meet.lync.com/agilesports/jordan.degner/xxxxx');
      });
    });
  });
});

describe('getUpcomingEventMessage', () => {
  describe('Given a null event', () => {
    test('Returns null', () => {
      const message = getUpcomingEventMessage(null, baseUserSettings);
      expect(message).toBeNull();
    });
  });
  describe('With Zoom links disabled', () => {
    test('Returns null', () => {
      const settings = { ...baseUserSettings, zoomLinksDisabled: true };
      const message = getUpcomingEventMessage(baseEvent, settings);

      expect(message).toBeNull();
    });
  });
  describe('With no location URL', () => {
    test('Returns null', () => {
      const message = getUpcomingEventMessage(baseEvent, baseUserSettings);

      expect(message).toBeNull();
    });
  });
  describe('With only a location URL in the location', () => {
    test('Returns a message with the URL', () => {
      const event = { ...baseEvent, location: 'https://my.test.url' };
      const message = getUpcomingEventMessage(event, baseUserSettings);

      expect(message).toBe(`You have an upcoming meeting: *${event.name}* at https://my.test.url`);
    });
  });
  describe('With only a location URL in the body', () => {
    const event = { ...baseEvent, body: 'Join here: https://hudl.zoom.us/my/blahblah' };
    const message = getUpcomingEventMessage(event, baseUserSettings);

    expect(message).toBe(`You have an upcoming meeting: *${event.name}* at https://hudl.zoom.us/my/blahblah`);
  });
  describe('With a location and additional links', () => {
    test('Returns a message with the location and additional URLs', () => {
      const event = {
        ...baseEvent,
        location: 'https://my.test.url',
        body: `Blah blah blah meetings. Here's the agenda: https://agenda.url. Here's another link! https://cool.url`,
      };
      const message = getUpcomingEventMessage(event, baseUserSettings);

      expect(message).toBe(
        `You have an upcoming meeting: *${event.name}* at https://my.test.url. Here are some links I found in the event:
• https://agenda.url
• https://cool.url`,
      );
    });
    test('Does not consider the location an additional URL when present in the body', () => {
      const event = {
        ...baseEvent,
        location: 'https://my.test.url',
        body: `Blah blah blah meetings. Here's the agenda: https://agenda.url. Join the meeting at: https://my.test.url`,
      };
      const message = getUpcomingEventMessage(event, baseUserSettings);

      expect(message).toBe(
        `You have an upcoming meeting: *${event.name}* at https://my.test.url. Here are some links I found in the event:
• https://agenda.url`,
      );
    });
  });
});
